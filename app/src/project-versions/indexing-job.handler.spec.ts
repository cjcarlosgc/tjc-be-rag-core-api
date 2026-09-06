import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexingJobHandler } from './indexing-job.handler.js';
import type { ProjectVersion } from '../generated/prisma/client.js';

describe('IndexingJobHandler', () => {
  let jobsService: { registerHandler: ReturnType<typeof vi.fn> };
  let projectVersionsRepository: {
    findById: ReturnType<typeof vi.fn>;
    markStarted: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
    completeAndPromote: ReturnType<typeof vi.fn>;
  };
  let codeChunksRepository: { deleteByProjectVersion: ReturnType<typeof vi.fn>; insertMany: ReturnType<typeof vi.fn> };
  let testTargetsRepository: { deleteByProjectVersion: ReturnType<typeof vi.fn>; insertMany: ReturnType<typeof vi.fn> };
  let zipExtractionService: { extract: ReturnType<typeof vi.fn> };
  let fileDiscoveryService: { discover: ReturnType<typeof vi.fn> };
  let typeScriptParserService: { parse: ReturnType<typeof vi.fn> };
  let testTargetExtractorService: { extract: ReturnType<typeof vi.fn> };
  let existingTestResolverService: { resolve: ReturnType<typeof vi.fn> };
  let objectStorageProvider: { get: ReturnType<typeof vi.fn> };
  let embeddingProvider: { embedMany: ReturnType<typeof vi.fn> };
  let cleanup: ReturnType<typeof vi.fn>;
  let handler: IndexingJobHandler;

  const pendingVersion: Partial<ProjectVersion> = { id: 'version-1', status: 'PENDING' };
  const payload = { projectVersionId: 'version-1', projectId: 'project-1', snapshotKey: 'key' };

  beforeEach(() => {
    cleanup = vi.fn().mockResolvedValue(undefined);
    jobsService = { registerHandler: vi.fn() };
    projectVersionsRepository = {
      findById: vi.fn().mockResolvedValue(pendingVersion),
      markStarted: vi.fn(),
      setStatus: vi.fn(),
      markFailed: vi.fn(),
      completeAndPromote: vi.fn(),
    };
    codeChunksRepository = { deleteByProjectVersion: vi.fn(), insertMany: vi.fn() };
    testTargetsRepository = { deleteByProjectVersion: vi.fn(), insertMany: vi.fn() };
    zipExtractionService = { extract: vi.fn().mockResolvedValue({ dir: '/tmp/work', cleanup }) };
    fileDiscoveryService = {
      discover: vi.fn().mockResolvedValue(['package.json', 'src/index.ts']),
    };
    typeScriptParserService = {
      parse: vi.fn().mockReturnValue([
        {
          filePath: 'src/index.ts',
          symbolKind: 'FUNCTION',
          symbolName: 'hello',
          startLine: 1,
          endLine: 3,
          content: 'function hello() {}',
        },
      ]),
    };
    testTargetExtractorService = {
      extract: vi.fn().mockReturnValue([
        {
          filePath: 'src/index.ts',
          symbolName: 'hello',
          methodName: null,
          targetType: 'FUNCTION',
          startLine: 1,
          endLine: 3,
        },
      ]),
    };
    existingTestResolverService = {
      resolve: vi.fn().mockReturnValue([
        {
          filePath: 'src/index.ts',
          symbolName: 'hello',
          methodName: null,
          targetType: 'FUNCTION',
          startLine: 1,
          endLine: 3,
          hasTest: false,
          testFilePaths: [],
        },
      ]),
    };
    objectStorageProvider = { get: vi.fn().mockResolvedValue(Buffer.from('zip')) };
    embeddingProvider = { embedMany: vi.fn().mockResolvedValue([[0.1, 0.2]]) };

    handler = new IndexingJobHandler(
      jobsService as never,
      projectVersionsRepository as never,
      codeChunksRepository as never,
      testTargetsRepository as never,
      zipExtractionService as never,
      fileDiscoveryService as never,
      typeScriptParserService as never,
      testTargetExtractorService as never,
      existingTestResolverService as never,
      objectStorageProvider as never,
      embeddingProvider as never,
    );
  });

  it('registers itself with the jobs service on module init', () => {
    handler.onModuleInit();

    expect(jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('runs the full pipeline and completes the version', async () => {
    await handler.handle(payload);

    expect(projectVersionsRepository.markStarted).toHaveBeenCalledWith('version-1');
    expect(zipExtractionService.extract).toHaveBeenCalledWith(Buffer.from('zip'));
    expect(fileDiscoveryService.discover).toHaveBeenCalledWith('/tmp/work');
    expect(typeScriptParserService.parse).toHaveBeenCalledWith('/tmp/work', ['src/index.ts']);
    expect(codeChunksRepository.deleteByProjectVersion).toHaveBeenCalledWith('version-1');
    expect(codeChunksRepository.insertMany).toHaveBeenCalledWith(
      'version-1',
      expect.arrayContaining([expect.objectContaining({ embedding: [0.1, 0.2] })]),
    );
    expect(testTargetExtractorService.extract).toHaveBeenCalledWith('/tmp/work', ['src/index.ts']);
    expect(existingTestResolverService.resolve).toHaveBeenCalledWith(
      '/tmp/work',
      [],
      expect.any(Array),
    );
    expect(testTargetsRepository.deleteByProjectVersion).toHaveBeenCalledWith('version-1');
    expect(testTargetsRepository.insertMany).toHaveBeenCalledWith(
      'version-1',
      expect.arrayContaining([expect.objectContaining({ symbolName: 'hello' })]),
    );
    expect(projectVersionsRepository.completeAndPromote).toHaveBeenCalledWith('project-1', 'version-1', {
      filesProcessed: 2,
      chunksCount: 1,
      detectedFramework: null,
      targetsTotal: 1,
      targetsWithTest: 0,
    });
    expect(cleanup).toHaveBeenCalled();
    expect(projectVersionsRepository.markFailed).not.toHaveBeenCalled();
  });

  it('is a no-op when the version is already COMPLETED', async () => {
    projectVersionsRepository.findById.mockResolvedValue({ id: 'version-1', status: 'COMPLETED' });

    await handler.handle(payload);

    expect(zipExtractionService.extract).not.toHaveBeenCalled();
  });

  it('is a no-op when the version no longer exists', async () => {
    projectVersionsRepository.findById.mockResolvedValue(null);

    await handler.handle(payload);

    expect(projectVersionsRepository.markStarted).not.toHaveBeenCalled();
  });

  it('marks the version as FAILED and rethrows when a stage fails before extraction', async () => {
    objectStorageProvider.get.mockRejectedValue(new Error('storage down'));

    await expect(handler.handle(payload)).rejects.toThrow('storage down');

    expect(projectVersionsRepository.markFailed).toHaveBeenCalledWith('version-1', 'storage down');
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('marks the version as FAILED, cleans up the workspace and rethrows on a later stage failure', async () => {
    embeddingProvider.embedMany.mockRejectedValue(new Error('embedding provider unavailable'));

    await expect(handler.handle(payload)).rejects.toThrow('embedding provider unavailable');

    expect(projectVersionsRepository.markFailed).toHaveBeenCalledWith(
      'version-1',
      'embedding provider unavailable',
    );
    expect(cleanup).toHaveBeenCalled();
  });
});
