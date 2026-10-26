import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { RescheduleJobError } from '../jobs/reschedule-job.error.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { RepositoryBindingsRepository } from '../repository-bindings/repository-bindings.repository.js';
import { ProjectVersionsRepository } from '../project-versions/project-versions.repository.js';
import { CodeChunksRepository, type ChunkToPersist } from '../project-versions/persistence/code-chunks.repository.js';
import { TestTargetsRepository } from '../project-versions/persistence/test-targets.repository.js';
import { FileDiscoveryService } from '../project-versions/discovery/file-discovery.service.js';
import { TypeScriptParserService, type ParsedChunk } from '../project-versions/parsing/typescript-parser.service.js';
import { PhpParserService } from '../project-versions/parsing/php-parser.service.js';
import { TestTargetExtractorService } from '../project-versions/inventory/test-target-extractor.service.js';
import { ExistingTestResolverService } from '../project-versions/inventory/existing-test-resolver.service.js';
import { PhpExistingTestResolverService } from '../project-versions/inventory/php-existing-test-resolver.service.js';
import {
  detectFramework,
  detectPhpFramework,
  detectProjectLanguage,
  findPackageJsonPath,
} from '../project-versions/inventory/framework-detector.js';
import {
  isComposerManifest,
  isPhpSourceFile,
  isTestFile,
  isTypeScriptSourceFile,
} from '../project-versions/indexing.constants.js';
import { GithubRepositoryContentService, type CompareFile } from '../github-app/github-repository-content.service.js';
import { GithubAppUnavailableError } from '../github-app/github-app-auth.service.js';
import { GithubSnapshotMaterializerService } from './github-snapshot-materializer.service.js';
import { AnalysisSymbolsRepository, type AnalysisSymbolToPersist } from '../analysis-runs/persistence/analysis-symbols.repository.js';
import { FunctionalContextEvaluatorService } from '../functional-knowledge/functional-context-evaluator.service.js';
import { SymbolBehaviorConstructsService } from '../functional-knowledge/symbol-behavior-constructs.service.js';
import { ANALYSIS_RUN_VALIDATION_JOB_TYPE } from '../validation/analysis-run-validation-job.handler.js';
import { AnalysisRunChecksService } from '../checks/analysis-run-checks.service.js';
import { EMBEDDING_PROVIDER } from '../providers/providers.constants.js';
import type { EmbeddingProvider } from '../providers/embedding-provider.interface.js';
import type { ExtractedWorkspace } from '../project-versions/zip/zip-extraction.service.js';
import type { AnalysisIndexMode, CodeChunk, RepositoryBinding } from '../generated/prisma/client.js';
import { ProjectLanguage, type TestFramework } from '../generated/prisma/enums.js';
import type { ResolvedTestTarget } from '../project-versions/inventory/existing-test-resolver.service.js';
import { resolveUniqueComposerRoot, validateProjectRoot } from '../project-versions/project-root.util.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { zipDirectory } from '../project-versions/zip/zip-directory.util.js';

export interface SnapshotAnalysisJobPayload {
  analysisRunId: string;
  ambiguousSnapshotParking?: {
    headSha: string;
    policyVersion: number;
    deferrals: number;
  };
}

export const SNAPSHOT_ANALYSIS_JOB_TYPE = 'snapshot-analysis';

export const COMPARE_UNVERIFIABLE_RESULT_SUMMARY =
  'No se pudo verificar el compare de GitHub (por ejemplo, un PR con 300 o más archivos); análisis no realizado';

class CompareUnverifiableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = CompareUnverifiableError.name;
  }
}

const CHUNK_SYMBOL_TO_ANALYSIS_KIND: Record<ParsedChunk['symbolKind'], AnalysisSymbolToPersist['kind'] | null> = {
  CLASS: 'CLASS',
  METHOD: 'METHOD',
  CONSTRUCTOR: 'METHOD',
  FUNCTION: 'FUNCTION',
  INTERFACE: 'INTERFACE',
  TRAIT: 'TRAIT',
  TYPE_ALIAS: 'TYPE',
  ENUM: 'ENUM',
  FILE: null,
};

const AMBIGUOUS_SNAPSHOT_RETRY_BASE_MS = 60_000;
const AMBIGUOUS_SNAPSHOT_RETRY_MAX_MS = 86_400_000;
// Increment this when the ambiguity policy changes so pending jobs can resume discovery.
const AMBIGUOUS_SNAPSHOT_POLICY_VERSION = 1;

function ambiguousSnapshotRetryDelay(deferrals: number): number {
  return Math.min(
    AMBIGUOUS_SNAPSHOT_RETRY_BASE_MS * 2 ** Math.min(deferrals, 16),
    AMBIGUOUS_SNAPSHOT_RETRY_MAX_MS,
  );
}

function validDeferrals(value: unknown): number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0 ? value : 0;
}

interface ChunkIdentityFields {
  filePath: string;
  symbolKind: string;
  symbolName: string | null;
  parentSymbolName: string | null;
}

function chunkIdentity(chunk: ChunkIdentityFields): string {
  return `${chunk.filePath}::${chunk.symbolKind}::${chunk.symbolName ?? ''}::${chunk.parentSymbolName ?? ''}`;
}

function withProjectRoot(projectRoot: string, path: string): string {
  return projectRoot === '.' ? path : `${projectRoot}/${path}`;
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
    private readonly phpParserService: PhpParserService,
    private readonly testTargetExtractorService: TestTargetExtractorService,
    private readonly existingTestResolverService: ExistingTestResolverService,
    private readonly phpExistingTestResolverService: PhpExistingTestResolverService,
    private readonly githubRepositoryContentService: GithubRepositoryContentService,
    private readonly githubSnapshotMaterializerService: GithubSnapshotMaterializerService,
    private readonly analysisSymbolsRepository: AnalysisSymbolsRepository,
    private readonly symbolBehaviorConstructsService: SymbolBehaviorConstructsService,
    private readonly functionalContextEvaluatorService: FunctionalContextEvaluatorService,
    private readonly analysisRunChecksService: AnalysisRunChecksService,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    private readonly objectStorageService: ObjectStorageService,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: SnapshotAnalysisJobPayload): Promise<void> {
    const initialRun = await this.analysisRunsRepository.findById(payload.analysisRunId);

    if (!initialRun || initialRun.status !== 'QUEUED') {
      return;
    }

    const parking = payload.ambiguousSnapshotParking;
    if (
      parking?.headSha === initialRun.headSha
      && parking.policyVersion === AMBIGUOUS_SNAPSHOT_POLICY_VERSION
    ) {
      const deferrals = validDeferrals(parking.deferrals);
      throw new RescheduleJobError(
        ambiguousSnapshotRetryDelay(deferrals),
        'Snapshot has multiple Composer manifests; execution awaits the pending project-root decision.',
        {
          analysisRunId: initialRun.id,
          ambiguousSnapshotParking: {
            headSha: initialRun.headSha,
            policyVersion: AMBIGUOUS_SNAPSHOT_POLICY_VERSION,
            deferrals: deferrals + 1,
          },
        },
      );
    }

    const binding = await this.repositoryBindingsRepository.findForRun(initialRun);

    if (!binding) {
      const failed = await this.analysisRunsService.completeRunFromSystem(initialRun, 'INFRASTRUCTURE_FAILURE', {
        resultSummary: `No se encontró el repository binding para "${initialRun.repositoryId}".`,
      });
      if (failed) {
        await this.analysisRunChecksService.publishForRun(failed);
      }
      return;
    }

    let run = initialRun;
    let workspace: ExtractedWorkspace | undefined;

    try {
      workspace = await this.githubSnapshotMaterializerService.materialize(binding, run.headSha);

      const discovered = await this.fileDiscoveryService.discover(workspace.dir);
      const composerCandidateCount = discovered.filter((path) =>
        isComposerManifest(path),
      ).length;

      if (composerCandidateCount > 1) {
        throw new RescheduleJobError(
          ambiguousSnapshotRetryDelay(0),
          'Snapshot has multiple Composer manifests; execution awaits the pending project-root decision.',
          {
            analysisRunId: run.id,
            ambiguousSnapshotParking: {
              headSha: run.headSha,
              policyVersion: AMBIGUOUS_SNAPSHOT_POLICY_VERSION,
              deferrals: 1,
            },
          },
        );
      }

      const uniqueComposerRoot = resolveUniqueComposerRoot(discovered);
      // Only the contract-approved single-candidate case changes the active root.
      // Zero candidates preserve legacy analysis from repository root.
      const selectedProjectRoot = uniqueComposerRoot ?? '.';
      await validateProjectRoot(workspace.dir, selectedProjectRoot);

      run = await this.analysisRunsService.startProcessing(run);
      let changesetFiles: CompareFile[];
      try {
        changesetFiles = await this.githubRepositoryContentService.compare(
          binding.installationId,
          binding.repositoryName,
          run.baseSha,
          run.headSha,
        );
      } catch (error) {
        if (error instanceof GithubAppUnavailableError && error.lookupStatus === 'UNVERIFIABLE') {
          throw new CompareUnverifiableError(error.message);
        }
        throw error;
      }

      const previousVersion = await this.projectVersionsRepository.findLatestCompletedByProject(
        run.projectId,
      );
      const indexMode: AnalysisIndexMode = previousVersion ? 'INCREMENTAL' : 'BOOTSTRAP';
      const indexDeltaBaseSha = previousVersion?.commitSha ?? null;

      const language = uniqueComposerRoot
        ? ProjectLanguage.PHP
        : detectProjectLanguage(discovered);
      const isPhp = language === ProjectLanguage.PHP;
      const scopedDiscovered = discovered.filter((path) =>
        selectedProjectRoot === '.' || path.startsWith(`${selectedProjectRoot}/`),
      ).map((path) => selectedProjectRoot === '.' ? path : path.slice(selectedProjectRoot.length + 1));
      const sourceFiles = scopedDiscovered.filter((path) =>
        isPhp ? isPhpSourceFile(path) : isTypeScriptSourceFile(path),
      );
      const testFiles = sourceFiles.filter((path) => isTestFile(path));
      const productionFiles = sourceFiles.filter((path) => !isTestFile(path));

      let chunks: ParsedChunk[];
      let resolvedTargets: ResolvedTestTarget[];
      let detectedFramework: TestFramework | null;

      if (isPhp) {
        const projectWorkspaceDir = selectedProjectRoot === '.'
          ? workspace.dir
          : join(workspace.dir, selectedProjectRoot);
        const analysis = await this.phpParserService.analyze(projectWorkspaceDir, sourceFiles);
        chunks = analysis.chunks.map((chunk) => ({
          ...chunk,
          filePath: withProjectRoot(selectedProjectRoot, chunk.filePath),
        }));
        resolvedTargets = await this.phpExistingTestResolverService.resolve(
          projectWorkspaceDir,
          testFiles,
          analysis.candidates.filter((candidate) => !testFiles.includes(candidate.filePath)),
        );
        resolvedTargets = resolvedTargets.map((target) => ({
          ...target,
          filePath: withProjectRoot(selectedProjectRoot, target.filePath),
          testFilePaths: target.testFilePaths.map((path) => withProjectRoot(selectedProjectRoot, path)),
        }));
        const composerJson = await readFile(join(projectWorkspaceDir, 'composer.json'), 'utf8').catch(() => undefined);
        detectedFramework = detectPhpFramework(composerJson, scopedDiscovered);
      } else {
        chunks = this.typeScriptParserService.parse(workspace.dir, sourceFiles);
        const candidates = this.testTargetExtractorService.extract(workspace.dir, productionFiles);
        resolvedTargets = this.existingTestResolverService.resolve(workspace.dir, testFiles, candidates);
        const packageJsonPath = findPackageJsonPath(scopedDiscovered);
        const packageJsonContent = packageJsonPath
          ? await readFile(join(workspace.dir, packageJsonPath), 'utf8').catch(() => undefined)
          : undefined;
        detectedFramework = detectFramework(packageJsonContent, scopedDiscovered);
      }

      const embeddings =
        chunks.length > 0 ? await this.embeddingProvider.embedMany(chunks.map((c) => c.content)) : [];
      const chunksToPersist: ChunkToPersist[] = chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddings[index],
      }));

      const version = await this.projectVersionsRepository.createPending({
        projectId: run.projectId,
        commitSha: run.headSha,
        language,
        effectiveProjectRoot: isPhp ? selectedProjectRoot : '.',
      });
      await this.projectVersionsRepository.markStarted(version.id);
      await this.codeChunksRepository.insertMany(version.id, chunksToPersist);
      await this.testTargetsRepository.insertMany(version.id, resolvedTargets);
      await this.projectVersionsRepository.completeAndPromote(run.projectId, version.id, {
        filesProcessed: scopedDiscovered.length,
        chunksCount: chunksToPersist.length,
        detectedFramework,
        targetsTotal: resolvedTargets.length,
        targetsWithTest: resolvedTargets.filter((t) => t.hasTest).length,
        projectRoot: selectedProjectRoot,
      });

      await this.persistSnapshot(version.id, workspace.dir, binding, run.headSha);

      let symbols = await this.detectSymbols(
        chunksToPersist,
        changesetFiles,
        indexMode,
        previousVersion?.id,
        language,
      );

      // WI-CORE-018 (DEC-FK-003) y WI-CORE-052: construcciones nuevas o modificadas, calculadas con el
      // HEAD del workspace y la base del Run. PHP ya participa; el servicio despacha por lenguaje.
      const behaviorConstructs = await this.symbolBehaviorConstructsService.compute(
        {
          workspaceDir: workspace.dir,
          installationId: binding.installationId,
          repositoryName: binding.repositoryName,
          baseSha: run.baseSha,
          changesetFiles,
        },
        symbols,
      );
      symbols = symbols.map((symbol, index) => ({ ...symbol, behaviorConstructs: behaviorConstructs[index] }));

      await this.analysisSymbolsRepository.insertMany(run.id, symbols);

      run = await this.analysisRunsService.recordSnapshot(run, {
        indexMode,
        indexDeltaBaseSha,
        projectVersionId: version.id,
      });

      const changesetTouchesSource = changesetFiles.some((file) => {
        const filePath = file.filename;
        const isInEffectiveProject = selectedProjectRoot === '.'
          || filePath.startsWith(`${selectedProjectRoot}/`);
        return isInEffectiveProject
          && (isPhp ? isPhpSourceFile(filePath) : isTypeScriptSourceFile(filePath));
      });

      if (!changesetTouchesSource) {
        const completed = await this.analysisRunsService.completeRunFromSystem(run, 'NO_TEST_RELEVANT_CHANGES', {
          resultSummary: 'El CHANGESET no incluye cambios en archivos fuente (solo docs/config/formato).',
        });
        if (completed) {
          await this.analysisRunChecksService.publishForRun(completed);
        }
      } else {
        // HU35/36: si falta conocimiento funcional para algún símbolo
        // DIRECTLY_CHANGED, el Run termina en ACTION_REQUIRED aquí. Si hay
        // contexto suficiente, se encola el job de Validation (corte
        // plan.md #6: generación+Sandbox+clasificación).
        const evaluation = await this.functionalContextEvaluatorService.evaluate(run);

        if (evaluation.actionRequired) {
          await this.analysisRunChecksService.publishForRun(evaluation.analysisRun);
        } else {
          await this.jobsService.enqueue(ANALYSIS_RUN_VALIDATION_JOB_TYPE, { analysisRunId: run.id });
        }
      }
    } catch (error) {
      if (error instanceof RescheduleJobError) throw error;

      if (run.status === 'QUEUED') {
        run = await this.analysisRunsService.startProcessing(run);
      }

      if (error instanceof CompareUnverifiableError) {
        this.logger.warn(`AnalysisRun ${run.id}: el compare de GitHub no pudo verificarse; análisis no realizado.`);
        const failed = await this.analysisRunsService.completeRunFromSystem(run, 'INFRASTRUCTURE_FAILURE', {
          resultSummary: COMPARE_UNVERIFIABLE_RESULT_SUMMARY,
        });
        if (failed) {
          await this.analysisRunChecksService.publishForRun(failed);
        } else {
          this.logger.debug(`Se omite el fallo tardío del AnalysisRun ${run.id}: el Run ya no admite esa transición.`);
        }
        return;
      }

      const message = error instanceof Error ? error.message : 'Error desconocido en snapshot intelligence.';
      this.logger.error(`AnalysisRun ${run.id} falló en snapshot intelligence: ${message}`);
      const failed = await this.analysisRunsService.completeRunFromSystem(run, 'INFRASTRUCTURE_FAILURE', {
        resultSummary: message,
      });
      if (failed) {
        await this.analysisRunChecksService.publishForRun(failed);
        throw error;
      }

      this.logger.debug(`Se omite el fallo tardío del AnalysisRun ${run.id}: el Run ya no admite esa transición.`);
    } finally {
      await workspace?.cleanup();
    }
  }

  /**
   * Persiste el snapshot del workspace y lo enlaza a la ProjectVersion. Un fallo
   * no bloquea el Run: se registra solo el nombre del error (sin mensaje, que
   * puede traer URLs firmadas) y `snapshotKey` queda sin definir.
   */
  private async persistSnapshot(
    versionId: string,
    workspaceDir: string,
    binding: RepositoryBinding,
    headSha: string,
  ): Promise<void> {
    try {
      // Fixtures de texto solo para el Sandbox (WI-CORE-102): después de indexar y antes de zipear.
      await this.githubSnapshotMaterializerService.addSandboxFixtures(binding, headSha, workspaceDir);
      const snapshotBuffer = zipDirectory(workspaceDir);
      const snapshotKey = `project-versions/${versionId}/snapshot.zip`;
      await this.objectStorageService.put(snapshotKey, snapshotBuffer, 'application/zip');
      await this.projectVersionsRepository.setSnapshotKey(versionId, snapshotKey);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'desconocido';
      this.logger.warn(
        `ProjectVersion ${versionId}: no se pudo persistir el snapshot (${errorName}); snapshotKey queda sin definir.`,
      );
    }
  }

  private async detectSymbols(
    chunks: ChunkToPersist[],
    changesetFiles: CompareFile[],
    indexMode: AnalysisIndexMode,
    previousVersionId: string | undefined,
    language: ProjectLanguage,
  ): Promise<AnalysisSymbolToPersist[]> {
    const changedFilePaths = new Set(changesetFiles.map((file) => file.filename));
    const changedFilePathsWithoutExt = new Set(
      changesetFiles.map((file) => file.filename.replace(/\.(?:tsx?|php)$/i, '')),
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
            language: language === ProjectLanguage.PHP ? 'PHP' : 'TYPESCRIPT',
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
          language: language === ProjectLanguage.PHP ? 'PHP' : 'TYPESCRIPT',
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
