import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { CodeChunksRepository, type ChunkToPersist } from '../project-versions/persistence/code-chunks.repository.js';
import { TestTargetsRepository } from '../project-versions/persistence/test-targets.repository.js';
import { FileDiscoveryService } from '../project-versions/discovery/file-discovery.service.js';
import { TypeScriptParserService, type ParsedChunk } from '../project-versions/parsing/typescript-parser.service.js';
import { TestTargetExtractorService } from '../project-versions/inventory/test-target-extractor.service.js';
import { ExistingTestResolverService } from '../project-versions/inventory/existing-test-resolver.service.js';
import { findPackageJsonPath, detectFramework } from '../project-versions/inventory/framework-detector.js';
import { isSourceFile, isTestFile } from '../project-versions/indexing.constants.js';
import { GithubAppAuthService } from '../github-app/github-app-auth.service.js';
import { GithubRepositoryContentService, type CompareFile } from '../github-app/github-repository-content.service.js';
import { GithubSnapshotMaterializerService } from './github-snapshot-materializer.service.js';
import { AnalysisSymbolsRepository, type AnalysisSymbolToPersist } from '../analysis-runs/persistence/analysis-symbols.repository.js';
import { FunctionalContextEvaluatorService } from '../functional-knowledge/functional-context-evaluator.service.js';
import { ANALYSIS_RUN_VALIDATION_JOB_TYPE } from '../validation/analysis-run-validation-job.handler.js';
import { EMBEDDING_PROVIDER } from '../providers/providers.constants.js';
import type { EmbeddingProvider } from '../providers/embedding-provider.interface.js';
import type { ExtractedWorkspace } from '../project-versions/zip/zip-extraction.service.js';
import type { AnalysisIndexMode, CodeChunk } from '../generated/prisma/client.js';

export interface SnapshotAnalysisJobPayload {
  analysisRunId: string;
}

export const SNAPSHOT_ANALYSIS_JOB_TYPE = 'snapshot-analysis';

const CHUNK_SYMBOL_TO_ANALYSIS_KIND: Record<ParsedChunk['symbolKind'], AnalysisSymbolToPersist['kind'] | null> = {
  CLASS: 'CLASS',
  METHOD: 'METHOD',
  CONSTRUCTOR: 'METHOD',
  FUNCTION: 'FUNCTION',
  INTERFACE: 'INTERFACE',
  TYPE_ALIAS: 'TYPE',
  ENUM: 'ENUM',
  FILE: null,
};

interface ChunkIdentityFields {
  filePath: string;
  symbolKind: string;
  symbolName: string | null;
  parentSymbolName: string | null;
}

function chunkIdentity(chunk: ChunkIdentityFields): string {
  return `${chunk.filePath}::${chunk.symbolKind}::${chunk.symbolName ?? ''}::${chunk.parentSymbolName ?? ''}`;
}

function qualifiedNameOf(chunk: Pick<ParsedChunk, 'filePath' | 'symbolName' | 'parentSymbolName'>): string {
  if (chunk.parentSymbolName && chunk.symbolName) {
    return `${chunk.parentSymbolName}.${chunk.symbolName}`;
  }
  return chunk.symbolName ?? chunk.filePath;
}

/**
 * Resuelve un specifier de import relativo (`./foo`, `../bar`) contra el
 * archivo que lo declara y compara (sin extensión) contra las rutas
 * cambiadas del CHANGESET. Specifiers no relativos (paquetes npm) nunca
 * apuntan a un archivo del propio repo.
 */
function importResolvesToChangedFile(
  importingFilePath: string,
  specifier: string,
  changedFilePathsWithoutExt: Set<string>,
): boolean {
  if (!specifier.startsWith('.')) {
    return false;
  }

  const resolved = normalize(join(dirname(importingFilePath), specifier)).split('\\').join('/');
  return changedFilePathsWithoutExt.has(resolved.replace(/\.tsx?$/, ''));
}

/**
 * HU33/34: primer job real disparado tras crear un `AnalysisRun` (Corte de
 * snapshot intelligence). Materializa el HEAD del PR vía la API de GitHub,
 * reutiliza el pipeline de indexación existente (discovery/parsing/
 * inventory/embeddings) para producir un `ProjectVersion` nuevo, calcula
 * `CHANGESET`/`INDEX DELTA` y detecta símbolos `DIRECTLY_CHANGED`/
 * `POTENTIALLY_IMPACTED`. Reindexa el árbol completo en cada Run -no hay
 * persistencia incremental real todavía-; ver plan de este corte.
 */
@Injectable()
export class SnapshotAnalysisJobHandler implements JobHandler<SnapshotAnalysisJobPayload>, OnModuleInit {
  readonly type = SNAPSHOT_ANALYSIS_JOB_TYPE;
  private readonly logger = new Logger(SnapshotAnalysisJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly codeChunksRepository: CodeChunksRepository,
    private readonly testTargetsRepository: TestTargetsRepository,
    private readonly fileDiscoveryService: FileDiscoveryService,
    private readonly typeScriptParserService: TypeScriptParserService,
    private readonly testTargetExtractorService: TestTargetExtractorService,
    private readonly existingTestResolverService: ExistingTestResolverService,
    private readonly githubAppAuthService: GithubAppAuthService,
    private readonly githubRepositoryContentService: GithubRepositoryContentService,
    private readonly githubSnapshotMaterializerService: GithubSnapshotMaterializerService,
    private readonly analysisSymbolsRepository: AnalysisSymbolsRepository,
    private readonly functionalContextEvaluatorService: FunctionalContextEvaluatorService,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: SnapshotAnalysisJobPayload): Promise<void> {
    const initialRun = await this.analysisRunsRepository.findById(payload.analysisRunId);

    if (!initialRun || initialRun.status !== 'QUEUED') {
      return;
    }

    const binding = await this.repositoryBindingsRepository.findByRepositoryId(initialRun.repositoryId);

    if (!binding) {
      await this.analysisRunsService.completeRunFromSystem(initialRun, 'INFRASTRUCTURE_FAILURE', {
        resultSummary: `No se encontró el repository binding para "${initialRun.repositoryId}".`,
      });
      return;
    }

    let run = await this.analysisRunsService.startProcessing(initialRun);
    let workspace: ExtractedWorkspace | undefined;

    try {
      const token = await this.githubAppAuthService.getInstallationToken(binding.installationId);
      const changesetFiles = await this.githubRepositoryContentService.compare(
        binding.repositoryName,
        run.baseSha,
        run.headSha,
        token,
      );

      const previousVersion = await this.projectVersionsRepository.findLatestCompletedByProject(
        run.projectId,
      );
      const indexMode: AnalysisIndexMode = previousVersion ? 'INCREMENTAL' : 'BOOTSTRAP';
      const indexDeltaBaseSha = previousVersion?.commitSha ?? null;

      workspace = await this.githubSnapshotMaterializerService.materialize(binding, run.headSha);

      const discovered = await this.fileDiscoveryService.discover(workspace.dir);
      const sourceFiles = discovered.filter((path) => isSourceFile(path));
      const testFiles = sourceFiles.filter((path) => isTestFile(path));
      const productionFiles = sourceFiles.filter((path) => !isTestFile(path));

      const chunks = this.typeScriptParserService.parse(workspace.dir, sourceFiles);
      const candidates = this.testTargetExtractorService.extract(workspace.dir, productionFiles);
      const resolvedTargets = this.existingTestResolverService.resolve(workspace.dir, testFiles, candidates);

      const packageJsonPath = findPackageJsonPath(discovered);
      const packageJsonContent = packageJsonPath
        ? await readFile(join(workspace.dir, packageJsonPath), 'utf8').catch(() => undefined)
        : undefined;
      const detectedFramework = detectFramework(packageJsonContent, discovered);

      const embeddings =
        chunks.length > 0 ? await this.embeddingProvider.embedMany(chunks.map((c) => c.content)) : [];
      const chunksToPersist: ChunkToPersist[] = chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddings[index],
      }));

      const version = await this.projectVersionsRepository.createPending({
        projectId: run.projectId,
        commitSha: run.headSha,
      });
      await this.projectVersionsRepository.markStarted(version.id);
      await this.codeChunksRepository.insertMany(version.id, chunksToPersist);
      await this.testTargetsRepository.insertMany(version.id, resolvedTargets);
      await this.projectVersionsRepository.completeAndPromote(run.projectId, version.id, {
        filesProcessed: discovered.length,
        chunksCount: chunksToPersist.length,
        detectedFramework,
        targetsTotal: resolvedTargets.length,
        targetsWithTest: resolvedTargets.filter((t) => t.hasTest).length,
      });

      const symbols = await this.detectSymbols(
        chunksToPersist,
        changesetFiles,
        indexMode,
        previousVersion?.id,
      );
      await this.analysisSymbolsRepository.insertMany(run.id, symbols);

      run = await this.analysisRunsService.recordSnapshot(run, {
        indexMode,
        indexDeltaBaseSha,
        projectVersionId: version.id,
      });

      const changesetTouchesSource = changesetFiles.some((file) => isSourceFile(file.filename));

      if (!changesetTouchesSource) {
        await this.analysisRunsService.completeRunFromSystem(run, 'NO_TEST_RELEVANT_CHANGES', {
          resultSummary: 'El CHANGESET no incluye cambios en archivos fuente (solo docs/config/formato).',
        });
      } else {
        // HU35/36: si falta conocimiento funcional para algún símbolo
        // DIRECTLY_CHANGED, el Run termina en ACTION_REQUIRED aquí. Si hay
        // contexto suficiente, se encola el job de Validation (corte
        // plan.md #6: generación+Sandbox+clasificación).
        const evaluation = await this.functionalContextEvaluatorService.evaluate(run);

        if (evaluation.actionRequired) {
          await this.analysisRunsService.markActionRequiredFromSystem(run);
        } else {
          await this.jobsService.enqueue(ANALYSIS_RUN_VALIDATION_JOB_TYPE, { analysisRunId: run.id });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido en snapshot intelligence.';
      this.logger.error(`AnalysisRun ${run.id} falló en snapshot intelligence: ${message}`);
      await this.analysisRunsService.completeRunFromSystem(run, 'INFRASTRUCTURE_FAILURE', {
        resultSummary: message,
      });
      throw error;
    } finally {
      await workspace?.cleanup();
    }
  }

  private async detectSymbols(
    chunks: ChunkToPersist[],
    changesetFiles: CompareFile[],
    indexMode: AnalysisIndexMode,
    previousVersionId: string | undefined,
  ): Promise<AnalysisSymbolToPersist[]> {
    const changedFilePaths = new Set(changesetFiles.map((file) => file.filename));
    const changedFilePathsWithoutExt = new Set(
      changesetFiles.map((file) => file.filename.replace(/\.tsx?$/, '')),
    );

    let previousByIdentity: Map<string, string> | null = null;

    if (indexMode === 'INCREMENTAL' && previousVersionId) {
      const previousChunks = await this.codeChunksRepository.findByProjectVersion(previousVersionId);
      previousByIdentity = new Map(previousChunks.map((chunk: CodeChunk) => [chunkIdentity(chunk), chunk.content]));
    }

    const directlyChanged: AnalysisSymbolToPersist[] = [];
    const potentiallyImpacted: AnalysisSymbolToPersist[] = [];

    for (const chunk of chunks) {
      const kind = CHUNK_SYMBOL_TO_ANALYSIS_KIND[chunk.symbolKind];

      if (!kind) {
        continue;
      }

      if (changedFilePaths.has(chunk.filePath)) {
        const previousContent = previousByIdentity?.get(chunkIdentity(chunk));

        if (!previousByIdentity || previousContent === undefined || previousContent !== chunk.content) {
          directlyChanged.push({
            language: 'TYPESCRIPT',
            kind,
            qualifiedName: qualifiedNameOf(chunk),
            filePath: chunk.filePath,
            changeKind: 'DIRECTLY_CHANGED',
          });
        }

        continue;
      }

      const isImpacted = chunk.importsUsed.some((specifier) =>
        importResolvesToChangedFile(chunk.filePath, specifier, changedFilePathsWithoutExt),
      );

      if (isImpacted) {
        potentiallyImpacted.push({
          language: 'TYPESCRIPT',
          kind,
          qualifiedName: qualifiedNameOf(chunk),
          filePath: chunk.filePath,
          changeKind: 'POTENTIALLY_IMPACTED',
        });
      }
    }

    return [...directlyChanged, ...potentiallyImpacted];
  }
}
