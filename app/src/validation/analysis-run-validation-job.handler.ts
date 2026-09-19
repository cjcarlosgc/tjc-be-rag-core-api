import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService, type AnalysisRunCompletionStatus } from '../analysis-runs/analysis-runs.service.js';
import { AnalysisSymbolsRepository } from '../analysis-runs/persistence/analysis-symbols.repository.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { TestTargetsRepository } from '../project-versions/persistence/test-targets.repository.js';
import { zipDirectory } from '../project-versions/zip/zip-directory.util.js';
import { GithubSnapshotMaterializerService } from '../snapshot-intelligence/github-snapshot-materializer.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { PromptBuilder } from '../generation/prompt-builder.service.js';
import { TestFileMergeService, coLocatedSpecPath } from '../generation/test-file-merge.service.js';
import { SandboxExecutionService, SandboxUnavailableError } from '../sandbox/sandbox-execution.service.js';
import { mapSandboxResult, type FailureTypeValue } from '../sandbox/map-sandbox-result.js';
import { sandboxGenerationRequestId } from '../sandbox/sandbox-request-id.util.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { GeneratedTestProposalsRepository } from './generated-test-proposals.repository.js';
import { toRetrievalTarget, findMatchingTestTarget } from './symbol-target.util.js';
import { LLM_PROVIDER } from '../providers/providers.constants.js';
import type { LLMProvider } from '../providers/llm-provider.interface.js';
import type { AnalysisRun, AnalysisSymbol } from '../generated/prisma/client.js';
import type { ExtractedWorkspace } from '../project-versions/zip/zip-extraction.service.js';

export interface AnalysisRunValidationJobPayload {
  analysisRunId: string;
}

export const ANALYSIS_RUN_VALIDATION_JOB_TYPE = 'analysis-run-validation';

type SymbolOutcomeKind = 'AVAILABLE' | 'SKIPPED_HAS_TEST' | 'TECHNICAL_GENERATION_FAILURE' | 'BEHAVIORAL_MISMATCH';

interface SymbolOutcome {
  symbol: AnalysisSymbol;
  kind: SymbolOutcomeKind;
}

/**
 * Corte "Validation" (plan.md #6): genera y valida pruebas para los símbolos
 * DIRECTLY_CHANGED METHOD/FUNCTION que ya tienen conocimiento funcional
 * suficiente (HU35/36) y todavía no tienen test existente. Reutiliza el
 * pipeline RAG->Sandbox ya construido para Experiments (HU19) — solo el arm
 * RAG, no GENERALIST_AGENT (reservado para la comparación experimental).
 *
 * Simplificaciones documentadas (ver harness/state.json):
 * - Sin baseline real (`phase=BASELINE` del contrato Sandbox 2.0 todavía no
 *   existe en `SandboxExecutionService`; requiere migración coordinada con
 *   el repo del Sandbox). Un símbolo con test existente se salta sin
 *   confirmar que siga en verde -no hay BASELINE_FAILED en este corte-.
 * - `TEST_ASSERTION` se clasifica como BEHAVIORAL_MISMATCH (el prompt ya
 *   incluye las reglas de FunctionalKnowledge respondidas como referencia);
 *   `COMPILATION`/`TEST_RUNTIME`/config se clasifican como
 *   TECHNICAL_GENERATION_FAILURE. Sin juicio semántico vía LLM para afinar
 *   esta distinción todavía.
 * - Símbolos procesados en serie, un solo intento cada uno.
 */
@Injectable()
export class AnalysisRunValidationJobHandler
  implements JobHandler<AnalysisRunValidationJobPayload>, OnModuleInit
{
  readonly type = ANALYSIS_RUN_VALIDATION_JOB_TYPE;
  private readonly logger = new Logger(AnalysisRunValidationJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly analysisSymbolsRepository: AnalysisSymbolsRepository,
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly testTargetsRepository: TestTargetsRepository,
    private readonly githubSnapshotMaterializerService: GithubSnapshotMaterializerService,
    private readonly retrievalService: RetrievalService,
    private readonly contextBuilder: ContextBuilder,
    private readonly promptBuilder: PromptBuilder,
    private readonly testFileMergeService: TestFileMergeService,
    private readonly sandboxExecutionService: SandboxExecutionService,
    private readonly objectStorageService: ObjectStorageService,
    private readonly generatedTestProposalsRepository: GeneratedTestProposalsRepository,
    @Inject(LLM_PROVIDER) private readonly llmProvider: LLMProvider,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: AnalysisRunValidationJobPayload, jobId: string): Promise<void> {
    const run = await this.analysisRunsRepository.findById(payload.analysisRunId);

    if (!run || run.status !== 'PROCESSING' || !run.projectVersionId) {
      return;
    }

    const binding = await this.repositoryBindingsRepository.findByRepositoryId(run.repositoryId);

    if (!binding) {
      await this.analysisRunsService.completeRunFromSystem(run, 'INFRASTRUCTURE_FAILURE', {
        resultSummary: `No se encontró el repository binding para "${run.repositoryId}".`,
      });
      return;
    }

    let workspace: ExtractedWorkspace | undefined;

    try {
      const [version, symbols, existingTargets] = await Promise.all([
        this.projectVersionsRepository.findById(run.projectVersionId),
        this.analysisSymbolsRepository.findByAnalysisRun(run.id),
        this.testTargetsRepository.findByProjectVersion(run.projectVersionId),
      ]);

      if (!version) {
        await this.analysisRunsService.completeRunFromSystem(run, 'INFRASTRUCTURE_FAILURE', {
          resultSummary: `El ProjectVersion "${run.projectVersionId}" no existe.`,
        });
        return;
      }

      const candidates = symbols.filter(
        (symbol) =>
          symbol.changeKind === 'DIRECTLY_CHANGED' && (symbol.kind === 'METHOD' || symbol.kind === 'FUNCTION'),
      );

      workspace = await this.githubSnapshotMaterializerService.materialize(binding, run.headSha);
      const snapshotBuffer = zipDirectory(workspace.dir);
      const snapshotKey = `analysis-runs/${run.id}/snapshot.zip`;
      await this.objectStorageService.put(snapshotKey, snapshotBuffer, 'application/zip');

      const outcomes: SymbolOutcome[] = [];

      for (const symbol of candidates) {
        const matchingTarget = findMatchingTestTarget(existingTargets, symbol);

        if (matchingTarget?.hasTest) {
          outcomes.push({ symbol, kind: 'SKIPPED_HAS_TEST' });
          continue;
        }

        if (!version.detectedFramework) {
          await this.persistProposal(run, symbol, {
            relativePath: coLocatedSpecPath(symbol.filePath),
            content: '',
            status: 'HELD',
            failureSummary: 'No se pudo determinar el framework de test (Jest/Vitest) durante la indexación.',
          });
          outcomes.push({ symbol, kind: 'TECHNICAL_GENERATION_FAILURE' });
          continue;
        }

        const outcome = await this.generateAndValidate({
          run,
          jobId,
          symbol,
          framework: version.detectedFramework,
          workspace,
          snapshotKey,
          snapshotBuffer,
        });
        outcomes.push(outcome);
      }

      const finalStatus = this.classifyRun(outcomes);
      const availableCount = outcomes.filter((o) => o.kind === 'AVAILABLE').length;

      await this.analysisRunsService.completeRunFromSystem(run, finalStatus, {
        resultSummary: this.buildResultSummary(finalStatus, outcomes),
        generatedTestsCount: availableCount,
        functionalBehaviorValidated: finalStatus === 'SUCCESS' || finalStatus === 'NO_ADDITIONAL_TESTS_REQUIRED',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido en Validation.';
      this.logger.error(`AnalysisRun ${run.id} falló en Validation: ${message}`);
      await this.analysisRunsService.completeRunFromSystem(run, 'INFRASTRUCTURE_FAILURE', {
        resultSummary: message,
      });
      throw error;
    } finally {
      await workspace?.cleanup();
    }
  }

  private async generateAndValidate(context: {
    run: AnalysisRun;
    jobId: string;
    symbol: AnalysisSymbol;
    framework: 'JEST' | 'VITEST';
    workspace: ExtractedWorkspace;
    snapshotKey: string;
    snapshotBuffer: Buffer;
  }): Promise<SymbolOutcome> {
    const { run, jobId, symbol, framework, workspace, snapshotKey, snapshotBuffer } = context;

    try {
      const retrievalTarget = toRetrievalTarget(symbol);
      const retrieval = await this.retrievalService.retrieve(run.projectVersionId!, retrievalTarget);
      const generationContext = this.contextBuilder.build(retrieval, retrievalTarget, { framework });
      const prompt = this.promptBuilder.build(generationContext);
      const generation = await this.llmProvider.generate(prompt);

      const relativePath = coLocatedSpecPath(symbol.filePath);
      const existingContent = await readFile(join(workspace.dir, relativePath), 'utf8').catch(() => null);
      const mergedContent =
        existingContent === null
          ? this.testFileMergeService.applyCreate(generation.content)
          : this.testFileMergeService.applyMerge(existingContent, generation.content);

      const sandboxResult = await this.sandboxExecutionService.execute({
        requestId: sandboxGenerationRequestId(jobId, symbol.id),
        testRunId: run.id,
        projectVersionId: run.projectVersionId!,
        snapshotKey,
        snapshotBuffer,
        artifacts: [
          {
            artifactId: randomUUID(),
            relativePath,
            artifactType: existingContent === null ? 'CREATED' : 'MODIFIED',
            content: Buffer.from(mergedContent, 'utf8'),
          },
        ],
        scope: 'TARGET',
        targetIds: [symbol.id],
        runnerHint: framework,
      });

      const outcome = mapSandboxResult(sandboxResult);

      if (outcome.status === 'VALID') {
        await this.persistProposal(run, symbol, {
          relativePath,
          content: mergedContent,
          status: 'AVAILABLE',
        });
        return { symbol, kind: 'AVAILABLE' };
      }

      const kind = this.classifySymbolFailure(outcome.failureType);
      await this.persistProposal(run, symbol, {
        relativePath,
        content: mergedContent,
        status: 'HELD',
        failureSummary: outcome.errorSummary ?? 'La prueba generada no pasó en el Sandbox.',
      });
      return { symbol, kind };
    } catch (error) {
      const summary =
        error instanceof SandboxUnavailableError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Fallo desconocido generando la prueba.';
      this.logger.warn(
        `Símbolo ${symbol.qualifiedName} (${symbol.filePath}) del AnalysisRun ${run.id} no pudo validarse: ${summary}`,
      );
      await this.persistProposal(run, symbol, {
        relativePath: coLocatedSpecPath(symbol.filePath),
        content: '',
        status: 'HELD',
        failureSummary: summary,
      });
      return { symbol, kind: 'TECHNICAL_GENERATION_FAILURE' };
    }
  }

  private classifySymbolFailure(failureType: FailureTypeValue | null): 'TECHNICAL_GENERATION_FAILURE' | 'BEHAVIORAL_MISMATCH' {
    return failureType === 'TEST_ASSERTION' ? 'BEHAVIORAL_MISMATCH' : 'TECHNICAL_GENERATION_FAILURE';
  }

  private classifyRun(outcomes: SymbolOutcome[]): AnalysisRunCompletionStatus {
    if (outcomes.some((o) => o.kind === 'BEHAVIORAL_MISMATCH')) {
      return 'BEHAVIORAL_MISMATCH';
    }
    if (outcomes.some((o) => o.kind === 'TECHNICAL_GENERATION_FAILURE')) {
      return 'TECHNICAL_GENERATION_FAILURE';
    }
    if (outcomes.some((o) => o.kind === 'AVAILABLE')) {
      return 'SUCCESS';
    }
    return 'NO_ADDITIONAL_TESTS_REQUIRED';
  }

  private buildResultSummary(status: AnalysisRunCompletionStatus, outcomes: SymbolOutcome[]): string {
    const available = outcomes.filter((o) => o.kind === 'AVAILABLE').length;
    const skipped = outcomes.filter((o) => o.kind === 'SKIPPED_HAS_TEST').length;
    const mismatched = outcomes.filter((o) => o.kind === 'BEHAVIORAL_MISMATCH').length;
    const failed = outcomes.filter((o) => o.kind === 'TECHNICAL_GENERATION_FAILURE').length;

    return `${status}: ${available} propuesta(s) disponible(s), ${skipped} símbolo(s) ya cubiertos por tests existentes, ${mismatched} behavioral mismatch, ${failed} fallo(s) técnico(s) de generación.`;
  }

  private async persistProposal(
    run: AnalysisRun,
    symbol: AnalysisSymbol,
    input: { relativePath: string; content: string; status: 'AVAILABLE' | 'HELD'; failureSummary?: string },
  ): Promise<void> {
    const storageKey = `analysis-runs/${run.id}/proposals/${randomUUID()}`;
    const buffer = Buffer.from(input.content, 'utf8');
    await this.objectStorageService.put(storageKey, buffer, 'text/plain');

    await this.generatedTestProposalsRepository.create({
      analysisRunId: run.id,
      relativePath: input.relativePath,
      symbolLanguage: symbol.language,
      symbolKind: symbol.kind,
      qualifiedName: symbol.qualifiedName,
      filePath: symbol.filePath,
      storageKey,
      contentSha256: createHash('sha256').update(buffer).digest('hex'),
      status: input.status,
      ...(input.failureSummary ? { failureSummary: input.failureSummary } : {}),
    });
  }
}
