import { describe, expect, it, vi } from 'vitest';
import { ArtifactService } from './artifact.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Artifact } from '../generated/prisma/client.js';

const OWNER_USER_ID = 'user-1';

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'artifact-1',
    testRunId: 'run-1',
    relativePath: 'src/foo.spec.ts',
    artifactType: 'MODIFIED',
    storageKey: 'test-runs/run-1/artifacts/src/foo.spec.ts',
    valid: true,
    createdAt: new Date(),
    ...overrides,
  } as Artifact;
}

describe('ArtifactService', () => {
  it('persists each file to storage and inserts the DB rows with the right artifactType', async () => {
    const objectStorageService = { put: vi.fn(), get: vi.fn() };
    const artifactsRepository = { insertMany: vi.fn() };
    const service = new ArtifactService(objectStorageService as never, artifactsRepository as never);

    await service.persistFinalArtifacts('run-1', [
      { relativePath: 'src/new.spec.ts', content: 'new', isNewFile: true, originalContent: null, valid: true },
      {
        relativePath: 'src/old.spec.ts',
        content: 'merged',
        isNewFile: false,
        originalContent: 'original',
        valid: false,
      },
    ]);

    expect(objectStorageService.put).toHaveBeenCalledWith(
      'test-runs/run-1/artifacts/src/new.spec.ts',
      Buffer.from('new', 'utf8'),
      'text/plain',
    );
    expect(objectStorageService.put).toHaveBeenCalledWith(
      'test-runs/run-1/artifacts/src/old.spec.ts',
      Buffer.from('merged', 'utf8'),
      'text/plain',
    );
    expect(objectStorageService.put).toHaveBeenCalledWith(
      'test-runs/run-1/originals/src/old.spec.ts',
      Buffer.from('original', 'utf8'),
      'text/plain',
    );
    // el CREATED no sube un "original" (no existía antes)
    expect(objectStorageService.put).toHaveBeenCalledTimes(3);

    expect(artifactsRepository.insertMany).toHaveBeenCalledWith('run-1', [
      {
        relativePath: 'src/new.spec.ts',
        artifactType: 'CREATED',
        storageKey: 'test-runs/run-1/artifacts/src/new.spec.ts',
        valid: true,
      },
      {
        relativePath: 'src/old.spec.ts',
        artifactType: 'MODIFIED',
        storageKey: 'test-runs/run-1/artifacts/src/old.spec.ts',
        valid: false,
      },
    ]);
  });

  it('persistRetriedArtifact (HU24) updates the existing artifact row in place instead of duplicating it', async () => {
    const objectStorageService = { put: vi.fn() };
    const existing = makeArtifact({ id: 'artifact-1', artifactType: 'MODIFIED', valid: false });
    const artifactsRepository = {
      findByTestRunAndPath: vi.fn().mockResolvedValue(existing),
      update: vi.fn(),
      insertMany: vi.fn(),
    };
    const service = new ArtifactService(objectStorageService as never, artifactsRepository as never);

    await service.persistRetriedArtifact('run-1', {
      relativePath: 'src/foo.spec.ts',
      content: 'fixed content',
      isNewFile: false,
      originalContent: 'original',
      valid: true,
    });

    expect(objectStorageService.put).toHaveBeenCalledWith(
      'test-runs/run-1/artifacts/src/foo.spec.ts',
      Buffer.from('fixed content', 'utf8'),
      'text/plain',
    );
    expect(artifactsRepository.update).toHaveBeenCalledWith('artifact-1', {
      relativePath: 'src/foo.spec.ts',
      artifactType: 'MODIFIED',
      storageKey: 'test-runs/run-1/artifacts/src/foo.spec.ts',
      valid: true,
    });
    expect(artifactsRepository.insertMany).not.toHaveBeenCalled();
  });

  it('persistRetriedArtifact (HU24) inserts a new row when no artifact existed yet for that path', async () => {
    const objectStorageService = { put: vi.fn() };
    const artifactsRepository = {
      findByTestRunAndPath: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      insertMany: vi.fn(),
    };
    const service = new ArtifactService(objectStorageService as never, artifactsRepository as never);

    await service.persistRetriedArtifact('run-1', {
      relativePath: 'src/new.spec.ts',
      content: 'new content',
      isNewFile: true,
      originalContent: null,
      valid: true,
    });

    expect(artifactsRepository.insertMany).toHaveBeenCalledWith('run-1', [
      {
        relativePath: 'src/new.spec.ts',
        artifactType: 'CREATED',
        storageKey: 'test-runs/run-1/artifacts/src/new.spec.ts',
        valid: true,
      },
    ]);
    expect(artifactsRepository.update).not.toHaveBeenCalled();
  });

  it('rejects a relativePath that attempts directory traversal', async () => {
    const service = new ArtifactService({ put: vi.fn() } as never, { insertMany: vi.fn() } as never);

    await expect(
      service.persistFinalArtifacts('run-1', [
        { relativePath: '../etc/passwd', content: 'x', isNewFile: true, originalContent: null, valid: true },
      ]),
    ).rejects.toThrow();
  });

  it('throws ARTIFACT_NOT_FOUND when the artifact does not exist or belongs to another owner', async () => {
    const artifactsRepository = { findByIdForOwner: vi.fn().mockResolvedValue(null) };
    const service = new ArtifactService({} as never, artifactsRepository as never);

    await expect(service.downloadOne('missing', OWNER_USER_ID)).rejects.toMatchObject({
      code: ErrorCode.ARTIFACT_NOT_FOUND,
    });
    expect(artifactsRepository.findByIdForOwner).toHaveBeenCalledWith('missing', OWNER_USER_ID);
  });

  it('throws DIFF_NOT_AVAILABLE for a CREATED artifact', async () => {
    const artifactsRepository = {
      findByIdForOwner: vi.fn().mockResolvedValue(makeArtifact({ artifactType: 'CREATED' })),
    };
    const service = new ArtifactService({} as never, artifactsRepository as never);

    await expect(service.diff('artifact-1', OWNER_USER_ID)).rejects.toMatchObject({
      code: ErrorCode.DIFF_NOT_AVAILABLE,
    });
  });

  it('computes the diff between the original and final content of a MODIFIED artifact', async () => {
    const artifact = makeArtifact({ artifactType: 'MODIFIED' });
    const artifactsRepository = { findByIdForOwner: vi.fn().mockResolvedValue(artifact) };
    const objectStorageService = {
      get: vi.fn((key: string) =>
        Promise.resolve(
          key.includes('originals') ? Buffer.from('line1') : Buffer.from('line1\nline2'),
        ),
      ),
    };
    const service = new ArtifactService(objectStorageService as never, artifactsRepository as never);

    const result = await service.diff('artifact-1', OWNER_USER_ID);

    expect(result.lines).toEqual([
      { type: 'CONTEXT', oldLineNumber: 1, newLineNumber: 1, content: 'line1' },
      { type: 'ADDED', oldLineNumber: null, newLineNumber: 2, content: 'line2' },
    ]);
  });

  it('builds a zip with every artifact of the run for downloadAllAsZip', async () => {
    const artifactsRepository = {
      testRunExistsForOwner: vi.fn().mockResolvedValue(true),
      findByTestRun: vi.fn().mockResolvedValue([makeArtifact()]),
    };
    const objectStorageService = { get: vi.fn().mockResolvedValue(Buffer.from('content')) };
    const service = new ArtifactService(objectStorageService as never, artifactsRepository as never);

    const zipBuffer = await service.downloadAllAsZip('run-1', OWNER_USER_ID);

    expect(zipBuffer.length).toBeGreaterThan(0);
    expect(artifactsRepository.testRunExistsForOwner).toHaveBeenCalledWith('run-1', OWNER_USER_ID);
    expect(objectStorageService.get).toHaveBeenCalledWith('test-runs/run-1/artifacts/src/foo.spec.ts');
  });

  it('throws TEST_RUN_NOT_FOUND from downloadAllAsZip when the run does not exist or belongs to another owner', async () => {
    const artifactsRepository = {
      testRunExistsForOwner: vi.fn().mockResolvedValue(false),
      findByTestRun: vi.fn(),
    };
    const service = new ArtifactService({} as never, artifactsRepository as never);

    await expect(service.downloadAllAsZip('missing-run', OWNER_USER_ID)).rejects.toMatchObject({
      code: ErrorCode.TEST_RUN_NOT_FOUND,
    });
    expect(artifactsRepository.findByTestRun).not.toHaveBeenCalled();
  });

  it('throws TEST_RUN_NOT_FOUND from listByTestRun when the run does not exist or belongs to another owner', async () => {
    const artifactsRepository = {
      testRunExistsForOwner: vi.fn().mockResolvedValue(false),
      findByTestRun: vi.fn(),
    };
    const service = new ArtifactService({} as never, artifactsRepository as never);

    await expect(service.listByTestRun('missing-run', OWNER_USER_ID)).rejects.toMatchObject({
      code: ErrorCode.TEST_RUN_NOT_FOUND,
    });
    expect(artifactsRepository.findByTestRun).not.toHaveBeenCalled();
  });

  it('lists artifacts of an owned run', async () => {
    const artifactsRepository = {
      testRunExistsForOwner: vi.fn().mockResolvedValue(true),
      findByTestRun: vi.fn().mockResolvedValue([makeArtifact()]),
    };
    const service = new ArtifactService({} as never, artifactsRepository as never);

    const artifacts = await service.listByTestRun('run-1', OWNER_USER_ID);

    expect(artifacts).toHaveLength(1);
  });
});
