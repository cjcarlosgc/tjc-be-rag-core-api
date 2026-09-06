import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { ZipExtractionService, type ExtractedWorkspace } from '../project-versions/zip/zip-extraction.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import type { RetrievalTarget } from '../retrieval/generation-context.js';
import { PromptBuilder } from './prompt-builder.service.js';
import { GapAnalyzer } from './gap-analyzer.service.js';
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
import type { SandboxExecutionResult } from '../sandbox/sandbox.types.js';
import { ArtifactService } from '../artifacts/artifact.service.js';
import { TestRunStatus } from '../generated/prisma/enums.js';
import type { TestTarget } from '../generated/prisma/client.js';
import type { GenerationMode } from './dto/generation-mode.js';

export interface TestGenerationJobPayload {
  testRunId: string;
  projectId: string;
  projectVersionId: string;
  mode: GenerationMode;
  targetId: string | null;
}

export function coLocatedSpecPath(filePath: string): string {
  return `${filePath.replace(/\.tsx?$/, '')}.spec.ts`;
}

export const TEST_GENERATION_JOB_TYPE = 'test-generation-run';

@Injectable()
export class TestGenerationJobHandler implements JobHandler<TestGenerationJobPayload>, OnModuleInit {
  readonly type = TEST_GENERATION_JOB_TYPE;
  private readonly logger = new Logger(TestGenerationJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly testGenerationRunsRepository: TestGenerationRunsRepository,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly gapAnalyzer: GapAnalyzer,
    private readonly retrievalService: RetrievalService,
    private readonly contextBuilder: ContextBuilder,
    private readonly promptBuilder: PromptBuilder,
    private readonly testFileMergeService: TestFileMergeService,
    private readonly sandboxExecutionService: SandboxExecutionService,
    private readonly artifactService: ArtifactService,
    private readonly objectStorageService: ObjectStorageService,
    private readonly zipExtractionService: ZipExtractionService,
    @Inject(LLM_PROVIDER) private readonly llmProvider: LLMProvider,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: TestGenerationJobPayload): Promise<void> {
    const run = await this.testGenerationRunsRepository.findById(payload.testRunId);

    if (!run || run.status === TestRunStatus.COMPLETED || run.status === TestRunStatus.PARTIAL) {
      return;
    }

    let workspace: ExtractedWorkspace | undefined;

    try {
      await this.testGenerationRunsRepository.markStarted(payload.testRunId);

      const version = await this.projectVersionsRepository.findById(payload.projectVersionId);

      if (!version || !version.snapshotKey) {
        throw new Error(`ProjectVersion ${payload.projectVersionId} no tiene snapshot disponible.`);
      }

      const targets = await this.gapAnalyzer.resolve(payload.projectVersionId, payload.mode, payload.targetId ?? undefined);

      if (targets.length === 0) {
        await this.testGenerationRunsRepository.completeAsNoMissingTargets(payload.testRunId);
        return;
      }

      await this.testGenerationRunsRepository.update(payload.testRunId, { totalTargets: targets.length });

      const snapshotBuffer = await this.objectStorageService.get(version.snapshotKey);
      workspace = await this.zipExtractionService.extract(snapshotBuffer);
      const tracker = new WorkspaceFileTracker(workspace.dir);

      await this.testGenerationRunsRepository.setStatus(payload.testRunId, TestRunStatus.PROCESSING_TARGETS);

      for (const target of targets) {
        await this.processTarget({
          testRunId: payload.testRunId,
          projectVersionId: payload.projectVersionId,
          snapshotKey: version.snapshotKey,
          snapshotBuffer,
          framework: version.detectedFramework,
          target,
          tracker,
        });
      }

      await this.testGenerationRunsRepository.setStatus(payload.testRunId, TestRunStatus.FINALIZING);
      await this.artifactService.persistFinalArtifacts(payload.testRunId, tracker.getFinalFiles());

      const refreshed = await this.testGenerationRunsRepository.findById(payload.testRunId);
      const totalTargets = refreshed?.totalTargets ?? 0;
      const validTargets = refreshed?.validTargets ?? 0;
      const invalidTargets = refreshed?.invalidTargets ?? 0;
      const finalStatus =
        validTargets === totalTargets && totalTargets > 0
          ? 'COMPLETED'
          : validTargets > 0 || invalidTargets > 0
            ? 'PARTIAL'
            : 'FAILED';

      await this.testGenerationRunsRepository.complete(payload.testRunId, finalStatus);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Fallo desconocido durante la generación.';
      await this.testGenerationRunsRepository.markFailed(payload.testRunId, 'GENERATION_FAILED', message);
      throw error;
    } finally {
      if (workspace) {
        await workspace.cleanup();
      }
    }
  }

  private async processTarget(context: {
    testRunId: string;
    projectVersionId: string;
    snapshotKey: string;
    snapshotBuffer: Buffer;
    framework: 'JEST' | 'VITEST' | null;
    target: TestTarget;
    tracker: WorkspaceFileTracker;
  }): Promise<void> {
    const { testRunId, projectVersionId, snapshotKey, snapshotBuffer, framework, target, tracker } = context;
    const relativePath =
      target.hasTest && target.testFilePaths.length > 0
        ? target.testFilePaths[0]
        : coLocatedSpecPath(target.filePath);

    try {
      const retrievalTarget: RetrievalTarget = {
        filePath: target.filePath,
        symbolName: target.symbolName,
        methodName: target.methodName,
        targetType: target.targetType as 'METHOD' | 'FUNCTION',
      };

      const retrieval = await this.retrievalService.retrieve(projectVersionId, retrievalTarget);
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
        await this.recordResult(testRunId, target, relativePath, {
          status: 'FAILED',
          compiled: null,
          executed: null,
          passed: null,
          valid: null,
          failureType: 'CONFIGURATION',
          errorSummary: 'No se pudo determinar el framework de test (Jest/Vitest) durante la indexación.',
        });
        return;
      }

      let sandboxResult: SandboxExecutionResult;

      try {
        sandboxResult = await this.sandboxExecutionService.execute({
          testRunId,
          projectVersionId,
          snapshotKey,
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
        await this.recordResult(testRunId, target, relativePath, {
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
        return;
      }

      const outcome = mapSandboxResult(sandboxResult);
      tracker.setValid(relativePath, outcome.valid === true);
      await this.recordResult(testRunId, target, relativePath, outcome);
    } catch (error) {
      await this.recordResult(testRunId, target, relativePath, {
        status: 'FAILED',
        compiled: null,
        executed: null,
        passed: null,
        valid: null,
        failureType: 'UNKNOWN',
        errorSummary:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : 'Error desconocido durante la generación de este target.',
      });
    }
  }

  private async recordResult(
    testRunId: string,
    target: TestTarget,
    testFilePath: string,
    outcome: MappedSandboxOutcome,
  ): Promise<void> {
    await this.testGenerationRunsRepository.insertTargetResult(testRunId, {
      targetId: target.id,
      filePath: target.filePath,
      symbolName: target.symbolName,
      methodName: target.methodName,
      targetType: target.targetType,
      testFilePath,
      status: outcome.status,
      compiled: outcome.compiled,
      executed: outcome.executed,
      passed: outcome.passed,
      valid: outcome.valid,
      failureType: outcome.failureType,
      errorSummary: outcome.errorSummary,
    });
    await this.testGenerationRunsRepository.incrementProcessed(testRunId, outcome.status);
  }
}
