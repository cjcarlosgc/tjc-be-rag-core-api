import { describe, expect, it, vi } from 'vitest';
import { ExperimentsService } from './experiments.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    projectsRepository: {
      findById: vi.fn().mockResolvedValue({ id: 'project-1', currentVersionId: 'version-1' }),
    },
    projectVersionsRepository: {
      hasActiveVersion: vi.fn().mockResolvedValue(false),
      findById: vi.fn().mockResolvedValue({ id: 'version-1', status: 'COMPLETED' }),
    },
    testTargetsRepository: {
      findById: vi.fn().mockResolvedValue({ id: 'target-1', targetType: 'FUNCTION' }),
    },
    experimentRunsRepository: {
      create: vi.fn().mockResolvedValue({ id: 'exp-1' }),
      findById: vi.fn(),
      findRepetitions: vi.fn(),
    },
    jobsService: { enqueue: vi.fn().mockResolvedValue('job-1') },
    configService: { get: (key: string, fallback?: unknown) => fallback },
    ...overrides,
  };
}

function makeService(deps: ReturnType<typeof makeDeps>): ExperimentsService {
  return new ExperimentsService(
    deps.projectsRepository as never,
    deps.projectVersionsRepository as never,
    deps.testTargetsRepository as never,
    deps.experimentRunsRepository as never,
    deps.jobsService as never,
    deps.configService as never,
  );
}

describe('ExperimentsService', () => {
  describe('createRun', () => {
    it('throws PROJECT_NOT_FOUND when the project does not exist', async () => {
      const deps = makeDeps({ projectsRepository: { findById: vi.fn().mockResolvedValue(null) } });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'missing', targetId: 'target-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NOT_FOUND });
    });

    it('throws PROJECT_INDEXING_IN_PROGRESS when the project has an active version', async () => {
      const deps = makeDeps({
        projectVersionsRepository: {
          hasActiveVersion: vi.fn().mockResolvedValue(true),
          findById: vi.fn(),
        },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_INDEXING_IN_PROGRESS });
    });

    it('throws PROJECT_NOT_READY when there is no current version', async () => {
      const deps = makeDeps({
        projectsRepository: { findById: vi.fn().mockResolvedValue({ id: 'project-1', currentVersionId: null }) },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NOT_READY });
    });

    it('throws ANALYSIS_NOT_FINISHED when the current version is not COMPLETED', async () => {
      const deps = makeDeps({
        projectVersionsRepository: {
          hasActiveVersion: vi.fn().mockResolvedValue(false),
          findById: vi.fn().mockResolvedValue({ id: 'version-1', status: 'FAILED' }),
        },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.ANALYSIS_NOT_FINISHED });
    });

    it('throws UNRESOLVABLE_TARGET when the target does not exist', async () => {
      const deps = makeDeps({ testTargetsRepository: { findById: vi.fn().mockResolvedValue(null) } });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'missing' }),
      ).rejects.toMatchObject({ code: ErrorCode.UNRESOLVABLE_TARGET });
    });

    it('throws INVALID_GENERATION_TARGET when the target is a CLASS', async () => {
      const deps = makeDeps({
        testTargetsRepository: { findById: vi.fn().mockResolvedValue({ id: 'target-1', targetType: 'CLASS' }) },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-1' }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_GENERATION_TARGET });
    });

    it('creates the run and enqueues the job on the happy path', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      const result = await service.createRun({ projectId: 'project-1', targetId: 'target-1' });

      expect(deps.experimentRunsRepository.create).toHaveBeenCalledWith({
        projectId: 'project-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        totalRepetitions: 6,
      });
      expect(deps.jobsService.enqueue).toHaveBeenCalledWith(
        'experiment-run',
        expect.objectContaining({ experimentId: 'exp-1', targetId: 'target-1' }),
      );
      expect(result).toMatchObject({ experimentId: 'exp-1', projectVersionId: 'version-1', status: 'PENDING' });
    });
  });

  describe('getResults', () => {
    it('throws EXPERIMENT_NOT_FINISHED when the run is still RUNNING', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findById = vi.fn().mockResolvedValue({ id: 'exp-1', status: 'RUNNING' });
      const service = makeService(deps);

      await expect(service.getResults('exp-1')).rejects.toMatchObject({
        code: ErrorCode.EXPERIMENT_NOT_FINISHED,
      });
    });

    it('aggregates rates, means and failure distribution per strategy', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findById = vi.fn().mockResolvedValue({
        id: 'exp-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([
        {
          repetition: 1, strategy: 'RAG', compiled: true, executed: true, passed: true, valid: true,
          failureType: 'NONE', generationDurationMs: 100, executionDurationMs: 200, totalDurationMs: 300,
          inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0.01,
          retrievedChunks: 4, selectedChunks: 2, contextTokens: 500, toolCalls: null, filesInspected: null,
        },
        {
          repetition: 2, strategy: 'RAG', compiled: true, executed: true, passed: false, valid: false,
          failureType: 'TEST_ASSERTION', generationDurationMs: 120, executionDurationMs: 220, totalDurationMs: 340,
          inputTokens: 110, outputTokens: 55, totalTokens: 165, estimatedCost: 0.011,
          retrievedChunks: 6, selectedChunks: 3, contextTokens: 600, toolCalls: null, filesInspected: null,
        },
        {
          repetition: 3, strategy: 'RAG', compiled: false, executed: false, passed: false, valid: false,
          failureType: 'COMPILATION', generationDurationMs: 90, executionDurationMs: null, totalDurationMs: 90,
          inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
          retrievedChunks: 5, selectedChunks: 2, contextTokens: 550, toolCalls: null, filesInspected: null,
        },
      ]);
      const service = makeService(deps);

      const results = await service.getResults('exp-1');
      const ragMetrics = results.strategies.find((s) => s.strategy === 'RAG')!;

      expect(ragMetrics.validRate).toBeCloseTo(1 / 3, 6);
      expect(ragMetrics.compilationRate).toBeCloseTo(2 / 3, 6);
      expect(ragMetrics.passedRate).toBeCloseTo(1 / 3, 6);
      expect(ragMetrics.generationDurationMs).toBe(Math.round((100 + 120 + 90) / 3));
      // el promedio de tokens ignora los null, no los trata como 0
      expect(ragMetrics.inputTokens).toBe(Math.round((100 + 110) / 2));
      expect(ragMetrics.failures).toEqual({ NONE: 1, TEST_ASSERTION: 1, COMPILATION: 1 });
      expect(results.repetitionsPerStrategy).toBe(3);
      expect(results.completedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });
});
