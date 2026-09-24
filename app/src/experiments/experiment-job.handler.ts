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
import type { RetrievalTarget } from '../retrieval/generation-context.js';
import { PromptBuilder } from '../generation/prompt-builder.service.js';
import {
  TestFileMergeService,
  coLocatedSpecPath,
} from '../generation/test-file-merge.service.js';
import { LLM_PROVIDER } from '../providers/providers.constants.js';
import type { LLMProvider } from '../providers/llm-provider.interface.js';
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
  type FailureTypeValue,
} from '../sandbox/map-sandbox-result.js';
import { sandboxExperimentRequestId } from '../sandbox/sandbox-request-id.util.js';
import { estimateCost } from './cost-calculator.js';
import {
  ExperimentRunsRepository,
  type ExperimentRepetitionInput,
} from './persistence/experiment-runs.repository.js';
import { ExperimentStatus } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { TestTarget } from '../generated/prisma/client.js';
import { ContextTracesRepository } from '../context-traces/context-traces.repository.js';
import type { BegunContextTraceAttempt } from '../context-traces/context-traces.repository.js';
import type { GenerationContext } from '../retrieval/generation-context.js';

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

      const snapshotKey = version.snapshotKey;
      const snapshotBuffer = await this.objectStorageService.get(snapshotKey);
      const runs = STRATEGIES.flatMap((strategy) =>
        Array.from({ length: REPETITIONS_PER_STRATEGY }, (_, i) => ({
          strategy,
          repetition: i + 1,
        })),
      );
      const concurrency = this.configService.get<number>(
        'EXPERIMENT_REPETITION_CONCURRENCY',
        3,
      );

      await runWithConcurrencyLimit(
        runs,
        concurrency,
        ({ strategy, repetition }) =>
          this.runRepetition({
            jobId,
            experimentId: payload.experimentId,
            projectId: payload.projectId,
            projectVersionId: payload.projectVersionId,
            snapshotKey,
            snapshotBuffer,
            framework: version.detectedFramework,
            target,
            strategy,
            repetition,
          }),
      );

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

  private async runRepetition(context: {
    jobId: string;
    experimentId: string;
    projectId: string;
    projectVersionId: string;
    snapshotKey: string;
    snapshotBuffer: Buffer;
    framework: 'JEST' | 'VITEST' | null;
    target: TestTarget;
    strategy: Strategy;
    repetition: number;
  }): Promise<void> {
    const begun = await this.contextTracesRepository.beginAttempt({
      experimentId: context.experimentId,
      projectId: context.projectId,
      projectVersionId: context.projectVersionId,
      targetId: context.target.id,
      strategy: context.strategy,
      kind: context.strategy === 'RAG' ? 'RAG' : 'AGENT',
      repetition: context.repetition,
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
    let finalized = false;

    try {
      await this.initializeTraceDetail(begun.trace.id, context);
      workspace = await this.zipExtractionService.extract(
        context.snapshotBuffer,
      );
      const timeoutMs = this.configService.get<number>(
        'GENERATION_TIMEOUT_MS',
        120_000,
      );

      generation =
        context.strategy === 'RAG'
          ? await withTimeout(
              this.runRagArm(
                begun.trace.id,
                context.projectVersionId,
                context.target,
                context.framework,
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
        );
        finalized = true;
        return;
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
        });
        executionDurationMs = Date.now() - executionStart;
        const outcome = mapSandboxResult(sandboxResult);

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
      }

      await this.recordRepetition(
        begun,
        context,
        generation,
        generationDurationMs,
        executionDurationMs,
        repetitionOutcome,
      );
      finalized = true;
    } catch {
      generationDurationMs = Date.now() - generationStart;
      const unknownErrorSummary =
        'Falló la generación o validación de esta repetición.';
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
            failureType: 'UNKNOWN',
            errorSummary: unknownErrorSummary,
          },
        );
        finalized = true;
      }
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
    projectVersionId: string,
    target: TestTarget,
    framework: 'JEST' | 'VITEST' | null,
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
    const generationContext = this.contextBuilder.build(
      retrieval,
      retrievalTarget,
      { framework },
    );
    await this.contextTracesRepository.updateDetail(
      traceId,
      this.makeRagDetail(generationContext),
    );
    const prompt = this.promptBuilder.build(generationContext);
    const generation = await this.llmProvider.generate(prompt);

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
    context: {
      target: TestTarget;
      framework: 'JEST' | 'VITEST' | null;
      strategy: Strategy;
    },
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
  ): Promise<GenerationOutcome> {
    const trajectory: Prisma.InputJsonValue[] = [];
    const inspectedPaths = new Set<string>();
    let toolCalls = 0;
    const poolFiles = await this.fileDiscoveryService.discover(workspaceDir);
    const tools = new WorkspaceAgentTools(
      workspaceDir,
      poolFiles,
      target.testFilePaths,
    );
    const maxContextTokens = this.configService.get<number>(
      'RETRIEVAL_MAX_CONTEXT_TOKENS',
      6000,
    );
    const maxToolCalls = this.configService.get<number>(
      'AGENT_MAX_TOOL_CALLS',
      20,
    );
    const instructions = this.buildAgentInstructions(
      target,
      framework,
      maxContextTokens,
    );
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
      });
      await this.contextTracesRepository.updateAgentCounters(traceId, {
        toolCalls,
        filesInspected,
      });
    };
    const result = await this.generalistAgentService.generate(
      instructions,
      tools,
      maxToolCalls,
      onToolStep,
    );

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
      `Presupuesto orientativo de contexto: no excedas lo estrictamente necesario para escribir una prueba correcta (referencia comparable a la estrategia RAG: ~${maxContextTokens} tokens de contexto).`,
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
    context: { experimentId: string; strategy: Strategy; repetition: number },
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
