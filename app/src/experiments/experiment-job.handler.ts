import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ConfigService } from '@nestjs/config';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { TestTargetsRepository } from '../project-versions/persistence/test-targets.repository.js';
import { FileDiscoveryService } from '../project-versions/discovery/file-discovery.service.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import {
  ZipExtractionService,
  type ExtractedWorkspace,
} from '../project-versions/zip/zip-extraction.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { FunctionalRulesRetriever } from '../retrieval/functional-rules.retriever.js';
import type { RetrievalTarget } from '../retrieval/generation-context.js';
import { PromptBuilder } from '../generation/prompt-builder.service.js';
import {
  TestFileMergeService,
  coLocatedSpecPath,
} from '../generation/test-file-merge.service.js';
import { LLM_PROVIDER } from '../providers/providers.constants.js';
import type { LLMEffectiveConfig, LLMProvider } from '../providers/llm-provider.interface.js';
import { WorkspaceAgentTools } from '../generation/agent/workspace-agent-tools.js';
import { GeneralistAgentService } from '../generation/agent/generalist-agent.service.js';
import type {
  AgentToolStepEvent,
  AgentTrajectoryStep,
} from '../generation/agent/generalist-agent.service.js';
import {
  SandboxExecutionService,
  SandboxUnavailableError,
} from '../sandbox/sandbox-execution.service.js';
import {
  mapSandboxResult,
  SANDBOX_TIMED_OUT_ERROR_SUMMARY,
  type FailureTypeValue,
} from '../sandbox/map-sandbox-result.js';
import { sandboxExperimentRequestId } from '../sandbox/sandbox-request-id.util.js';
import { estimateCost } from './cost-calculator.js';
import {
  ExperimentRunsRepository,
  type ExperimentBudget,
  type ExperimentRepetitionInput,
} from './persistence/experiment-runs.repository.js';
import { ExperimentRepetitionState, ExperimentStatus } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ExperimentRepetition, TestTarget } from '../generated/prisma/client.js';
import { ContextTracesRepository } from '../context-traces/context-traces.repository.js';
import type { BegunContextTraceAttempt } from '../context-traces/context-traces.repository.js';
import type { GenerationContext } from '../retrieval/generation-context.js';
import type { ExecutionProfile } from '../sandbox/sandbox.types.js';
import {
  DEFAULT_AGENT_MAX_TOOL_CALLS,
  DEFAULT_GENERATION_TIMEOUT_MS,
  DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS,
} from '../config/generation-budget.defaults.js';
import { LLMProviderUnavailableError } from '../providers/llm-provider-unavailable.error.js';
import { experimentPairId, pairOrder } from './pair-order.js';

export interface ExperimentJobPayload {
  experimentId: string;
  projectId: string;
  projectVersionId: string;
  targetId: string;
}

type Strategy = 'RAG' | 'GENERALIST_AGENT';

const STRATEGIES: Strategy[] = ['RAG', 'GENERALIST_AGENT'];
const REPETITIONS_PER_STRATEGY = 3;
export const EXPERIMENT_JOB_TYPE = 'experiment-run';

/** Identidad lógica de un slot (estrategia + repetición) y de su par (WI-CORE-025). */
interface SlotIdentity {
  strategy: Strategy;
  repetition: number;
  pairId: string | null;
  pairPosition: number | null;
}

/** Contexto común de una corrida; `runAttempt` lo amplía con el slot y el número de intento. */
interface RunContext {
  jobId: string;
  experimentId: string;
  projectId: string;
  projectVersionId: string;
  snapshotKey: string;
  snapshotBuffer: Buffer;
  framework: 'JEST' | 'VITEST' | null;
  target: TestTarget;
  config: LLMEffectiveConfig;
  budget: ExperimentBudget;
  executionProfile: ExecutionProfile | undefined;
}

interface AttemptContext extends RunContext, SlotIdentity {
  /** 1 = intento inicial; 2 = único reintento por fallo externo (nunca hay 3). */
  attempt: 1 | 2;
}

/** Resumen de un fallo externo del proveedor LLM (WI-CORE-025). */
const LLM_EXTERNAL_FAILURE_SUMMARY =
  'El proveedor de LLM no respondió correctamente durante la generación.';

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer),
  ) as Promise<T>;
}

/**
 * Ejecuta `items` a través de `worker` con a lo sumo `concurrency` corridas
 * simultáneas. Cada repetición de un experimento ya es independiente
 * (workspace y contenedor Sandbox propios), así que correrlas en serie solo
 * suma latencia sin necesidad: el tiempo total pasa a ser el de los lotes
 * concurrentes en vez de la suma de las 6.
 */
function parseEffectiveConfig(value: unknown): LLMEffectiveConfig {
  const candidate = value as Partial<Record<keyof LLMEffectiveConfig, unknown>> | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    candidate.provider !== 'openai' ||
    typeof candidate.model !== 'string' ||
    typeof candidate.modelVersion !== 'string'
  ) {
    throw new Error('modelConfig del experimento no es válido.');
  }
  return {
    provider: 'openai',
    model: candidate.model,
    modelVersion: candidate.modelVersion,
    reasoningEffort: typeof candidate.reasoningEffort === 'string' ? candidate.reasoningEffort : null,
    temperature: typeof candidate.temperature === 'number' ? candidate.temperature : null,
    maxOutputTokens: typeof candidate.maxOutputTokens === 'number' ? candidate.maxOutputTokens : null,
  };
}

async function runWithConcurrencyLimit<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  async function runNext(): Promise<void> {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) {
      return;
    }
    await worker(items[index]);
    await runNext();
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runNext),
  );
}

function slotKey(strategy: string, repetition: number): string {
  return `${strategy}:${repetition}`;
}

/** Pares 1..3 en orden (plan punto 5): dentro de cada par, la posición 1 corre primero. */
function buildPairSchedule(experimentId: string, seed: string): SlotIdentity[][] {
  return Array.from({ length: REPETITIONS_PER_STRATEGY }, (_, index) => {
    const repetition = index + 1;
    const pairId = experimentPairId(experimentId, repetition);
    return pairOrder(seed, repetition).map((strategy, position) => ({
      strategy,
      repetition,
      pairId,
      pairPosition: position + 1,
    }));
  });
}

/** Corridas previas sin semilla: orden y slots actuales, sin identidad de par. */
function buildLegacySchedule(): SlotIdentity[] {
  return STRATEGIES.flatMap((strategy) =>
    Array.from({ length: REPETITIONS_PER_STRATEGY }, (_, index) => ({
      strategy,
      repetition: index + 1,
      pairId: null,
      pairPosition: null,
    })),
  );
}

/**
 * Fallo externo persistido: FAILED con INFRASTRUCTURE (plan punto 7). El timeout del Sandbox
 * también persiste INFRASTRUCTURE, pero no es externo: se distingue por su resumen.
 */
function isPersistedExternalFailure(row: ExperimentRepetition): boolean {
  return (
    row.state === ExperimentRepetitionState.FAILED &&
    row.failureType === 'INFRASTRUCTURE' &&
    row.errorSummary !== SANDBOX_TIMED_OUT_ERROR_SUMMARY
  );
}

/**
 * Intento con el que debe continuar un slot en esta corrida, o null si no corresponde
 * ejecutarlo (idempotencia de redelivery, plan punto 8). Nunca devuelve 3.
 * Un intento 1 huérfano en RUNNING se trata como interrumpido y continúa con el intento 2.
 */
function firstAttemptToRun(latest: ExperimentRepetition | undefined): 1 | 2 | null {
  if (!latest) return 1;
  if (
    latest.attempt === 1 &&
    (latest.state === ExperimentRepetitionState.RUNNING || isPersistedExternalFailure(latest))
  ) {
    return 2;
  }
  return null;
}

/** Valores ausentes (`null` o no presentes en corridas previas) no son error: usan la versión actual. */
function parseRunnerHint(value: string | null | undefined): 'JEST' | 'VITEST' | null {
  if (value === null || value === undefined) return null;
  if (value === 'JEST' || value === 'VITEST') return value;
  throw new Error('runnerHint del experimento no es válido.');
}

function parseExecutionProfile(value: string | null | undefined): ExecutionProfile | undefined {
  if (value === null || value === undefined) return undefined;
  if (value === 'NODE_TYPESCRIPT' || value === 'PHP_LARAVEL_PHPUNIT') return value;
  throw new Error('executionProfile del experimento no es válido.');
}

interface GenerationOutcome {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  retrievedChunks: number | null;
  selectedChunks: number | null;
  contextTokens: number | null;
  toolCalls: number | null;
  filesInspected: number | null;
  trajectory: unknown;
}

@Injectable()
export class ExperimentJobHandler
  implements JobHandler<ExperimentJobPayload>, OnModuleInit
{
  readonly type = EXPERIMENT_JOB_TYPE;
  private readonly logger = new Logger(ExperimentJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly experimentRunsRepository: ExperimentRunsRepository,
    private readonly contextTracesRepository: ContextTracesRepository,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly testTargetsRepository: TestTargetsRepository,
    private readonly retrievalService: RetrievalService,
    private readonly contextBuilder: ContextBuilder,
    private readonly functionalRulesRetriever: FunctionalRulesRetriever,
    private readonly promptBuilder: PromptBuilder,
    private readonly generalistAgentService: GeneralistAgentService,
    private readonly fileDiscoveryService: FileDiscoveryService,
    private readonly testFileMergeService: TestFileMergeService,
    private readonly sandboxExecutionService: SandboxExecutionService,
    private readonly objectStorageService: ObjectStorageService,
    private readonly zipExtractionService: ZipExtractionService,
    private readonly configService: ConfigService,
    @Inject(LLM_PROVIDER) private readonly llmProvider: LLMProvider,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: ExperimentJobPayload, jobId: string): Promise<void> {
    const run = await this.experimentRunsRepository.findById(
      payload.experimentId,
    );

    if (!run || run.status === ExperimentStatus.COMPLETED) {
      return;
    }

    try {
      await this.experimentRunsRepository.markStarted(payload.experimentId);
      // Misma configuración para ambos brazos: la persistida al crear el experimento.
      // Corridas previas sin modelConfig (NULL) usan la resolución por defecto.
      const config =
        run.modelConfig === null || run.modelConfig === undefined
          ? await this.llmProvider.resolveEffectiveConfig()
          : parseEffectiveConfig(run.modelConfig);

      const [version, target] = await Promise.all([
        this.projectVersionsRepository.findById(payload.projectVersionId),
        this.testTargetsRepository.findById(payload.targetId),
      ]);

      if (!version || !version.snapshotKey) {
        throw new Error(
          `ProjectVersion ${payload.projectVersionId} no tiene snapshot disponible.`,
        );
      }

      if (!target) {
        throw new Error(`No existe el target ${payload.targetId}.`);
      }

      const detectedFramework = version.detectedFramework;
      if (
        version.language === 'PHP'
        || detectedFramework === 'PHPUNIT'
      ) {
        throw new Error('Los experimentos PHP/PHPUnit requieren WI-CORE-013 y aún no están habilitados.');
      }

      // Runner, perfil y presupuesto persistidos al crear el experimento (WI-CORE-025).
      // Corridas previas sin esos valores usan la versión actual y el entorno.
      const snapshotKey = version.snapshotKey;
      const snapshotBuffer = await this.objectStorageService.get(snapshotKey);
      const runContext: RunContext = {
        jobId,
        experimentId: payload.experimentId,
        projectId: payload.projectId,
        projectVersionId: payload.projectVersionId,
        snapshotKey,
        snapshotBuffer,
        framework: parseRunnerHint(run.runnerHint) ?? detectedFramework,
        target,
        config,
        budget: this.resolveBudget(run.budget),
        executionProfile: parseExecutionProfile(run.executionProfile),
      };
      const concurrency = this.configService.get<number>(
        'EXPERIMENT_REPETITION_CONCURRENCY',
        3,
      );
      // Último intento por slot: decide qué se omite al reentrar el job (redelivery).
      const latestBySlot = new Map(
        (await this.experimentRunsRepository.findRepetitions(payload.experimentId)).map(
          (row) => [slotKey(row.strategy, row.repetition), row] as const,
        ),
      );
      const latestOf = (slot: SlotIdentity) =>
        latestBySlot.get(slotKey(slot.strategy, slot.repetition));

      if (run.randomizationSeed) {
        // OE5 pareado: los pares 1..3 corren con concurrencia limitada; dentro de cada par
        // las dos posiciones son estrictamente secuenciales y el reintento va antes de la siguiente.
        await runWithConcurrencyLimit(
          buildPairSchedule(payload.experimentId, run.randomizationSeed),
          concurrency,
          async (pair) => {
            for (const slot of pair) {
              await this.runSlot(runContext, slot, latestOf(slot));
            }
          },
        );
      } else {
        await runWithConcurrencyLimit(
          buildLegacySchedule(),
          concurrency,
          (slot) => this.runSlot(runContext, slot, latestOf(slot)),
        );
      }

      await this.experimentRunsRepository.complete(payload.experimentId);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Fallo desconocido durante el experimento.';
      await this.experimentRunsRepository.markFailed(
        payload.experimentId,
        'EXPERIMENT_FAILED',
        message,
      );
      throw error;
    }
  }

  /**
   * Presupuesto persistido al crear el experimento (WI-CORE-025). Corridas previas sin
   * `budget` usan el entorno actual; nunca se regenera aquí.
   */
  private resolveBudget(raw: unknown): ExperimentBudget {
    if (raw === null || raw === undefined) {
      return {
        toolCallCap: this.configService.get<number>('AGENT_MAX_TOOL_CALLS', DEFAULT_AGENT_MAX_TOOL_CALLS),
        contextTokenBudget: this.configService.get<number>(
          'RETRIEVAL_MAX_CONTEXT_TOKENS',
          DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS,
        ),
        maxDurationMs: this.configService.get<number>('GENERATION_TIMEOUT_MS', DEFAULT_GENERATION_TIMEOUT_MS),
      };
    }

    const candidate = raw as Partial<Record<keyof ExperimentBudget, unknown>>;
    if (
      typeof raw !== 'object'
      || typeof candidate.toolCallCap !== 'number'
      || typeof candidate.contextTokenBudget !== 'number'
      || typeof candidate.maxDurationMs !== 'number'
    ) {
      throw new Error('budget del experimento no es válido.');
    }
    return {
      toolCallCap: candidate.toolCallCap,
      contextTokenBudget: candidate.contextTokenBudget,
      maxDurationMs: candidate.maxDurationMs,
    };
  }

  /**
   * Ejecuta un slot: el intento que corresponda y, solo si el intento 1 termina en fallo
   * externo, un único reintento inmediato (sin backoff, sesión y workspace frescos).
   * No se avanza a la posición siguiente del par hasta terminar aquí (plan punto 5 y 7).
   */
  private async runSlot(
    context: RunContext,
    slot: SlotIdentity,
    latest: ExperimentRepetition | undefined,
  ): Promise<void> {
    const firstAttempt = firstAttemptToRun(latest);
    if (firstAttempt === null) return;

    const externalFailure = await this.runAttempt({ ...context, ...slot, attempt: firstAttempt });
    if (firstAttempt === 1 && externalFailure) {
      await this.runAttempt({ ...context, ...slot, attempt: 2 });
    }
  }

  /** Devuelve true si el intento terminó en fallo externo (plan punto 6). */
  private async runAttempt(context: AttemptContext): Promise<boolean> {
    const begun = await this.contextTracesRepository.beginAttempt({
      experimentId: context.experimentId,
      projectId: context.projectId,
      projectVersionId: context.projectVersionId,
      targetId: context.target.id,
      strategy: context.strategy,
      kind: context.strategy === 'RAG' ? 'RAG' : 'AGENT',
      repetition: context.repetition,
      pairId: context.pairId,
      pairPosition: context.pairPosition,
    });
    let workspace: ExtractedWorkspace | undefined;
    const generationStart = Date.now();
    let generationDurationMs = 0;
    let generation: GenerationOutcome = {
      content: '',
      inputTokens: null,
      outputTokens: null,
      retrievedChunks: null,
      selectedChunks: null,
      contextTokens: null,
      toolCalls: null,
      filesInspected: null,
      trajectory: undefined,
    };
    let externalFailure = false;
    let finalized = false;

    try {
      await this.initializeTraceDetail(begun.trace.id, context);
      workspace = await this.zipExtractionService.extract(
        context.snapshotBuffer,
      );
      const timeoutMs = context.budget.maxDurationMs;

      generation =
        context.strategy === 'RAG'
          ? await withTimeout(
              this.runRagArm(
                begun.trace.id,
                context.projectId,
                context.projectVersionId,
                context.target,
                context.framework,
                context.config,
                context.budget,
              ),
              timeoutMs,
              'La generación RAG agotó el tiempo límite.',
            )
          : await withTimeout(
              this.runAgentArm(
                begun.trace.id,
                workspace.dir,
                context.target,
                context.framework,
                context.config,
                context.budget,
              ),
              timeoutMs,
              'La generación del agente generalista agotó el tiempo límite.',
            );

      generationDurationMs = Date.now() - generationStart;
      const relativePath =
        context.target.hasTest && context.target.testFilePaths.length > 0
          ? context.target.testFilePaths[0]
          : coLocatedSpecPath(context.target.filePath);
      const existingContent = await readFile(
        join(workspace.dir, relativePath),
        'utf8',
      ).catch(() => null);
      const mergedContent =
        existingContent === null
          ? this.testFileMergeService.applyCreate(generation.content)
          : this.testFileMergeService.applyMerge(
              existingContent,
              generation.content,
            );

      if (!context.framework) {
        await this.recordRepetition(
          begun,
          context,
          generation,
          generationDurationMs,
          null,
          {
            status: 'FAILED',
            compiled: null,
            executed: null,
            passed: null,
            valid: null,
            failureType: 'CONFIGURATION',
            errorSummary:
              'No se pudo determinar el framework de test (Jest/Vitest) durante la indexación.',
          },
          false,
        );
        finalized = true;
        return false;
      }

      const executionStart = Date.now();
      let repetitionOutcome: {
        status: 'VALID' | 'INVALID' | 'FAILED';
        compiled: boolean | null;
        executed: boolean | null;
        passed: boolean | null;
        valid: boolean | null;
        failureType: FailureTypeValue | null;
        errorSummary: string | null;
      };
      let executionDurationMs: number;

      try {
        const sandboxResult = await this.sandboxExecutionService.execute({
          requestId: sandboxExperimentRequestId(
            context.jobId,
            context.strategy,
            context.repetition,
            context.attempt,
          ),
          testRunId: context.experimentId,
          projectVersionId: context.projectVersionId,
          snapshotKey: context.snapshotKey,
          snapshotBuffer: context.snapshotBuffer,
          artifacts: [
            {
              artifactId: randomUUID(),
              relativePath,
              artifactType: existingContent === null ? 'CREATED' : 'MODIFIED',
              content: Buffer.from(mergedContent, 'utf8'),
            },
          ],
          scope: 'TARGET',
          targetIds: [context.target.id],
          runnerHint: context.framework,
          executionProfile: context.executionProfile,
        });
        executionDurationMs = Date.now() - executionStart;
        const outcome = mapSandboxResult(sandboxResult);
        // Fallo externo del Sandbox: INFRASTRUCTURE salvo timeout (no es externo, WI-CORE-025).
        externalFailure =
          outcome.status === 'FAILED'
          && outcome.failureType === 'INFRASTRUCTURE'
          && sandboxResult.status !== 'TIMED_OUT';

        if (outcome.compiled === false) {
          this.logger.debug(
            `La repetición ${context.repetition} (${context.strategy}) no compiló.`,
          );
        }

        repetitionOutcome = {
          status: outcome.status,
          compiled: outcome.compiled,
          executed: outcome.executed,
          passed: outcome.passed,
          valid: outcome.valid,
          failureType: outcome.failureType,
          errorSummary: outcome.errorSummary,
        };
      } catch (error) {
        executionDurationMs = Date.now() - executionStart;
        const sandboxErrorSummary =
          error instanceof SandboxUnavailableError
            ? 'Sandbox no disponible.'
            : 'Falló la validación en Sandbox.';
        this.logger.warn(
          `La repetición ${context.repetition} (${context.strategy}) no pudo validarse.`,
        );
        repetitionOutcome = {
          status: 'FAILED',
          compiled: null,
          executed: null,
          passed: null,
          valid: false,
          failureType: 'INFRASTRUCTURE',
          errorSummary: sandboxErrorSummary,
        };
        externalFailure = true;
      }

      await this.recordRepetition(
        begun,
        context,
        generation,
        generationDurationMs,
        executionDurationMs,
        repetitionOutcome,
        externalFailure,
      );
      finalized = true;
      return externalFailure;
    } catch (error) {
      generationDurationMs = Date.now() - generationStart;
      const llmExternalFailure =
        error instanceof LLMProviderUnavailableError && error.externalFailure;
      externalFailure = externalFailure || llmExternalFailure;
      const unknownErrorSummary = llmExternalFailure
        ? LLM_EXTERNAL_FAILURE_SUMMARY
        : 'Falló la generación o validación de esta repetición.';
      this.logger.warn(
        `La repetición ${context.repetition} (${context.strategy}) falló.`,
      );
      if (!finalized) {
        await this.recordRepetition(
          begun,
          context,
          generation,
          generationDurationMs,
          null,
          {
            status: 'FAILED',
            compiled: null,
            executed: null,
            passed: null,
            valid: false,
            failureType: externalFailure ? 'INFRASTRUCTURE' : 'UNKNOWN',
            errorSummary: unknownErrorSummary,
          },
          externalFailure,
        );
        finalized = true;
      }
      return externalFailure;
    } finally {
      if (workspace) {
        try {
          await workspace.cleanup();
        } catch {
          this.logger.warn(
            'No se pudo limpiar el workspace temporal de una repetición.',
          );
        }
      }
    }
  }

  private async runRagArm(
    traceId: string,
    projectId: string,
    projectVersionId: string,
    target: TestTarget,
    framework: 'JEST' | 'VITEST' | null,
    config: LLMEffectiveConfig,
    budget: ExperimentBudget,
  ): Promise<GenerationOutcome> {
    const retrievalTarget: RetrievalTarget = {
      filePath: target.filePath,
      symbolName: target.symbolName,
      methodName: target.methodName,
      targetType: target.targetType as 'METHOD' | 'FUNCTION',
    };
    const retrieval = await this.retrievalService.retrieve(
      projectVersionId,
      retrievalTarget,
    );
    // Las reglas funcionales solo llegan al brazo RAG: el agente generalista no las recibe (DEC-EXP-FK-001).
    const functionalRules = await this.functionalRulesRetriever.retrieve(
      projectId,
      retrievalTarget,
    );
    const generationContext = this.contextBuilder.build(
      retrieval,
      retrievalTarget,
      { framework },
      { maxContextTokens: budget.contextTokenBudget },
      functionalRules,
    );
    await this.contextTracesRepository.updateDetail(
      traceId,
      this.makeRagDetail(generationContext),
    );
    const prompt = this.promptBuilder.build(generationContext);
    const generation = await this.llmProvider.generate(prompt, config);

    return {
      content: generation.content,
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
      retrievedChunks: generationContext.retrievedChunks,
      selectedChunks: generationContext.selectedChunks,
      contextTokens: generationContext.contextTokens,
      toolCalls: null,
      filesInspected: null,
      trajectory: undefined,
    };
  }

  /**
   * Store the contract-shaped empty detail before workspace extraction or
   * retrieval can fail. Empty arrays and counters describe only that no
   * context evidence has been observed yet; a later successful acquisition
   * replaces this skeleton with the acquired evidence.
   */
  private async initializeTraceDetail(
    traceId: string,
    context: Pick<AttemptContext, 'target' | 'framework' | 'strategy' | 'budget'>,
  ): Promise<void> {
    if (context.strategy === 'RAG') {
      const target: RetrievalTarget = {
        filePath: context.target.filePath,
        symbolName: context.target.symbolName,
        methodName: context.target.methodName,
        targetType: context.target.targetType as 'METHOD' | 'FUNCTION',
      };
      const emptyContext = this.contextBuilder.build(
        { targetChunks: [], candidates: [] },
        target,
        { framework: context.framework },
        { maxContextTokens: context.budget.contextTokenBudget },
        [],
      );
      await this.contextTracesRepository.updateDetail(
        traceId,
        this.makeRagDetail(emptyContext),
      );
      return;
    }

    await this.contextTracesRepository.updateDetail(traceId, {
      trajectory: [],
      toolCalls: 0,
      filesInspected: 0,
    });
    await this.contextTracesRepository.updateAgentCounters(traceId, {
      toolCalls: 0,
      filesInspected: 0,
    });
  }

  private async runAgentArm(
    traceId: string,
    workspaceDir: string,
    target: TestTarget,
    framework: 'JEST' | 'VITEST' | null,
    config: LLMEffectiveConfig,
    budget: ExperimentBudget,
  ): Promise<GenerationOutcome> {
    const trajectory: Prisma.InputJsonValue[] = [];
    const inspectedPaths = new Set<string>();
    let toolCalls = 0;
    let contextTokensDelivered = 0;
    let truncatedSteps = 0;
    const poolFiles = await this.fileDiscoveryService.discover(workspaceDir);
    const tools = new WorkspaceAgentTools(workspaceDir, poolFiles);
    const maxContextTokens = budget.contextTokenBudget;
    const maxToolCalls = budget.toolCallCap;
    const instructions = this.buildAgentInstructions(
      target,
      framework,
      maxContextTokens,
      maxToolCalls,
    );
    const budgetDetail = (
      capReached: boolean,
      delivered: number,
      truncated: number,
    ): Prisma.InputJsonObject => ({
      toolCallCap: maxToolCalls,
      contextTokenBudget: maxContextTokens,
      contextTokensDelivered: delivered,
      capReached,
      truncatedSteps: truncated,
    });
    const onToolStep = async (event: AgentToolStepEvent): Promise<void> => {
      const safeStep = this.safeAgentStep(event.step);
      if (event.discoveredFiles.length > 0) {
        await this.contextTracesRepository.insertDiscoveredFiles(
          traceId,
          event.step.step,
          event.discoveredFiles,
        );
      }
      trajectory.push(safeStep);
      toolCalls += 1;
      contextTokensDelivered += event.step.contextTokens;
      if (event.step.truncated) truncatedSteps += 1;
      if (
        event.step.toolName === 'read_file' &&
        typeof event.step.arguments.relativePath === 'string'
      ) {
        inspectedPaths.add(event.step.arguments.relativePath);
      }
      const filesInspected = inspectedPaths.size;
      await this.contextTracesRepository.updateDetail(traceId, {
        trajectory,
        toolCalls,
        filesInspected,
        budget: budgetDetail(
          toolCalls >= maxToolCalls,
          contextTokensDelivered,
          truncatedSteps,
        ),
      });
      await this.contextTracesRepository.updateAgentCounters(traceId, {
        toolCalls,
        filesInspected,
      });
    };
    const result = await this.generalistAgentService.generate(
      instructions,
      tools,
      { toolCallCap: maxToolCalls, contextTokenBudget: maxContextTokens },
      config,
      onToolStep,
    );
    await this.contextTracesRepository.updateDetail(traceId, {
      trajectory,
      toolCalls,
      filesInspected: inspectedPaths.size,
      budget: budgetDetail(
        result.capReached,
        result.contextTokensDelivered,
        result.truncatedSteps,
      ),
    });

    return {
      content: result.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      retrievedChunks: null,
      selectedChunks: null,
      contextTokens: null,
      toolCalls,
      filesInspected: inspectedPaths.size,
      trajectory,
    };
  }

  private buildAgentInstructions(
    target: TestTarget,
    framework: 'JEST' | 'VITEST' | null,
    maxContextTokens: number,
    maxToolCalls: number,
  ): string {
    const label = target.methodName
      ? `${target.symbolName}.${target.methodName}`
      : target.symbolName;
    const kind = target.targetType === 'METHOD' ? 'el método' : 'la función';
    const frameworkLine = framework
      ? `Usa el framework de pruebas ${framework}.`
      : 'Usa Jest o Vitest, el que ya use el proyecto (sintaxis compatible con ambos si no puedes determinarlo).';

    return [
      'Eres un ingeniero de software senior escribiendo pruebas unitarias en TypeScript.',
      `Objetivo: escribir una prueba unitaria para ${kind} "${label}", declarada en el archivo "${target.filePath}".`,
      'No se te entrega el código del objetivo directamente: debes explorarlo tú mismo usando las herramientas disponibles (list_files, read_file, search_text, inspect_symbol) antes de generar la prueba.',
      frameworkLine,
      `Tienes como máximo ${maxToolCalls} llamadas a herramientas; al alcanzar ese límite deberás responder sin más herramientas.`,
      `Presupuesto de contexto: los resultados de las herramientas suman como máximo ${maxContextTokens} tokens en total; lo que exceda se trunca y queda marcado como truncado.`,
      'Cuando tengas suficiente información, responde ÚNICAMENTE con código TypeScript válido (imports + bloques de prueba). No incluyas explicaciones ni envuelvas la respuesta en fences de markdown.',
    ].join('\n\n');
  }

  private makeRagDetail(
    generationContext: GenerationContext,
  ): Prisma.InputJsonValue {
    const audit = generationContext.audit;
    if (!audit) {
      throw new Error('ContextBuilder no produjo evidencia para la traza RAG.');
    }

    const targetChunks = audit.target.chunks;
    const firstTargetChunk = targetChunks[0];
    const combinedTargetContent = targetChunks
      .map((chunk) => chunk.content)
      .join('\n\n');
    const targetExcerpt = this.makeSourceExcerpt(
      combinedTargetContent,
      firstTargetChunk
        ? {
            filePath: firstTargetChunk.filePath,
            symbolName: firstTargetChunk.symbolName,
            parentSymbolName: firstTargetChunk.parentSymbolName,
            startLine: Math.min(
              ...targetChunks.map((chunk) => chunk.startLine),
            ),
            endLine: Math.max(...targetChunks.map((chunk) => chunk.endLine)),
          }
        : {
            filePath: generationContext.target.filePath,
            symbolName: generationContext.target.symbolName,
            parentSymbolName: null,
            startLine: null,
            endLine: null,
          },
    );

    return {
      target: {
        chunkIds: audit.target.chunkIds,
        excerpt: targetExcerpt,
        tokenCount: audit.target.tokenCount,
      },
      candidates: audit.candidates.map((candidate) => ({
        chunkId: candidate.chunkId,
        rank: candidate.rank,
        excerpt: this.makeSourceExcerpt(candidate.content, candidate),
        tokenCount: candidate.tokenCount,
        semanticScore: candidate.semanticScore,
        structuralMatch: candidate.structuralMatch,
        combinedScore: candidate.combinedScore,
        matchedVia: candidate.matchedVia,
        decision: candidate.decision,
        discardReason: candidate.discardReason,
      })),
      retrievedChunks: generationContext.retrievedChunks,
      selectedChunks: generationContext.selectedChunks,
      contextTokens: generationContext.contextTokens,
      configuration: audit.configuration,
    } as Prisma.InputJsonValue;
  }

  private makeSourceExcerpt(
    content: string,
    location: {
      filePath: string;
      symbolName: string | null;
      parentSymbolName: string | null;
      startLine: number | null;
      endLine: number | null;
    },
  ): {
    filePath: string;
    symbolName: string | null;
    parentSymbolName: string | null;
    startLine: number | null;
    endLine: number | null;
    snippet: string;
    contentSha256: string;
    truncated: boolean;
  } {
    const maxSnippetChars = 2000;
    if (!this.isSafeRelativePath(location.filePath)) {
      throw new Error('ContextTrace requiere una ruta relativa segura.');
    }
    return {
      filePath: location.filePath,
      symbolName: location.symbolName,
      parentSymbolName: location.parentSymbolName,
      startLine: location.startLine,
      endLine: location.endLine,
      snippet: content.slice(0, maxSnippetChars),
      contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      truncated: content.length > maxSnippetChars,
    };
  }

  private safeAgentStep(step: AgentTrajectoryStep): Prisma.InputJsonObject {
    const args = { ...step.arguments };
    if (
      typeof args.relativePath === 'string' &&
      !this.isSafeRelativePath(args.relativePath)
    ) {
      args.relativePath = '[ruta rechazada]';
    }
    const observations = step.observations.map((observation) => {
      const excerpt =
        observation.excerpt &&
        this.isSafeRelativePath(observation.excerpt.filePath)
          ? {
              filePath: observation.excerpt.filePath,
              symbolName: observation.excerpt.symbolName,
              parentSymbolName: observation.excerpt.parentSymbolName,
              startLine: observation.excerpt.startLine,
              endLine: observation.excerpt.endLine,
              snippet: observation.excerpt.snippet.slice(0, 2000),
              contentSha256: observation.excerpt.contentSha256,
              truncated: observation.excerpt.truncated,
            }
          : null;

      return {
        kind: observation.kind,
        filePath:
          observation.filePath && this.isSafeRelativePath(observation.filePath)
            ? observation.filePath
            : null,
        symbolName: observation.symbolName,
        excerpt,
        discoveredFilesCount: observation.discoveredFilesCount,
      };
    });

    return {
      step: step.step,
      toolName: step.toolName,
      arguments: args,
      status: step.status,
      resultSummary: this.describeAgentResult(step, args),
      resultSha256: step.resultSha256,
      truncated: step.truncated,
      contextTokens: step.contextTokens,
      truncationReason: step.truncationReason,
      observations,
    } as Prisma.InputJsonObject;
  }

  private describeAgentResult(
    step: AgentTrajectoryStep,
    args: Record<string, unknown>,
  ): string {
    if (step.status === 'FAILED') return 'No se pudo completar la herramienta.';
    if (step.toolName === 'list_files') {
      const count =
        step.observations.find((item) => item.kind === 'FILE_LIST_SUMMARY')
          ?.discoveredFilesCount ?? 0;
      return `Listado disponible: ${count} archivos.`;
    }
    if (step.toolName === 'search_text') {
      const matches = step.observations.filter(
        (item) => item.kind === 'TEXT_MATCH',
      );
      const files = new Set(
        matches.map((item) => item.filePath).filter(Boolean),
      );
      return matches.length === 0
        ? 'No se encontraron coincidencias.'
        : `Se observaron ${matches.length} coincidencias en ${files.size} archivos.`;
    }
    if (step.toolName === 'inspect_symbol') {
      const found = step.observations.find((item) => item.kind === 'SYMBOL');
      if (!found) return 'No se encontró el símbolo solicitado.';
      const symbol = found.symbolName ?? 'Símbolo';
      const location = found.filePath ? ` en ${found.filePath}` : '';
      return `${symbol} inspeccionado${location}.`;
    }
    const filePath =
      (typeof args.relativePath === 'string' &&
      this.isSafeRelativePath(args.relativePath)
        ? args.relativePath
        : null) ??
      step.observations.find((item) => item.kind === 'FILE_CONTENT')
        ?.filePath ??
      'archivo';
    const excerpt = step.observations.find(
      (item) => item.kind === 'FILE_CONTENT',
    )?.excerpt;
    const lines =
      excerpt?.startLine !== null && excerpt?.startLine !== undefined
        ? ` (líneas ${excerpt.startLine}-${excerpt.endLine ?? excerpt.startLine})`
        : '';
    return step.status === 'EMPTY'
      ? `No se observó contenido en ${filePath}.`
      : `Contenido observado en ${filePath}${lines}.`;
  }

  private isSafeRelativePath(filePath: string): boolean {
    return (
      filePath.length > 0 &&
      !filePath.startsWith('/') &&
      !filePath.includes('\\') &&
      !filePath
        .split('/')
        .some(
          (segment) => segment === '.' || segment === '..' || segment === '',
        )
    );
  }

  private async recordRepetition(
    begun: BegunContextTraceAttempt,
    context: {
      experimentId: string;
      strategy: Strategy;
      repetition: number;
      attempt: 1 | 2;
    },
    generation: GenerationOutcome,
    generationDurationMs: number,
    executionDurationMs: number | null,
    outcome: {
      status: 'VALID' | 'INVALID' | 'FAILED';
      compiled: boolean | null;
      executed: boolean | null;
      passed: boolean | null;
      valid: boolean | null;
      failureType: FailureTypeValue | null;
      errorSummary: string | null;
    },
    externalFailure: boolean,
  ): Promise<void> {
    const totalTokens =
      generation.inputTokens !== null && generation.outputTokens !== null
        ? generation.inputTokens + generation.outputTokens
        : null;
    const estimatedCost = estimateCost(
      generation.inputTokens,
      generation.outputTokens,
      {
        inputCostPer1kTokens: this.configService.get<number>(
          'LLM_INPUT_COST_PER_1K_TOKENS',
          0.00015,
        ),
        outputCostPer1kTokens: this.configService.get<number>(
          'LLM_OUTPUT_COST_PER_1K_TOKENS',
          0.0006,
        ),
      },
    );

    const input: ExperimentRepetitionInput = {
      repetition: context.repetition,
      strategy: context.strategy,
      compiled: outcome.compiled,
      executed: outcome.executed,
      passed: outcome.passed,
      valid: outcome.valid,
      failureType: outcome.failureType,
      errorSummary: outcome.errorSummary,
      generationDurationMs,
      executionDurationMs,
      totalDurationMs: generationDurationMs + (executionDurationMs ?? 0),
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
      totalTokens,
      estimatedCost,
      retrievedChunks: generation.retrievedChunks,
      selectedChunks: generation.selectedChunks,
      contextTokens: generation.contextTokens,
      toolCalls: generation.toolCalls,
      filesInspected: generation.filesInspected,
      trajectory: undefined,
      // Segundo fallo externo: la repetición no es evaluable técnicamente (plan punto 7).
      ...(context.attempt === 2 && externalFailure ? { technicallyEvaluable: false } : {}),
    };

    const terminalState = outcome.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
    await this.experimentRunsRepository.updateRepetitionById(
      begun.repetition.id,
      input,
      terminalState,
    );
    if (terminalState === 'FAILED') {
      await this.contextTracesRepository.failTrace(begun.trace.id);
    } else {
      await this.contextTracesRepository.finishTrace(begun.trace.id);
    }
    await this.contextTracesRepository.finishRepetition(
      begun.repetition.id,
      terminalState,
    );
    await this.experimentRunsRepository.refreshCompletedRepetitions(
      context.experimentId,
    );
  }
}
