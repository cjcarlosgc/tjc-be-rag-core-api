import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { AnalysisTraceRepository, clampDuration } from './analysis-trace.repository.js';

describe('AnalysisTraceRepository.upsertExecution (WI-CORE-027, DEC-EVID-003)', () => {
  const base = {
    analysisRunId: 'run-1',
    proposalId: 'proposal-1',
    executionId: 'exec-1',
    attempt: 1,
    executionProfile: 'NODE_TYPESCRIPT',
    outcome: 'SUCCESS',
  };

  function repositoryWith() {
    const upsert = vi.fn().mockResolvedValue({ id: 'execution-1' });
    const repository = new AnalysisTraceRepository({ analysisRunExecution: { upsert } } as never);
    return { repository, upsert };
  }

  it('writes the identity, duration, facts and failure of the execution in create and update alike', async () => {
    const { repository, upsert } = repositoryWith();
    const facts = { executionProfile: 'NODE_TYPESCRIPT', passed: true } as never;
    const failure = { stage: 'COMPILING', category: 'COMPILATION', code: 'TS2304', message: 'x' } as const;

    await repository.upsertExecution({ ...base, requestId: 'req-1', correlationId: 'corr-1', durationMs: 7, facts, failure });

    const args = upsert.mock.calls[0][0];
    const expected = { requestId: 'req-1', correlationId: 'corr-1', durationMs: 7, facts, failure };
    expect(args.where).toEqual({ proposalId_attempt: { proposalId: 'proposal-1', attempt: 1 } });
    expect(args.create).toMatchObject({ proposalId: 'proposal-1', attempt: 1, ...expected });
    expect(args.update).toMatchObject(expected);
  });

  it('writes null for an identifier or duration that was not observed, never 0 or an empty string', async () => {
    const { repository, upsert } = repositoryWith();

    await repository.upsertExecution({ ...base, requestId: null, correlationId: null, durationMs: null, facts: null, failure: null });

    const update = upsert.mock.calls[0][0].update;
    expect(update.requestId).toBeNull();
    expect(update.correlationId).toBeNull();
    expect(update.durationMs).toBeNull();
    expect(update.facts).toBe(Prisma.DbNull);
    expect(update.failure).toBe(Prisma.DbNull);
  });

  it('treats evidence fields that the caller omits as not observed', async () => {
    const { repository, upsert } = repositoryWith();

    await repository.upsertExecution(base);

    expect(upsert.mock.calls[0][0].create).toMatchObject({
      requestId: null,
      correlationId: null,
      durationMs: null,
      facts: Prisma.DbNull,
      failure: Prisma.DbNull,
    });
  });

  it('persists a negative duration (clock jump) as 0 so the non-negative CHECK holds', async () => {
    const { repository, upsert } = repositoryWith();

    await repository.upsertExecution({ ...base, durationMs: -250 });

    expect(upsert.mock.calls[0][0].create).toMatchObject({ durationMs: 0 });
    expect(upsert.mock.calls[0][0].update).toMatchObject({ durationMs: 0 });
  });

  it('clamps only the value written and keeps unobserved or non-finite durations as null', () => {
    expect(clampDuration(-1)).toBe(0);
    expect(clampDuration(0)).toBe(0);
    expect(clampDuration(12.4)).toBe(12);
    expect(clampDuration(null)).toBeNull();
    expect(clampDuration(undefined)).toBeNull();
    expect(clampDuration(Number.NaN)).toBeNull();
    expect(clampDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
