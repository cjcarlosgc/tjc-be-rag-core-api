import { describe, expect, it, vi, beforeEach } from 'vitest';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { RETRIEVAL_COMPARISON_JOB_TYPE } from './retrieval-comparison-job.handler.js';
import { RetrievalComparisonsService, type CreateRetrievalComparisonRequest } from './retrieval-comparisons.service.js';

const KEY = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7';

const request: CreateRetrievalComparisonRequest = {
  analysisRunId: 'run-1',
  symbolFilePath: 'src/foo.ts',
  symbolQualifiedName: 'foo',
  groundTruth: [{ filePath: 'src/foo.ts', symbolQualifiedName: 'foo' }],
};

function symbol(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sym-1',
    analysisRunId: 'run-1',
    language: 'TYPESCRIPT',
    kind: 'FUNCTION',
    qualifiedName: 'foo',
    filePath: 'src/foo.ts',
    changeKind: 'DIRECTLY_CHANGED',
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return { id: 'run-1', projectId: 'project-1', projectVersionId: 'version-1', ...overrides };
}

/** Prisma con estado mínimo para `IdempotencyRecord` y una transacción que lo comparte. */
function makeIdempotencyPrisma() {
  const records = new Map<string, { requestFingerprint: string; operationId: string }>();
  const tx = {
    idempotencyRecord: {
      findUnique: vi.fn(async ({ where }: { where: { scope_idempotencyKey: { scope: string; idempotencyKey: string } } }) => {
        const { scope, idempotencyKey } = where.scope_idempotencyKey;
        return records.get(`${scope}:${idempotencyKey}`) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: { scope: string; idempotencyKey: string; requestFingerprint: string; operationId: string } }) => {
        records.set(`${data.scope}:${data.idempotencyKey}`, { requestFingerprint: data.requestFingerprint, operationId: data.operationId });
        return data;
      }),
    },
  };

  return {
    prisma: {
      idempotencyRecord: tx.idempotencyRecord,
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
}

describe('RetrievalComparisonsService', () => {
  let analysisRunsService: { getById: ReturnType<typeof vi.fn> };
  let analysisSymbolsRepository: { findByAnalysisRun: ReturnType<typeof vi.fn> };
  let repository: { create: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> };
  let jobsService: { enqueue: ReturnType<typeof vi.fn> };
  let projectVersions: { findById: ReturnType<typeof vi.fn> };
  let service: RetrievalComparisonsService;

  beforeEach(() => {
    analysisRunsService = { getById: vi.fn().mockResolvedValue(run()) };
    analysisSymbolsRepository = { findByAnalysisRun: vi.fn().mockResolvedValue([symbol()]) };
    repository = {
      create: vi.fn().mockResolvedValue({ id: 'cmp-1', analysisRunId: 'run-1', projectVersionId: 'version-1' }),
      findById: vi.fn().mockResolvedValue({ id: 'cmp-1', analysisRunId: 'run-1', projectVersionId: 'version-1' }),
    };
    jobsService = { enqueue: vi.fn().mockResolvedValue('job-1') };
    projectVersions = { findById: vi.fn().mockResolvedValue({ id: 'version-1', language: 'TYPESCRIPT' }) };
    const { prisma } = makeIdempotencyPrisma();
    const config = { get: (_key: string, fallback: unknown) => fallback };
    service = new RetrievalComparisonsService(
      analysisRunsService as never,
      analysisSymbolsRepository as never,
      repository as never,
      jobsService as never,
      new IdempotencyService(prisma as never),
      config as never,
      projectVersions as never,
    );
  });

  it('creates the comparison and enqueues its job in the same transaction, without dedupeKey, and answers 202', async () => {
    const accepted = await service.create(request, KEY, 'user-1');

    expect(accepted).toEqual({
      analysisRunId: 'run-1',
      retrievalComparisonId: 'cmp-1',
      projectVersionId: 'version-1',
      status: 'PENDING',
      pollAfterMs: 1500,
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisRunId: 'run-1',
        projectId: 'project-1',
        projectVersionId: 'version-1',
        symbol: { language: 'TYPESCRIPT', kind: 'FUNCTION', qualifiedName: 'foo', filePath: 'src/foo.ts', changeKind: 'DIRECTLY_CHANGED' },
        idempotencyKey: KEY,
        groundTruth: [{ filePath: 'src/foo.ts', symbolQualifiedName: 'foo' }],
      }),
      expect.anything(),
    );
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
    const [type, jobPayload, jobTx] = jobsService.enqueue.mock.calls[0];
    expect(type).toBe(RETRIEVAL_COMPARISON_JOB_TYPE);
    expect(jobPayload).toEqual({ retrievalComparisonId: 'cmp-1', projectId: 'project-1', projectVersionId: 'version-1', analysisRunId: 'run-1' });
    expect(jobPayload).not.toHaveProperty('dedupeKey');
    expect(jobTx).toBeDefined();
    expect(repository.create.mock.calls[0][1]).toBe(jobTx);
  });

  it('a replay with the same key and body answers the original 202 without creating or enqueueing again', async () => {
    const first = await service.create(request, KEY, 'user-1');
    const second = await service.create(request, KEY, 'user-1');

    expect(second).toEqual(first);
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
  });

  it('the same key with a different body (including groundTruth) is an IDEMPOTENCY_CONFLICT', async () => {
    await service.create(request, KEY, 'user-1');

    await expect(service.create({ ...request, groundTruth: [] }, KEY, 'user-1')).rejects.toMatchObject({
      code: ErrorCode.IDEMPOTENCY_CONFLICT,
    });
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('a replay whose comparison no longer exists answers RETRIEVAL_COMPARISON_NOT_FOUND', async () => {
    await service.create(request, KEY, 'user-1');
    repository.findById.mockResolvedValue(null);

    await expect(service.create(request, KEY, 'user-1')).rejects.toMatchObject({
      code: ErrorCode.RETRIEVAL_COMPARISON_NOT_FOUND,
    });
  });

  it('rejects a missing or malformed Idempotency-Key with 400 before looking up the symbol', async () => {
    await expect(service.create(request, undefined, 'user-1')).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED });
    await expect(service.create(request, 'no-uuid', 'user-1')).rejects.toMatchObject({ code: ErrorCode.INVALID_IDEMPOTENCY_KEY });

    expect(analysisSymbolsRepository.findByAnalysisRun).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('propagates the Run 404 from getById (same as GET /analysis-runs/{id}) without touching symbols', async () => {
    analysisRunsService.getById.mockRejectedValue(new AppException(ErrorCode.ANALYSIS_RUN_NOT_FOUND, 'no', 404));

    await expect(service.create(request, KEY, 'user-1')).rejects.toMatchObject({ code: ErrorCode.ANALYSIS_RUN_NOT_FOUND });
    expect(analysisSymbolsRepository.findByAnalysisRun).not.toHaveBeenCalled();
  });

  it('answers 404 ANALYSIS_SYMBOL_NOT_FOUND when the symbol is not in the Run, and creates nothing', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([symbol({ qualifiedName: 'other' })]);

    const error = await service.create(request, KEY, 'user-1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ErrorCode.ANALYSIS_SYMBOL_NOT_FOUND });
    expect((error as AppException).getStatus()).toBe(404);
    expect(repository.create).not.toHaveBeenCalled();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['POTENTIALLY_IMPACTED function', { changeKind: 'POTENTIALLY_IMPACTED' }],
    ['CLASS directly changed', { kind: 'CLASS', qualifiedName: 'foo' }],
  ])('answers 422 UNSUPPORTED_SYMBOL_KIND for a %s', async (_label, overrides) => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([symbol(overrides)]);

    const error = await service.create(request, KEY, 'user-1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ErrorCode.UNSUPPORTED_SYMBOL_KIND });
    expect((error as AppException).getStatus()).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('answers 422 UNSUPPORTED_PROJECT for a PHP version (DEC-RC-001) and creates nothing', async () => {
    projectVersions.findById.mockResolvedValue({ id: 'version-1', language: 'PHP' });

    const error = await service.create(request, KEY, 'user-1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ErrorCode.UNSUPPORTED_PROJECT });
    expect((error as AppException).getStatus()).toBe(422);
    expect(projectVersions.findById).toHaveBeenCalledWith('version-1');
    expect(repository.create).not.toHaveBeenCalled();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });

  it('a PHP version is rejected before the symbol lookup (422 wins over 404 ANALYSIS_SYMBOL_NOT_FOUND)', async () => {
    projectVersions.findById.mockResolvedValue({ id: 'version-1', language: 'PHP' });
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([]);

    const error = await service.create(request, KEY, 'user-1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ErrorCode.UNSUPPORTED_PROJECT });
    expect(analysisSymbolsRepository.findByAnalysisRun).not.toHaveBeenCalled();
  });

  it('a PHP symbol inside a TypeScript version is not rejected by language: the job decides', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([symbol({ language: 'PHP' })]);

    await expect(service.create(request, KEY, 'user-1')).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('a visible Run without projectVersionId answers 409 ANALYSIS_NOT_FINISHED before any other check, and creates nothing', async () => {
    analysisRunsService.getById.mockResolvedValue(run({ projectVersionId: null }));
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([]);

    const error = await service.create(request, KEY, 'user-1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ErrorCode.ANALYSIS_NOT_FINISHED });
    expect((error as AppException).getStatus()).toBe(409);
    expect(analysisSymbolsRepository.findByAnalysisRun).not.toHaveBeenCalled();
    expect(projectVersions.findById).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
  });

  it('a missing Idempotency-Key wins over the 409 for a Run without projectVersionId', async () => {
    analysisRunsService.getById.mockResolvedValue(run({ projectVersionId: null }));

    await expect(service.create(request, undefined, 'user-1')).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED });
  });

  it('a symbol missing from the Run answers 404 ANALYSIS_SYMBOL_NOT_FOUND after the version checks', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([]);

    const error = await service.create(request, KEY, 'user-1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ErrorCode.ANALYSIS_SYMBOL_NOT_FOUND });
    expect(projectVersions.findById).toHaveBeenCalledTimes(1);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('the same key with a body that was rejected earlier does not create an idempotency record', async () => {
    projectVersions.findById.mockResolvedValue({ id: 'version-1', language: 'PHP' });
    await service.create(request, KEY, 'user-1').catch(() => undefined);

    projectVersions.findById.mockResolvedValue({ id: 'version-1', language: 'TYPESCRIPT' });
    await expect(service.create(request, KEY, 'user-1')).resolves.toMatchObject({ status: 'PENDING' });
    expect(repository.create).toHaveBeenCalledTimes(1);
  });
});
