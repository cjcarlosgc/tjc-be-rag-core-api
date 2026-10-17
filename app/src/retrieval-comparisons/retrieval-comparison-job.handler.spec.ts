import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import type { RetrievalCandidate } from '../retrieval/retrieval.service.js';
import {
  COMPARISON_FAILED_MESSAGE,
  RETRIEVAL_COMPARISON_FAILED_CODE,
  RETRIEVAL_COMPARISON_JOB_TYPE,
  RETRIEVAL_COMPARISON_WORKER_LOST_CODE,
  RETRIEVAL_TARGET_UNRESOLVABLE_CODE,
  RetrievalComparisonJobHandler,
  TARGET_UNRESOLVABLE_MESSAGE,
  WORKER_LOST_MESSAGE,
  readSymbolTarget,
  type RetrievalComparisonJobPayload,
} from './retrieval-comparison-job.handler.js';
import type { CodeChunk } from '../generated/prisma/client.js';

const payload: RetrievalComparisonJobPayload = {
  retrievalComparisonId: 'cmp-1',
  projectId: 'project-1',
  projectVersionId: 'version-1',
  analysisRunId: 'run-1',
};

const FUNCTION_SYMBOL = { language: 'TYPESCRIPT', kind: 'FUNCTION', qualifiedName: 'foo', filePath: 'src/foo.ts', changeKind: 'DIRECTLY_CHANGED' };

function comparison(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmp-1',
    analysisRunId: 'run-1',
    projectId: 'project-1',
    projectVersionId: 'version-1',
    symbol: FUNCTION_SYMBOL,
    status: 'PENDING',
    groundTruth: null,
    ...overrides,
  };
}

function chunk(id: string, overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id,
    filePath: `src/${id}.ts`,
    symbolKind: 'FUNCTION',
    symbolName: id,
    parentSymbolName: null,
    ...overrides,
  } as CodeChunk;
}

function candidate(id: string, semanticScore: number | null, structuralMatch: RetrievalCandidate['structuralMatch'] = null): RetrievalCandidate {
  return { chunk: chunk(id), semanticScore, structuralMatch };
}

const fixtureCandidates: RetrievalCandidate[] = [
  candidate('a', 0.9),
  candidate('b', 0.5),
  candidate('s', null, 'IMPORTS'),
  candidate('c', 0.6, 'IMPORTED_BY'),
];

describe('RetrievalComparisonJobHandler', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let retrievalService: { retrieve: ReturnType<typeof vi.fn> };
  let jobsService: { registerHandler: ReturnType<typeof vi.fn> };
  let handler: RetrievalComparisonJobHandler;

  beforeEach(() => {
    repository = {
      findById: vi.fn().mockResolvedValue(comparison()),
      markRunning: vi.fn().mockResolvedValue(true),
      recordFailure: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(true),
      saveResultsAndComplete: vi.fn().mockResolvedValue(true),
    };
    retrievalService = { retrieve: vi.fn().mockResolvedValue({ targetChunks: [chunk('target')], candidates: fixtureCandidates }) };
    jobsService = { registerHandler: vi.fn() };
    const config = { get: (_key: string, fallback: unknown) => fallback } as never;
    handler = new RetrievalComparisonJobHandler(
      jobsService as never,
      repository as never,
      retrievalService as never,
      new ContextBuilder(config),
      config,
    );
  });

  it('registers itself under the retrieval-comparison type on module init', () => {
    handler.onModuleInit();

    expect(RETRIEVAL_COMPARISON_JOB_TYPE).toBe('retrieval-comparison');
    expect(handler.type).toBe('retrieval-comparison');
    expect(jobsService.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('does nothing when the comparison is already COMPLETED (idempotent replay)', async () => {
    repository.findById.mockResolvedValue(comparison({ status: 'COMPLETED' }));

    await handler.handle(payload, 'job-1');

    expect(retrievalService.retrieve).not.toHaveBeenCalled();
    expect(repository.markRunning).not.toHaveBeenCalled();
    expect(repository.saveResultsAndComplete).not.toHaveBeenCalled();
  });

  it('does nothing when the comparison does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(handler.handle(payload, 'job-1')).resolves.toBeUndefined();
    expect(retrievalService.retrieve).not.toHaveBeenCalled();
  });

  it('makes one SE retrieval and derives SE and SEM from it, then persists both modes in one save', async () => {
    await handler.handle(payload, 'job-1');

    expect(retrievalService.retrieve).toHaveBeenCalledTimes(1);
    expect(retrievalService.retrieve).toHaveBeenCalledWith(
      'version-1',
      { filePath: 'src/foo.ts', symbolName: 'foo', methodName: null, targetType: 'FUNCTION' },
      20,
      'SE',
    );
    expect(repository.markRunning).toHaveBeenCalledWith('cmp-1');
    expect(repository.saveResultsAndComplete).toHaveBeenCalledTimes(1);

    const [id, results] = repository.saveResultsAndComplete.mock.calls[0];
    expect(id).toBe('cmp-1');
    const se = results.find((result: { mode: string }) => result.mode === 'SE');
    const sem = results.find((result: { mode: string }) => result.mode === 'SEM');

    // SE: 0.7·semántico + 0.3·estructural, orden por score combinado (c 0.72, a 0.63, b 0.35, s 0.30).
    expect(se.candidates.map((entry: { chunkId: string }) => entry.chunkId)).toEqual(['c', 'a', 'b', 's']);
    expect(se.candidates[0]).toMatchObject({ rank: 1, structuralRelation: 'IMPORTED_BY', selected: true });
    expect(se.config).toMatchObject({ semanticTopK: 20, finalTopK: 10, semanticWeight: 0.7, structuralWeight: 0.3 });

    // SEM: solo los 3 semánticos, por semanticScore, sin estructural ni combinedScore.
    expect(sem.candidates.map((entry: { chunkId: string }) => entry.chunkId)).toEqual(['a', 'c', 'b']);
    expect(sem.candidates.every((entry: { structuralRelation: unknown; combinedScore: unknown }) => entry.structuralRelation === null && entry.combinedScore === null)).toBe(true);
    expect(sem.config).toMatchObject({ semanticWeight: null, structuralWeight: null });

    expect(se.metrics).toBeNull();
    expect(sem.metrics).toBeNull();
  });

  it('computes metrics only when the comparison stored a ground truth', async () => {
    repository.findById.mockResolvedValue(comparison({ groundTruth: [{ filePath: 'src/a.ts', symbolQualifiedName: 'a' }] }));

    await handler.handle(payload, 'job-1');

    const [, results] = repository.saveResultsAndComplete.mock.calls[0];
    const se = results.find((result: { mode: string }) => result.mode === 'SE');
    const sem = results.find((result: { mode: string }) => result.mode === 'SEM');
    expect(se.metrics).toEqual({ precisionAt5: 1 / 5, recallAt5: 1, precisionAt10: 1 / 10, recallAt10: 1 });
    expect(sem.metrics).toEqual({ precisionAt5: 1 / 5, recallAt5: 1, precisionAt10: 1 / 10, recallAt10: 1 });
  });

  it('marks FAILED with RETRIEVAL_TARGET_UNRESOLVABLE and completes the job when no chunk exists', async () => {
    retrievalService.retrieve.mockRejectedValue(
      new AppException(ErrorCode.UNRESOLVABLE_TARGET, 'No se encontró un chunk.', 409),
    );

    await expect(handler.handle(payload, 'job-1')).resolves.toBeUndefined();

    expect(repository.markFailed).toHaveBeenCalledWith('cmp-1', RETRIEVAL_TARGET_UNRESOLVABLE_CODE, TARGET_UNRESOLVABLE_MESSAGE);
    expect(repository.saveResultsAndComplete).not.toHaveBeenCalled();
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it('marks FAILED with RETRIEVAL_TARGET_UNRESOLVABLE when the stored symbol is not a METHOD or FUNCTION snapshot', async () => {
    repository.findById.mockResolvedValue(comparison({ symbol: { kind: 'CLASS', qualifiedName: 'Foo', filePath: 'src/foo.ts' } }));

    await handler.handle(payload, 'job-1');

    expect(repository.markFailed).toHaveBeenCalledWith('cmp-1', RETRIEVAL_TARGET_UNRESOLVABLE_CODE, TARGET_UNRESOLVABLE_MESSAGE);
    expect(retrievalService.retrieve).not.toHaveBeenCalled();
  });

  it('on an unexpected error records a sanitized failure and rethrows only the sanitized message for retry', async () => {
    retrievalService.retrieve.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED token=sk-live-SECRET-123'), { stack: 'Error: boom sk-live-SECRET-123\n    at secret' }),
    );

    const thrown = await handler.handle(payload, 'job-1').catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(COMPARISON_FAILED_MESSAGE);
    expect((thrown as Error).cause).toBeUndefined();
    expect(repository.recordFailure).toHaveBeenCalledWith('cmp-1', RETRIEVAL_COMPARISON_FAILED_CODE, COMPARISON_FAILED_MESSAGE);
    expect(repository.markFailed).not.toHaveBeenCalled();

    const persisted = JSON.stringify([repository.recordFailure.mock.calls, (thrown as Error).message, (thrown as Error).stack]);
    expect(persisted).not.toContain('sk-live');
    expect(persisted).not.toContain('ECONNREFUSED');
    expect(persisted).not.toContain('secret');
  });

  it('does not fail when the comparison was closed while the job ran (no result rows are written)', async () => {
    repository.saveResultsAndComplete.mockResolvedValue(false);

    await expect(handler.handle(payload, 'job-1')).resolves.toBeUndefined();
  });

  it('a comparison another worker already moved out of an open state is left alone', async () => {
    repository.markRunning.mockResolvedValue(false);

    await handler.handle(payload, 'job-1');

    expect(retrievalService.retrieve).not.toHaveBeenCalled();
  });

  describe('onExhausted (DEC-JOBS-001)', () => {
    it('closes an open comparison as FAILED with RETRIEVAL_COMPARISON_WORKER_LOST', async () => {
      repository.findById.mockResolvedValue(comparison({ status: 'RUNNING' }));

      await handler.onExhausted(payload, 'Lock obsoleto');

      expect(repository.markFailed).toHaveBeenCalledWith('cmp-1', RETRIEVAL_COMPARISON_WORKER_LOST_CODE, WORKER_LOST_MESSAGE);
    });

    it.each(['COMPLETED', 'FAILED'] as const)('never overwrites a %s comparison', async (status) => {
      repository.findById.mockResolvedValue(comparison({ status }));

      await handler.onExhausted(payload, 'Lock obsoleto');

      expect(repository.markFailed).not.toHaveBeenCalled();
    });

    it('does nothing when the comparison is missing', async () => {
      repository.findById.mockResolvedValue(null);

      await handler.onExhausted(payload, 'Lock obsoleto');

      expect(repository.markFailed).not.toHaveBeenCalled();
    });

    it('keeps RETRIEVAL_COMPARISON_FAILED and its sanitized message when handle() already recorded it', async () => {
      const sanitized = 'La comparación de retrieval falló durante la recuperación; el job se reintentará si quedan intentos.';
      repository.findById.mockResolvedValue(
        comparison({ status: 'RUNNING', failureCode: RETRIEVAL_COMPARISON_FAILED_CODE, failureMessage: sanitized }),
      );

      await handler.onExhausted(payload, 'Lock obsoleto');

      expect(repository.markFailed).toHaveBeenCalledTimes(1);
      expect(repository.markFailed).toHaveBeenCalledWith('cmp-1', RETRIEVAL_COMPARISON_FAILED_CODE, sanitized);
      expect(repository.markFailed).not.toHaveBeenCalledWith(expect.anything(), RETRIEVAL_COMPARISON_WORKER_LOST_CODE, expect.anything());
    });

    it('uses WORKER_LOST only when no failure is recorded (failureCode null) for a PENDING comparison', async () => {
      repository.findById.mockResolvedValue(comparison({ status: 'PENDING', failureCode: null, failureMessage: null }));

      await handler.onExhausted(payload, 'Lock obsoleto');

      expect(repository.markFailed).toHaveBeenCalledWith('cmp-1', RETRIEVAL_COMPARISON_WORKER_LOST_CODE, WORKER_LOST_MESSAGE);
    });

    it('a comparison already FAILED with RETRIEVAL_COMPARISON_FAILED is not overwritten by WORKER_LOST', async () => {
      repository.findById.mockResolvedValue(
        comparison({ status: 'FAILED', failureCode: RETRIEVAL_COMPARISON_FAILED_CODE, failureMessage: COMPARISON_FAILED_MESSAGE }),
      );

      await handler.onExhausted(payload, 'Lock obsoleto');

      expect(repository.markFailed).not.toHaveBeenCalled();
    });

    it('a COMPLETED comparison with a stale failureCode is never overwritten', async () => {
      repository.findById.mockResolvedValue(comparison({ status: 'COMPLETED', failureCode: RETRIEVAL_COMPARISON_FAILED_CODE }));

      await handler.onExhausted(payload, 'Lock obsoleto');

      expect(repository.markFailed).not.toHaveBeenCalled();
    });
  });

  it('readSymbolTarget maps a METHOD snapshot to a method target and rejects other shapes', () => {
    expect(readSymbolTarget({ kind: 'METHOD', qualifiedName: 'Greeter.greet', filePath: 'src/greeter.ts' })).toEqual({
      filePath: 'src/greeter.ts',
      symbolName: 'Greeter',
      methodName: 'greet',
      targetType: 'METHOD',
    });
    expect(readSymbolTarget({ kind: 'CLASS', qualifiedName: 'Greeter', filePath: 'src/greeter.ts' })).toBeNull();
    expect(readSymbolTarget(null)).toBeNull();
    expect(readSymbolTarget(['x'])).toBeNull();
  });

  it('isolation: the handler imports no LLM, Functional Knowledge, Sandbox, generation, publication or AnalysisRun service', () => {
    const source = readFileSync(new URL('./retrieval-comparison-job.handler.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    const forbidden = /(^|\/)(providers|sandbox|functional-knowledge|generation|publications|experiments|snapshot-intelligence)\/|analysis-runs\.service|analysis-run-validation/;

    expect(imports.filter((specifier) => forbidden.test(specifier))).toEqual([]);
  });
});
