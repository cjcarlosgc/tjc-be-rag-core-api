import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JobsService } from '../jobs/jobs.service.js';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { INDEXING_JOB_TYPE, isSourceFile, isTestFile } from './indexing.constants.js';
import { ProjectVersionsRepository } from './project-versions.repository.js';
import { CodeChunksRepository } from './persistence/code-chunks.repository.js';
import { TestTargetsRepository } from './persistence/test-targets.repository.js';
import { ZipExtractionService, type ExtractedWorkspace } from './zip/zip-extraction.service.js';
import { FileDiscoveryService } from './discovery/file-discovery.service.js';
import { TypeScriptParserService } from './parsing/typescript-parser.service.js';
import { TestTargetExtractorService } from './inventory/test-target-extractor.service.js';
import { ExistingTestResolverService } from './inventory/existing-test-resolver.service.js';
import { detectFramework } from './inventory/framework-detector.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { EMBEDDING_PROVIDER } from '../providers/providers.constants.js';
import type { EmbeddingProvider } from '../providers/embedding-provider.interface.js';
import { ProjectVersionStatus } from '../generated/prisma/enums.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { toProjectVersionResponse } from './dto/project-version.response.js';

export interface IndexingJobPayload {
  projectVersionId: string;
  projectId: string;
  snapshotKey: string;
}

@Injectable()
export class IndexingJobHandler implements JobHandler<IndexingJobPayload>, OnModuleInit {
  readonly type = INDEXING_JOB_TYPE;
  private readonly logger = new Logger(IndexingJobHandler.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly projectVersionsRepository: ProjectVersionsRepository,
    private readonly codeChunksRepository: CodeChunksRepository,
    private readonly testTargetsRepository: TestTargetsRepository,
    private readonly zipExtractionService: ZipExtractionService,
    private readonly fileDiscoveryService: FileDiscoveryService,
    private readonly typeScriptParserService: TypeScriptParserService,
    private readonly testTargetExtractorService: TestTargetExtractorService,
    private readonly existingTestResolverService: ExistingTestResolverService,
    private readonly objectStorageService: ObjectStorageService,
    private readonly realtimeGateway: RealtimeGateway,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
  ) {}

  onModuleInit(): void {
    this.jobsService.registerHandler(this);
  }

  async handle(payload: IndexingJobPayload): Promise<void> {
    const version = await this.projectVersionsRepository.findById(payload.projectVersionId);

    if (!version) {
      this.logger.warn(`ProjectVersion ${payload.projectVersionId} ya no existe; se omite el job.`);
      return;
    }

    if (version.status === ProjectVersionStatus.COMPLETED) {
      return;
    }

    let workspace: ExtractedWorkspace | undefined;

    try {
      await this.projectVersionsRepository.markStarted(payload.projectVersionId);
      await this.emitProgress(payload.projectVersionId);

      const zipBuffer = await this.objectStorageService.get(payload.snapshotKey);
      workspace = await this.zipExtractionService.extract(zipBuffer);

      await this.projectVersionsRepository.setStatus(
        payload.projectVersionId,
        ProjectVersionStatus.ANALYZING,
      );
      await this.emitProgress(payload.projectVersionId);
      const discoveredFiles = await this.fileDiscoveryService.discover(workspace.dir);
      const sourceFiles = discoveredFiles.filter((path) => isSourceFile(path));
      const parsedChunks = this.typeScriptParserService.parse(workspace.dir, sourceFiles);

      await this.projectVersionsRepository.setStatus(
        payload.projectVersionId,
        ProjectVersionStatus.CHUNKING,
      );
      await this.emitProgress(payload.projectVersionId);

      const testFiles = sourceFiles.filter((path) => isTestFile(path));
      const productionFiles = sourceFiles.filter((path) => !isTestFile(path));
      const targetCandidates = this.testTargetExtractorService.extract(
        workspace.dir,
        productionFiles,
      );
      const resolvedTargets = this.existingTestResolverService.resolve(
        workspace.dir,
        testFiles,
        targetCandidates,
      );
      const packageJsonContent = await this.readPackageJsonIfPresent(
        workspace.dir,
        discoveredFiles,
      );
      const detectedFramework = detectFramework(packageJsonContent, discoveredFiles);

      await this.projectVersionsRepository.setStatus(
        payload.projectVersionId,
        ProjectVersionStatus.EMBEDDING,
      );
      await this.emitProgress(payload.projectVersionId);
      const embeddings =
        parsedChunks.length > 0
          ? await this.embeddingProvider.embedMany(parsedChunks.map((chunk) => chunk.content))
          : [];

      await this.projectVersionsRepository.setStatus(
        payload.projectVersionId,
        ProjectVersionStatus.PERSISTING,
      );
      await this.emitProgress(payload.projectVersionId);
      await this.codeChunksRepository.deleteByProjectVersion(payload.projectVersionId);
      await this.codeChunksRepository.insertMany(
        payload.projectVersionId,
        parsedChunks.map((chunk, index) => ({
          ...chunk,
          embedding: embeddings[index],
        })),
      );

      await this.testTargetsRepository.deleteByProjectVersion(payload.projectVersionId);
      await this.testTargetsRepository.insertMany(payload.projectVersionId, resolvedTargets);

      await this.projectVersionsRepository.completeAndPromote(
        payload.projectId,
        payload.projectVersionId,
        {
          filesProcessed: discoveredFiles.length,
          chunksCount: parsedChunks.length,
          detectedFramework,
          targetsTotal: resolvedTargets.length,
          targetsWithTest: resolvedTargets.filter((target) => target.hasTest).length,
        },
      );
      await this.emitProgress(payload.projectVersionId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Fallo desconocido durante la indexación.';
      await this.projectVersionsRepository.markFailed(payload.projectVersionId, message);
      await this.emitProgress(payload.projectVersionId);
      throw error;
    } finally {
      if (workspace) {
        await workspace.cleanup();
      }
    }
  }

  private async emitProgress(projectVersionId: string): Promise<void> {
    const version = await this.projectVersionsRepository.findById(projectVersionId);

    if (version) {
      this.realtimeGateway.emitProjectVersionUpdate(projectVersionId, toProjectVersionResponse(version));
    }
  }

  private async readPackageJsonIfPresent(
    rootDir: string,
    discoveredFiles: string[],
  ): Promise<string | undefined> {
    if (!discoveredFiles.includes('package.json')) {
      return undefined;
    }

    try {
      return await readFile(join(rootDir, 'package.json'), 'utf8');
    } catch {
      return undefined;
    }
  }
}
