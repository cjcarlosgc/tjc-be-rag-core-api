import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { TestTargetsRepository } from '../project-versions/persistence/test-targets.repository.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { ZipExtractionService, type ExtractedWorkspace } from '../project-versions/zip/zip-extraction.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import type { RetrievalTarget } from '../retrieval/generation-context.js';
import { PromptBuilder } from './prompt-builder.service.js';
import { TestFileMergeService } from './test-file-merge.service.js';
import { WorkspaceFileTracker } from './workspace-file-tracker.js';
import { TestGenerationRunsRepository } from './persistence/test-generation-runs.repository.js';
import { LLM_PROVIDER } from '../providers/providers.constants.js';
import type { LLMProvider } from '../providers/llm-provider.interface.js';
import {
  SandboxExecutionService,
  SandboxUnavailableError,
} from '../sandbox/sandbox-execution.service.js';
import { mapSandboxResult, type MappedSandboxOutcome } from '../sandbox/map-sandbox-result.js';
import { sandboxManualRetryRequestId } from '../sandbox/sandbox-request-id.util.js';
import type { SandboxExecutionResult } from '../sandbox/sandbox.types.js';
import { ArtifactService } from '../artifacts/artifact.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { toTestRunStatusResponse } from './dto/test-run.response.js';

export interface RetryTargetJobPayload {
  testRunId: string;
  targetId: string;
}

export const RETRY_TARGET_JOB_TYPE = 'test-run-retry-target';

/**
 * HU24 (reintento manual): reprocesa desde cero un único target que quedó
 * `INVALID`/`FAILED` en un run ya terminado. A diferencia de
 * `TestGenerationJobHandler`, no crea un run nuevo ni toca otros targets:
 * actualiza en su lugar el `TargetRunResult` existente y ajusta los
 * contadores/estado del run (`TestGenerationRunsRepository.applyRetryOutcome`).
 * Sin autorreparación: esta es la única ejecución del Sandbox para este
 * intento, sin ningún loop de corrección (ver `009-history-realtime-repair/spec.md`).
 */
@Injectable()
export class RetryTargetJobHandler implements JobHandler<RetryTargetJobPayload>, OnModuleInit {
  readonly type = RETRY_TARGET_JOB_TYPE;
  private readonly logger = new Logger(RetryTargetJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly testGenerationRunsRepository: TestGenerationRunsRepository,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly testTargetsRepository: TestTargetsRepository,
    private readonly retrievalService: RetrievalService,
    private readonly contextBuilder: ContextBuilder,
    private readonly promptBuilder: PromptBuilder,
    private readonly testFileMergeService: TestFileMergeService,
    private readonly sandboxExecutionService: SandboxExecutionService,
    private readonly artifactService: ArtifactService,
    private readonly objectStorageService: ObjectStorageService,
    private readonly zipExtractionService: ZipExtractionService,
    private readonly realtimeGateway: RealtimeGateway,
    @Inject(LLM_PROVIDER) private readonly llmProvider: LLMProvider,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: RetryTargetJobPayload, jobId: string): Promise<void> {
    const targetResult = await this.testGenerationRunsRepository.findTargetResult(
      payload.testRunId,
      payload.targetId,
    );

    if (!targetResult || (targetResult.status !== 'INVALID' && targetResult.status !== 'FAILED')) {
      this.logger.warn(
        `Reintento ignorado: target ${payload.targetId} del run ${payload.testRunId} ya no está en un estado reintentable.`,
      );
      return;
    }

    const previousStatus = targetResult.status;
    const run = await this.testGenerationRunsRepository.findById(payload.testRunId);

    if (!run) {
      this.logger.warn(`Reintento ignorado: el run ${payload.testRunId} ya no existe.`);
      return;
    }

    const [version, target] = await Promise.all([
      this.projectVersionsRepository.findById(run.projectVersionId),
      this.testTargetsRepository.findById(payload.targetId),
    ]);

    if (!version || !version.snapshotKey) {
      this.logger.warn(
        `Reintento ignorado: la versión ${run.projectVersionId} ya no tiene snapshot disponible.`,
      );
      return;
    }

    if (!target) {
      this.logger.warn(`Reintento ignorado: el target ${payload.targetId} ya no existe.`);
      return;
    }

    let workspace: ExtractedWorkspace | undefined;
    const relativePath = targetResult.testFilePath;
    const framework = version.detectedFramework;

    try {
      const snapshotBuffer = await this.objectStorageService.get(version.snapshotKey);
      workspace = await this.zipExtractionService.extract(snapshotBuffer);
      const tracker = new WorkspaceFileTracker(workspace.dir);

      const retrievalTarget: RetrievalTarget = {
        filePath: target.filePath,
        symbolName: target.symbolName,
        methodName: target.methodName,
        targetType: target.targetType as 'METHOD' | 'FUNCTION',
      };

      const retrieval = await this.retrievalService.retrieve(run.projectVersionId, retrievalTarget);
      const generationContext = this.contextBuilder.build(retrieval, retrievalTarget, { framework });
      const prompt = this.promptBuilder.build(generationContext);
      const generation = await this.llmProvider.generate(prompt);

      const { content: currentContent, isNewFile } = await tracker.getCurrent(relativePath);
      const mergedContent = isNewFile
        ? this.testFileMergeService.applyCreate(generation.content)
        : this.testFileMergeService.applyMerge(currentContent ?? '', generation.content);

      tracker.set(relativePath, mergedContent);

      if (!framework) {
        tracker.setValid(relativePath, false);
        await this.finish(run.id, targetResult.id, relativePath, previousStatus, {
          status: 'FAILED',
          compiled: null,
          executed: null,
          passed: null,
          valid: null,
          failureType: 'CONFIGURATION',
          errorSummary: 'No se pudo determinar el framework de test (Jest/Vitest) durante la indexación.',
        });
        await this.artifactService.persistRetriedArtifact(run.id, tracker.getFinalFiles()[0]);
        return;
      }

      let sandboxResult: SandboxExecutionResult;

      try {
        sandboxResult = await this.sandboxExecutionService.execute({
          requestId: sandboxManualRetryRequestId(jobId, target.id),
          testRunId: run.id,
          projectVersionId: run.projectVersionId,
          snapshotKey: version.snapshotKey,
          snapshotBuffer,
          artifacts: [
            {
              artifactId: randomUUID(),
              relativePath,
              artifactType: isNewFile ? 'CREATED' : 'MODIFIED',
              content: Buffer.from(mergedContent, 'utf8'),
            },
          ],
          scope: 'TARGET',
          targetIds: [target.id],
          runnerHint: framework,
        });
      } catch (error) {
        tracker.setValid(relativePath, false);
        await this.finish(run.id, targetResult.id, relativePath, previousStatus, {
          status: 'FAILED',
          compiled: null,
          executed: null,
          passed: null,
          valid: null,
          failureType: 'INFRASTRUCTURE',
          errorSummary:
            error instanceof SandboxUnavailableError
              ? error.message
              : 'El Sandbox no está disponible.',
        });
        await this.artifactService.persistRetriedArtifact(run.id, tracker.getFinalFiles()[0]);
        return;
      }

      const outcome = mapSandboxResult(sandboxResult);
      tracker.setValid(relativePath, outcome.valid === true);
      await this.finish(run.id, targetResult.id, relativePath, previousStatus, outcome);
      await this.artifactService.persistRetriedArtifact(run.id, tracker.getFinalFiles()[0]);
    } finally {
      if (workspace) {
        await workspace.cleanup();
      }
    }
  }

  private async finish(
    testRunId: string,
    targetResultId: string,
    testFilePath: string,
    previousStatus: 'INVALID' | 'FAILED',
    outcome: MappedSandboxOutcome,
  ): Promise<void> {
    await this.testGenerationRunsRepository.updateTargetResult(targetResultId, {
      testFilePath,
      status: outcome.status,
      compiled: outcome.compiled,
      executed: outcome.executed,
      passed: outcome.passed,
      valid: outcome.valid,
      failureType: outcome.failureType,
      errorSummary: outcome.errorSummary,
    });
    await this.testGenerationRunsRepository.applyRetryOutcome(testRunId, previousStatus, outcome.status);
    await this.emitProgress(testRunId);
  }

  private async emitProgress(testRunId: string): Promise<void> {
    const run = await this.testGenerationRunsRepository.findById(testRunId);

    if (run) {
      this.realtimeGateway.emitTestRunUpdate(testRunId, toTestRunStatusResponse(run));
    }
  }
}
