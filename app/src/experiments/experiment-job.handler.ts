import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ConfigService } from '@nestjs/config';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { TestTargetsRepository } from '../project-versions/persistence/test-targets.repository.js';
import { FileDiscoveryService } from '../project-versions/discovery/file-discovery.service.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { ZipExtractionService, type ExtractedWorkspace } from '../project-versions/zip/zip-extraction.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { FunctionalRulesRetriever } from '../retrieval/functional-rules.retriever.js';
import { PhpDependencyContextService } from '../retrieval/php-dependency-context.service.js';
import { PromptBuilder, sanitizeGeneratedPhp } from '../generation/prompt-builder.service.js';
import { phpTestLocation, type PhpTestLocation } from '../generation/php-test-path.js';
import { TestFileMergeService, coLocatedSpecPath } from '../generation/test-file-merge.service.js';
import { LLM_PROVIDER } from '../providers/providers.constants.js';
import type { LLMEffectiveConfig, LLMProvider } from '../providers/llm-provider.interface.js';
import { WorkspaceAgentTools } from '../generation/agent/workspace-agent-tools.js';
import { GeneralistAgentService, type AgentToolStepEvent } from '../generation/agent/generalist-agent.service.js';
import { SandboxAcceptedExecutionError, SandboxExecutionService, SandboxUnavailableError, DEFAULT_MAX_POLL_ATTEMPTS, DEFAULT_REQUEST_TIMEOUT_MS } from '../sandbox/sandbox-execution.service.js';
import { toAcceptedSandboxEvidence, toSandboxExecutionEvidence, type SandboxExecutionEvidence } from '../sandbox/sandbox-evidence-facts.js';
import { mapSandboxResult, type FailureTypeValue } from '../sandbox/map-sandbox-result.js';
import { sandboxExperimentRequestId } from '../sandbox/sandbox-request-id.util.js';
import { buildRepetitionArtifact, buildSandboxEvidenceArtifact, type RepetitionArtifact } from './repetition-artifact.js';
import { RescheduleJobError } from '../jobs/reschedule-job.error.js';
import { remainingUntilExpiryMs, resolveHeartbeatStaleMs, resolveSlotAction, sandboxHttpBoundMs, type SlotAction } from './attempt-recovery.js';
import { estimateCost } from './cost-calculator.js';
import { toExperimentRepetitionFailure, type ExperimentRepetitionFailure } from './experiment-failure-fact.js';
import { ExperimentRunsRepository, type ExperimentBudget, type ExperimentRepetitionInput } from './persistence/experiment-runs.repository.js';
import { ExperimentRepetitionState, ExperimentStatus } from '../generated/prisma/enums.js';
import type { Prisma, ExperimentRepetition, TestTarget } from '../generated/prisma/client.js';
import { ContextTracesRepository, type BegunContextTraceAttempt } from '../context-traces/context-traces.repository.js';
import { DEFAULT_AGENT_MAX_TOOL_CALLS, DEFAULT_EXPERIMENT_HEARTBEAT_INTERVAL_MS, DEFAULT_GENERATION_TIMEOUT_MS, DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS } from '../config/generation-budget.defaults.js';
import { LLMProviderUnavailableError } from '../providers/llm-provider-unavailable.error.js';
import { buildAgentInstructions, makeRagDetail, safeAgentStep } from './experiment-attempt-presenters.js';
import { Strategy, SlotIdentity, RunContext, AttemptContext, LLM_EXTERNAL_FAILURE_SUMMARY, withTimeout, parseEffectiveConfig, runWithConcurrencyLimit, slotKey, buildPairSchedule, buildLegacySchedule, INTERRUPTED_ATTEMPT_SUMMARY, parseRunnerHint, parseExecutionProfile, RepetitionArtifactRecord, promptDigest, GenerationOutcome, RepetitionEvidence, toRetrievalTarget } from './experiment-job.helpers.js';

export interface ExperimentJobPayload {
  experimentId: string;
  projectId: string;
  projectVersionId: string;
  targetId: string;
}

export const EXPERIMENT_JOB_TYPE = 'experiment-run';
/** `failureCode` del run cuando el job agota sus intentos por un worker caído (WI-CORE-030). */
export const EXPERIMENT_WORKER_LOST_FAILURE_CODE = 'EXPERIMENT_WORKER_LOST';

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
    private readonly phpDependencyContextService: PhpDependencyContextService,
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
      const budget = this.resolveBudget(run.budget);
      const staleMs = this.heartbeatStaleMs(budget);
      // Último intento por slot: decide qué se omite, reanuda o reprograma al reentrar el job.
      const latestBySlot = new Map(
        (
          await this.experimentRunsRepository.findRepetitions(
            payload.experimentId,
          )
        ).map((row) => [slotKey(row.strategy, row.repetition), row] as const),
      );
      const latestOf = (slot: SlotIdentity) =>
        latestBySlot.get(slotKey(slot.strategy, slot.repetition));
      const pairSchedule = run.randomizationSeed
        ? buildPairSchedule(payload.experimentId, run.randomizationSeed)
        : null;

      if (pairSchedule) {
        // Antes de tocar nada: si algún intento tiene latido vigente, no se duplica ni se cierra nada.
        this.assertNoInFlightAttempt(
          pairSchedule.flat().map((slot) => latestOf(slot)),
          staleMs,
        );
      }

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
      // WI-CORE-029: el lenguaje viaja en el contexto del run; el runner persistido decide el framework.
      const language: 'php' | 'typescript' =
        version.language === 'PHP' ? 'php' : 'typescript';

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
        language,
        projectRoot: version.effectiveProjectRoot,
        target,
        config,
        budget,
        executionProfile: parseExecutionProfile(run.executionProfile),
      };
      const concurrency = this.configService.get<number>(
        'EXPERIMENT_REPETITION_CONCURRENCY',
        3,
      );

      if (pairSchedule) {
        // OE5 pareado: los pares 1..3 corren con concurrencia limitada; dentro de cada par
        // las dos posiciones son estrictamente secuenciales y el reintento va antes de la siguiente.
        await runWithConcurrencyLimit(
          pairSchedule,
          concurrency,
          async (pair) => {
            for (const slot of pair) {
              await this.runSlot(runContext, slot, latestOf(slot), staleMs);
            }
          },
        );
      } else {
        // Experimentos creados antes de WI-CORE-025 (sin semilla): sin orden pareado y sin
        // reintento externo; cada slot tiene un único intento (ver runLegacySlot).
        await runWithConcurrencyLimit(
          buildLegacySchedule(),
          concurrency,
          (slot) => this.runLegacySlot(runContext, slot, latestOf(slot)),
        );
      }

      await this.experimentRunsRepository.complete(payload.experimentId);
    } catch (error) {
      // Reprogramación por latido vigente: el experimento sigue en curso, no es un fallo (no FAILED).
      if (error instanceof RescheduleJobError) {
        throw error;
      }
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
   * Gancho de cierre (WI-CORE-030, DEC-JOBS-001): el job agotó sus intentos sin que `handle()` pudiera
   * cerrar el experimento (worker caído, o liberación sin ejecución). Cierra las repeticiones RUNNING
   * huérfanas (sin reintento posterior, así que no son evaluables) y, si el run no es ya terminal,
   * lo marca FAILED con `EXPERIMENT_WORKER_LOST`. Nunca reprograma ni reejecuta un intento.
   */
  async onExhausted(
    payload: ExperimentJobPayload,
    reason: string,
  ): Promise<void> {
    const orphans = (
      await this.experimentRunsRepository.findRepetitions(payload.experimentId)
    ).filter((row) => row.state === ExperimentRepetitionState.RUNNING);

    for (const row of orphans) {
      await this.experimentRunsRepository.closeInterruptedRepetition(row.id, {
        errorSummary: row.errorSummary ?? INTERRUPTED_ATTEMPT_SUMMARY,
        technicallyEvaluable: false,
      });
    }
    if (orphans.length > 0) {
      await this.experimentRunsRepository.refreshCompletedRepetitions(
        payload.experimentId,
      );
    }

    // Un run ya FAILED conserva su código real (p. ej. EXPERIMENT_FAILED de un error de handle()).
    const run = await this.experimentRunsRepository.findById(
      payload.experimentId,
    );
    if (
      !run ||
      run.status === ExperimentStatus.COMPLETED ||
      run.status === ExperimentStatus.FAILED
    ) {
      return;
    }

    await this.experimentRunsRepository.markFailed(
      payload.experimentId,
      EXPERIMENT_WORKER_LOST_FAILURE_CODE,
      reason,
    );
  }

  /**
   * Presupuesto persistido al crear el experimento (WI-CORE-025). Corridas previas sin
   * `budget` usan el entorno actual; nunca se regenera aquí.
   */
  private resolveBudget(raw: unknown): ExperimentBudget {
    if (raw === null || raw === undefined) {
      return {
        toolCallCap: this.configService.get<number>(
          'AGENT_MAX_TOOL_CALLS',
          DEFAULT_AGENT_MAX_TOOL_CALLS,
        ),
        contextTokenBudget: this.configService.get<number>(
          'RETRIEVAL_MAX_CONTEXT_TOKENS',
          DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS,
        ),
        maxDurationMs: this.configService.get<number>(
          'GENERATION_TIMEOUT_MS',
          DEFAULT_GENERATION_TIMEOUT_MS,
        ),
      };
    }

    const candidate = raw as Partial<Record<keyof ExperimentBudget, unknown>>;
    if (
      typeof raw !== 'object' ||
      typeof candidate.toolCallCap !== 'number' ||
      typeof candidate.contextTokenBudget !== 'number' ||
      typeof candidate.maxDurationMs !== 'number'
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
    staleMs: number,
  ): Promise<void> {
    const action = resolveSlotAction(latest, Date.now(), staleMs);
    await this.applySlotAction(context, slot, action, staleMs);
  }

  /**
   * Ejecuta la decisión de `resolveSlotAction` (WI-CORE-025 (3c)). Nunca crea un tercer intento:
   * el intento 2 solo se cierra cuando su latido venció.
   */
  private async applySlotAction(
    context: RunContext,
    slot: SlotIdentity,
    action: SlotAction<ExperimentRepetition>,
    staleMs: number,
  ): Promise<void> {
    switch (action.kind) {
      case 'SKIP':
        return;
      case 'IN_FLIGHT':
        throw this.liveAttemptReschedule([action.row], Date.now(), staleMs);
      case 'CLOSE_EXPIRED_SECOND':
        await this.closeInterruptedAttempt(context.experimentId, action.row, 2);
        return;
      case 'RUN': {
        if (action.expiredAttempt) {
          await this.closeInterruptedAttempt(
            context.experimentId,
            action.expiredAttempt,
            1,
          );
        }
        const externalFailure = await this.runAttempt({
          ...context,
          ...slot,
          attempt: action.attempt,
        });
        if (action.attempt === 1 && externalFailure) {
          await this.runAttempt({ ...context, ...slot, attempt: 2 });
        }
        return;
      }
    }
  }

  /** Cierra un intento cuyo latido venció y recalcula el contador de slots terminales. */
  private async closeInterruptedAttempt(
    experimentId: string,
    row: ExperimentRepetition,
    attempt: 1 | 2,
  ): Promise<void> {
    await this.experimentRunsRepository.closeInterruptedRepetition(row.id, {
      errorSummary: row.errorSummary ?? INTERRUPTED_ATTEMPT_SUMMARY,
      // Solo el intento 2 queda sin evaluación técnica: el 1 todavía deja paso al reintento.
      ...(attempt === 2 ? { technicallyEvaluable: false as const } : {}),
    });
    await this.experimentRunsRepository.refreshCompletedRepetitions(
      experimentId,
    );
    this.logger.warn(
      `Intento ${attempt} interrumpido (latido vencido) de un slot pareado.`,
    );
  }

  /**
   * Si algún último intento está RUNNING con latido vigente, el job se reprograma sin tocar nada
   * (WI-CORE-025 (3c), punto iii). Solo se consideran slots pareados.
   */
  private assertNoInFlightAttempt(
    latestRows: Array<ExperimentRepetition | undefined>,
    staleMs: number,
  ): void {
    const nowMs = Date.now();
    const inFlight = latestRows.flatMap((latest) => {
      const action = resolveSlotAction(latest, nowMs, staleMs);
      return action.kind === 'IN_FLIGHT' ? [action.row] : [];
    });
    if (inFlight.length > 0) {
      throw this.liveAttemptReschedule(inFlight, nowMs, staleMs);
    }
  }

  /**
   * Reprograma el job sin consumir un intento (RescheduleJobError, JobsService) para reintentarlo
   * cuando el latido vigente más cercano pueda haber vencido, sin esperar menos que el intervalo.
   */
  private liveAttemptReschedule(
    rows: ExperimentRepetition[],
    nowMs: number,
    staleMs: number,
  ): RescheduleJobError {
    const intervalMs = this.heartbeatIntervalMs();
    const untilExpiryMs = Math.min(
      ...rows.map((row) => remainingUntilExpiryMs(row, nowMs, staleMs)),
    );
    return new RescheduleJobError(
      Math.min(staleMs, Math.max(intervalMs, untilExpiryMs)),
      'Hay una repetición pareada de este experimento con latido vigente; el job se reintenta más tarde.',
    );
  }

  private heartbeatIntervalMs(): number {
    return this.configService.get<number>(
      'EXPERIMENT_HEARTBEAT_INTERVAL_MS',
      DEFAULT_EXPERIMENT_HEARTBEAT_INTERVAL_MS,
    );
  }

  /** Umbral de vencimiento del latido para este run (WI-CORE-025 (3c), punto iv). */
  private heartbeatStaleMs(budget: ExperimentBudget): number {
    return resolveHeartbeatStaleMs({
      configuredMs: this.configService.get<number | undefined>(
        'EXPERIMENT_HEARTBEAT_STALE_MS',
      ),
      intervalMs: this.heartbeatIntervalMs(),
      generationTimeoutMs: budget.maxDurationMs,
      sandboxHttpBoundMs: sandboxHttpBoundMs(
        this.configService.get<number>(
          'SANDBOX_REQUEST_TIMEOUT_MS',
          DEFAULT_REQUEST_TIMEOUT_MS,
        ),
        this.configService.get<number>(
          'SANDBOX_MAX_POLL_ATTEMPTS',
          DEFAULT_MAX_POLL_ATTEMPTS,
        ),
      ),
    });
  }

  /**
   * Latido de un intento mientras corre: un temporizador con `unref` que renueva
   * `lastHeartbeatAt`. Devuelve la función que lo detiene (se llama en el `finally` del intento).
   * Un fallo al escribir el latido se registra y no interrumpe la generación.
   */
  private startHeartbeat(repetitionId: string): () => void {
    const timer = setInterval(() => {
      void Promise.resolve()
        .then(() =>
          this.experimentRunsRepository.touchRepetitionHeartbeat(
            repetitionId,
            new Date(),
          ),
        )
        .catch(() => {
          this.logger.warn(
            'No se pudo renovar el latido de una repetición en curso.',
          );
        });
    }, this.heartbeatIntervalMs());
    timer.unref?.();

    return () => clearInterval(timer);
  }

  /**
   * Slot de un experimento sin semilla (creado antes de WI-CORE-025): un único intento, sin
   * reintento externo y sin identidad de par. Si ya existe cualquier intento para el slot
   * (redelivery), se omite: no se crea un intento nuevo.
   */
  private async runLegacySlot(
    context: RunContext,
    slot: SlotIdentity,
    latest: ExperimentRepetition | undefined,
  ): Promise<void> {
    if (latest) return;

    await this.runAttempt({ ...context, ...slot, attempt: 1 });
  }

  /** Devuelve true si el intento terminó en fallo externo (plan punto 6). */
  private async runAttempt(context: AttemptContext): Promise<boolean> {
    // WI-CORE-060: inicio del intento, antes de generar; se persiste como startedAt de la escritura terminal.
    const attemptStartedAt = new Date();
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
    // Latido mientras el intento corre; se detiene en el `finally` (WI-CORE-025 (3c)).
    const stopHeartbeat = this.startHeartbeat(begun.repetition.id);
    let workspace: ExtractedWorkspace | undefined;
    const generationStart = Date.now();
    let generationDurationMs = 0;
    let generation: GenerationOutcome = {
      content: '',
      promptSha256: null,
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
    // WI-CORE-027: evidencia del Sandbox y hash del contenido enviado; null mientras no haya invocación.
    let sandboxEvidence: SandboxExecutionEvidence | null = null;
    let artifactHash: string | null = null;
    // WI-CORE-053: artefacto interno de la repetición; null salvo en los caminos que enviaron contenido.
    let artifact: RepetitionArtifactRecord | null = null;

    try {
      await this.initializeTraceDetail(begun.trace.id, context);
      workspace = await this.zipExtractionService.extract(
        context.snapshotBuffer,
      );
      const workspaceDir = workspace.dir;
      const timeoutMs = context.budget.maxDurationMs;
      // WI-CORE-029: PHP usa la ubicación DEC-PHP-GEN-001 (archivo nuevo); TypeScript conserva la suya.
      const phpPlacement =
        context.language === 'php'
          ? phpTestLocation(
              toRetrievalTarget(context.target),
              (candidate) => existsSync(join(workspaceDir, candidate)),
              context.projectRoot,
            )
          : null;

      generation =
        context.strategy === 'RAG'
          ? await withTimeout(
              this.runRagArm(
                begun.trace.id,
                context.projectId,
                context.projectVersionId,
                context.target,
                context.framework,
                context.language,
                phpPlacement,
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
                phpPlacement,
                context.config,
                context.budget,
              ),
              timeoutMs,
              'La generación del agente generalista agotó el tiempo límite.',
            );

      generationDurationMs = Date.now() - generationStart;
      // TypeScript: ruta co-ubicada o la del primer test existente, con fusión. PHP: archivo nuevo, sin leer ni fusionar.
      const relativePath = phpPlacement
        ? phpPlacement.relativePath
        : context.target.hasTest && context.target.testFilePaths.length > 0
          ? context.target.testFilePaths[0]
          : coLocatedSpecPath(context.target.filePath);
      const existingContent = phpPlacement
        ? null
        : await readFile(join(workspace.dir, relativePath), 'utf8').catch(
            () => null,
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
              context.language === 'php'
                ? 'No se pudo determinar el framework de test (PHPUnit) durante la indexación.'
                : 'No se pudo determinar el framework de test (Jest/Vitest) durante la indexación.',
          },
          false,
          false,
          null,
          { sandbox: null, artifactHash: null, artifact: null, startedAt: attemptStartedAt },
        );
        finalized = true;
        return false;
      }

      let mergedContent: string;
      if (phpPlacement) {
        const phpContent = sanitizeGeneratedPhp(generation.content);
        if (phpContent === null) {
          // Resultado técnico desfavorable de la estrategia (no fallo externo): sin Sandbox y sin reintento.
          await this.recordRepetition(
            begun,
            context,
            generation,
            generationDurationMs,
            null,
            {
              status: 'INVALID',
              compiled: false,
              executed: false,
              passed: false,
              valid: false,
              failureType: 'COMPILATION',
              errorSummary:
                'La respuesta del modelo no es un archivo PHP (no empieza con <?php).',
            },
            false,
            false,
            null,
            { sandbox: null, artifactHash: null, artifact: null, startedAt: attemptStartedAt },
          );
          finalized = true;
          return false;
        }
        mergedContent = `${phpContent}\n`;
      } else {
        mergedContent =
          existingContent === null
            ? this.testFileMergeService.applyCreate(generation.content)
            : this.testFileMergeService.applyMerge(
                existingContent,
                generation.content,
              );
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
      let sandboxTimedOut = false;
      // WI-CORE-007: hecho de fallo saneado solo cuando el Sandbox lo devuelve en un resultado no COMPLETED.
      let sandboxFailure: ExperimentRepetitionFailure | null = null;

      try {
        // WI-CORE-027: mismo contenido que se envía al Sandbox; sin contenido generado no hay artefacto.
        artifactHash =
          generation.content.trim().length > 0
            ? createHash('sha256').update(mergedContent, 'utf8').digest('hex')
            : null;
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
          ...(context.language === 'php'
            ? { projectRoot: context.projectRoot }
            : {}),
        });
        executionDurationMs = Date.now() - executionStart;
        const outcome = mapSandboxResult(sandboxResult);
        artifact =
          generation.content.trim().length > 0
            ? this.safeBuildArtifact(mergedContent, sandboxResult, context)
            : null;
        sandboxEvidence = toSandboxExecutionEvidence(
          sandboxResult,
          outcome.failureType,
        );
        // TIMED_OUT es fallo de la prueba generada, no externo: se persiste con la columna interna.
        sandboxTimedOut = sandboxResult.status === 'TIMED_OUT';
        sandboxFailure =
          sandboxResult.status === 'COMPLETED'
            ? null
            : toExperimentRepetitionFailure(sandboxResult.failure);
        // Fallo externo del Sandbox: INFRASTRUCTURE salvo timeout (no es externo, WI-CORE-025).
        externalFailure =
          outcome.status === 'FAILED' &&
          outcome.failureType === 'INFRASTRUCTURE' &&
          !sandboxTimedOut;

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
        // Cualquier excepción del cliente de Sandbox se trata como infraestructura (fallo externo con
        // un único reintento), sea SandboxUnavailableError u otro error (red, respuesta inesperada).
        // Decisión del usuario, WI-CORE-025 (2).
        executionDurationMs = Date.now() - executionStart;
        // WI-CORE-027: una ejecución aceptada que no llegó a resultado conserva su executionId y sus ids.
        if (error instanceof SandboxAcceptedExecutionError) {
          sandboxEvidence = toAcceptedSandboxEvidence(error);
        }
        // WI-CORE-053: el contenido ya se envió (artifactHash calculado): se persiste sin informe del Sandbox.
        if (artifactHash !== null) {
          artifact = this.safeBuildArtifact(mergedContent, null, context);
        }
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
        sandboxTimedOut,
        sandboxFailure,
        { sandbox: sandboxEvidence, artifactHash, artifact, startedAt: attemptStartedAt },
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
          false,
          null,
          { sandbox: sandboxEvidence, artifactHash, artifact, startedAt: attemptStartedAt },
        );
        finalized = true;
      }
      return externalFailure;
    } finally {
      stopHeartbeat();
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
    framework: 'JEST' | 'VITEST' | 'PHPUNIT' | null,
    language: 'php' | 'typescript',
    placement: PhpTestLocation | null,
    config: LLMEffectiveConfig,
    budget: ExperimentBudget,
  ): Promise<GenerationOutcome> {
    const retrievalTarget = toRetrievalTarget(target);
    const retrieval = await this.retrievalService.retrieve(
      projectVersionId,
      retrievalTarget,
    );
    // Las reglas funcionales solo llegan al brazo RAG: el agente generalista no las recibe (DEC-EXP-FK-001).
    const functionalRules = await this.functionalRulesRetriever.retrieve(
      projectId,
      retrievalTarget,
    );
    // WI-CORE-057: dependencias FQCN del target PHP; null fuera de PHP o sin entradas.
    const dependencyContext = await this.phpDependencyContextService.resolve(
      projectVersionId,
      retrieval.targetChunks,
      language,
    );
    const generationContext = this.contextBuilder.build(
      retrieval,
      retrievalTarget,
      { framework, language },
      { maxContextTokens: budget.contextTokenBudget },
      functionalRules,
      dependencyContext,
    );
    await this.contextTracesRepository.updateDetail(
      traceId,
      makeRagDetail(generationContext),
    );
    const prompt = placement
      ? this.promptBuilder.build(generationContext, {
          testNamespace: placement.namespace,
          testPath: placement.relativePath,
        })
      : this.promptBuilder.build(generationContext);
    const generation = await this.llmProvider.generate(prompt, config);

    return {
      content: generation.content,
      promptSha256: promptDigest(prompt),
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
    context: Pick<
      AttemptContext,
      'target' | 'framework' | 'language' | 'strategy' | 'budget'
    >,
  ): Promise<void> {
    if (context.strategy === 'RAG') {
      const target = toRetrievalTarget(context.target);
      const emptyContext = this.contextBuilder.build(
        { targetChunks: [], candidates: [] },
        target,
        { framework: context.framework, language: context.language },
        { maxContextTokens: context.budget.contextTokenBudget },
        [],
      );
      await this.contextTracesRepository.updateDetail(
        traceId,
        makeRagDetail(emptyContext),
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
    framework: 'JEST' | 'VITEST' | 'PHPUNIT' | null,
    placement: PhpTestLocation | null,
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
    const instructions = buildAgentInstructions(
      target,
      framework,
      placement,
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
      const safeStep = safeAgentStep(event.step);
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
      promptSha256: promptDigest(instructions),
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

  /**
   * WI-CORE-027 (best-effort): escribe el resultado terminal con su evidencia en una sola escritura guardada por
   * RUNNING. Si esa escritura falla, la evidencia no degrada el intento: se loguea solo el nombre del error y el
   * resultado se escribe sin las columnas de evidencia (las guardas no cambian).
   */
  private async writeTerminalRepetition(
    repetitionId: string,
    context: { strategy: Strategy; repetition: number },
    input: ExperimentRepetitionInput,
    evidence: RepetitionEvidence,
    state: 'COMPLETED' | 'FAILED',
  ): Promise<boolean> {
    // WI-CORE-060: startedAt del intento y finishedAt en el momento de escribir el resultado terminal.
    const timing: Pick<ExperimentRepetitionInput, 'startedAt' | 'finishedAt'> = {
      startedAt: evidence.startedAt,
      finishedAt: new Date(),
    };
    const evidenceColumns: Partial<ExperimentRepetitionInput> = {
      ...timing,
      sandboxExecutionId: evidence.sandbox?.executionId ?? null,
      sandboxRequestId: evidence.sandbox?.requestId ?? null,
      sandboxCorrelationId: evidence.sandbox?.correlationId ?? null,
      sandboxFacts: evidence.sandbox?.facts ?? null,
      artifactHash: evidence.artifactHash,
    };

    let written: boolean;
    try {
      written = await this.experimentRunsRepository.updateRepetitionById(
        repetitionId,
        { ...input, ...evidenceColumns },
        state,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'ErrorDesconocido';
      this.logger.warn(
        `No se pudo registrar la evidencia de la repetición ${context.repetition} (${context.strategy}) (${reason}); el resultado se escribe sin ella.`,
      );
      written = await this.experimentRunsRepository.updateRepetitionById(
        repetitionId,
        { ...input, ...timing },
        state,
      );
    }
    if (written && evidence.artifact !== null) {
      await this.writeRepetitionArtifact(repetitionId, context, evidence.artifact);
    }
    return written;
  }

  /**
   * WI-CORE-053: best-effort. Construir el artefacto se hace dentro del try del cliente de Sandbox; si lanzara,
   * la repetición se clasificaría como fallo de infraestructura y se reintentaría. Por eso se aísla aquí: ante
   * error devuelve null y solo se registra el nombre del error, nunca su mensaje.
   */
  private safeBuildArtifact(
    content: string,
    result: Parameters<typeof buildRepetitionArtifact>[1],
    context: { strategy: Strategy; repetition: number },
  ): RepetitionArtifactRecord | null {
    let artifact: RepetitionArtifact | null;
    try {
      artifact = buildRepetitionArtifact(content, result);
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'ErrorDesconocido';
      this.logger.warn(
        `No se pudo construir el artefacto de la repetición ${context.repetition} (${context.strategy}) (${reason}); el resultado se conserva.`,
      );
      return null;
    }
    if (artifact === null || result === null) return artifact;
    // WI-CORE-060: evidencia del Sandbox saneada y acotada; un fallo aquí solo omite esa evidencia.
    try {
      const evidence = buildSandboxEvidenceArtifact(
        result.evidence,
        result.startedAt,
        result.completedAt,
      );
      return evidence === null ? artifact : { ...artifact, ...evidence };
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'ErrorDesconocido';
      this.logger.warn(
        `No se pudo construir la evidencia del Sandbox de la repetición ${context.repetition} (${context.strategy}) (${reason}); el resultado se conserva.`,
      );
      return artifact;
    }
  }

  /**
   * WI-CORE-053: best-effort. Un fallo al guardar el artefacto no cambia el resultado de la repetición; solo
   * se registra el nombre del error, nunca su mensaje.
   */
  private async writeRepetitionArtifact(
    repetitionId: string,
    context: { strategy: Strategy; repetition: number },
    artifact: RepetitionArtifactRecord,
  ): Promise<void> {
    try {
      await this.experimentRunsRepository.upsertRepetitionArtifact(
        repetitionId,
        artifact,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'ErrorDesconocido';
      this.logger.warn(
        `No se pudo guardar el artefacto de la repetición ${context.repetition} (${context.strategy}) (${reason}); el resultado se conserva.`,
      );
    }
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
    sandboxTimedOut = false,
    failure: ExperimentRepetitionFailure | null = null,
    evidence: RepetitionEvidence,
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
      // WI-CORE-060: solo el hash del prompt; el texto nunca se persiste ni se registra.
      promptSha256: generation.promptSha256,
      // Segundo fallo externo: la repetición no es evaluable técnicamente (plan punto 7).
      ...(context.attempt === 2 && externalFailure
        ? { technicallyEvaluable: false }
        : {}),
      // Interno (WI-CORE-025): solo se escribe true en TIMED_OUT; el resto queda NULL.
      ...(sandboxTimedOut ? { sandboxTimedOut: true } : {}),
      // WI-CORE-007: interno. Sin hecho de fallo la clave se omite (la columna queda NULL).
      ...(failure ? { failure } : {}),
    };

    const terminalState = outcome.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
    const written = await this.writeTerminalRepetition(
      begun.repetition.id,
      context,
      input,
      evidence,
      terminalState,
    );
    if (!written) {
      // WI-CORE-030 (H3): el intento ya estaba cerrado (liberado como interrumpido). No se cierra su
      // traza ni se recalculan contadores: lo hizo quien lo cerró.
      this.logger.warn(
        `La repetición ${context.repetition} (${context.strategy}) ya estaba cerrada; su resultado no se escribe.`,
      );
      return;
    }
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
