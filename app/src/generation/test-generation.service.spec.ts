import { describe, expect, it, vi } from 'vitest';
import { TestGenerationService } from './test-generation.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    mode: 'PROJECT_MISSING',
    status: 'COMPLETED',
    totalTargets: 3,
    validTargets: 2,
    invalidTargets: 1,
    failedTargets: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: new Date('2026-01-01T00:05:00.000Z'),
    ...overrides,
  };
}

function makeService(overrides: Record<string, unknown> = {}) {
  const deps = {
    projectsRepository: {},
    projectVersionsRepository: { findById: vi.fn().mockResolvedValue({ id: 'version-1' }) },
    testGenerationRunsRepository: { findByProjectVersion: vi.fn().mockResolvedValue([]) },
    jobsService: {},
    configService: { get: (_key: string, fallback?: unknown) => fallback },
    ...overrides,
  };

  return new TestGenerationService(
    deps.projectsRepository as never,
    deps.projectVersionsRepository as never,
    deps.testGenerationRunsRepository as never,
    deps.jobsService as never,
    deps.configService as never,
  );
}

describe('TestGenerationService.getHistory', () => {
  it('throws PROJECT_VERSION_NOT_FOUND when the version does not exist', async () => {
    const service = makeService({
      projectVersionsRepository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.getHistory('missing', undefined, undefined)).rejects.toMatchObject({
      code: ErrorCode.PROJECT_VERSION_NOT_FOUND,
    });
  });

  it('requests one extra row to detect a next page and strips it from the returned items', async () => {
    const findByProjectVersion = vi
      .fn()
      .mockResolvedValue([makeRun({ id: 'run-3' }), makeRun({ id: 'run-2' }), makeRun({ id: 'run-1' })]);
    const service = makeService({
      testGenerationRunsRepository: { findByProjectVersion },
    });

    const page = await service.getHistory('version-1', 2, undefined);

    expect(findByProjectVersion).toHaveBeenCalledWith('version-1', 2, undefined);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.id)).toEqual(['run-3', 'run-2']);
    expect(page.nextCursor).toBe('run-2');
  });

  it('returns nextCursor null when there is no further page', async () => {
    const findByProjectVersion = vi.fn().mockResolvedValue([makeRun({ id: 'run-1' })]);
    const service = makeService({ testGenerationRunsRepository: { findByProjectVersion } });

    const page = await service.getHistory('version-1', 20, undefined);

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('maps summary fields correctly', async () => {
    const findByProjectVersion = vi.fn().mockResolvedValue([makeRun()]);
    const service = makeService({ testGenerationRunsRepository: { findByProjectVersion } });

    const page = await service.getHistory('version-1', undefined, undefined);

    expect(page.items[0]).toEqual({
      id: 'run-1',
      mode: 'PROJECT_MISSING',
      status: 'COMPLETED',
      totalTargets: 3,
      validTargets: 2,
      invalidTargets: 1,
      failedTargets: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:05:00.000Z',
    });
  });

  it('passes the cursor through to the repository', async () => {
    const findByProjectVersion = vi.fn().mockResolvedValue([]);
    const service = makeService({ testGenerationRunsRepository: { findByProjectVersion } });

    await service.getHistory('version-1', 10, 'run-5');

    expect(findByProjectVersion).toHaveBeenCalledWith('version-1', 10, 'run-5');
  });
});
