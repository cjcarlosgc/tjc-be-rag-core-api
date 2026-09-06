import { describe, expect, it, vi } from 'vitest';
import { ArtifactService } from './artifact.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Artifact } from '../generated/prisma/client.js';

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

  it('rejects a relativePath that attempts directory traversal', async () => {
    const service = new ArtifactService({ put: vi.fn() } as never, { insertMany: vi.fn() } as never);

    await expect(
      service.persistFinalArtifacts('run-1', [
        { relativePath: '../etc/passwd', content: 'x', isNewFile: true, originalContent: null, valid: true },
      ]),
    ).rejects.toThrow();
  });

  it('throws ARTIFACT_NOT_FOUND when the artifact does not exist', async () => {
    const artifactsRepository = { findById: vi.fn().mockResolvedValue(null) };
    const service = new ArtifactService({} as never, artifactsRepository as never);

    await expect(service.downloadOne('missing')).rejects.toMatchObject({
      code: ErrorCode.ARTIFACT_NOT_FOUND,
    });
  });

  it('throws DIFF_NOT_AVAILABLE for a CREATED artifact', async () => {
    const artifactsRepository = {
      findById: vi.fn().mockResolvedValue(makeArtifact({ artifactType: 'CREATED' })),
    };
    const service = new ArtifactService({} as never, artifactsRepository as never);

    await expect(service.diff('artifact-1')).rejects.toMatchObject({
      code: ErrorCode.DIFF_NOT_AVAILABLE,
    });
  });

  it('computes the diff between the original and final content of a MODIFIED artifact', async () => {
    const artifact = makeArtifact({ artifactType: 'MODIFIED' });
    const artifactsRepository = { findById: vi.fn().mockResolvedValue(artifact) };
    const objectStorageService = {
      get: vi.fn((key: string) =>
        Promise.resolve(
          key.includes('originals') ? Buffer.from('line1') : Buffer.from('line1\nline2'),
        ),
      ),
    };
    const service = new ArtifactService(objectStorageService as never, artifactsRepository as never);

    const result = await service.diff('artifact-1');

    expect(result.lines).toEqual([
      { type: 'CONTEXT', oldLineNumber: 1, newLineNumber: 1, content: 'line1' },
      { type: 'ADDED', oldLineNumber: null, newLineNumber: 2, content: 'line2' },
    ]);
  });

  it('builds a zip with every artifact of the run for downloadAllAsZip', async () => {
    const artifactsRepository = {
      findByTestRun: vi.fn().mockResolvedValue([makeArtifact()]),
    };
    const objectStorageService = { get: vi.fn().mockResolvedValue(Buffer.from('content')) };
    const service = new ArtifactService(objectStorageService as never, artifactsRepository as never);

    const zipBuffer = await service.downloadAllAsZip('run-1');

    expect(zipBuffer.length).toBeGreaterThan(0);
    expect(objectStorageService.get).toHaveBeenCalledWith('test-runs/run-1/artifacts/src/foo.spec.ts');
  });
});
