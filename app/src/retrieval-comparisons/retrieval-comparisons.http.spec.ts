import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { AnalysisSymbolsRepository } from '../analysis-runs/persistence/analysis-symbols.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ProjectRoleGuard } from '../project-access/project-role.guard.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import { RetrievalComparisonsRepository } from './persistence/retrieval-comparisons.repository.js';
import { RetrievalComparisonsController } from './retrieval-comparisons.controller.js';
import { RetrievalComparisonsService } from './retrieval-comparisons.service.js';
import { ConfigService } from '@nestjs/config';

const KEY = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7';
const RUN_ID = '0b3f9c2e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const CMP_ID = '1c4e8d7f-2b3c-4d5e-9f60-7a8b9c0d1e2f';

const symbolRow = {
  language: 'TYPESCRIPT',
  kind: 'FUNCTION',
  qualifiedName: 'foo',
  filePath: 'src/foo.ts',
  changeKind: 'DIRECTLY_CHANGED',
};

const body = {
  analysisRunId: RUN_ID,
  symbolFilePath: 'src/foo.ts',
  symbolQualifiedName: 'foo',
  groundTruth: [{ filePath: 'src/foo.ts', symbolQualifiedName: 'foo' }],
};

function comparisonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CMP_ID,
    analysisRunId: RUN_ID,
    projectId: 'project-1',
    projectVersionId: 'version-1',
    symbol: symbolRow,
    status: 'PENDING',
    failureCode: null,
    failureMessage: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

/** Prisma mínimo con estado para `IdempotencyRecord` y su transacción. */
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

  return { idempotencyRecord: tx.idempotencyRecord, $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) };
}

describe('Retrieval comparisons HTTP contract (INTEROP-2.7 §6.15)', () => {
  let app: INestApplication;
  let projectAccess: { requireForResource: ReturnType<typeof vi.fn> };
  let analysisRuns: { getById: ReturnType<typeof vi.fn> };
  let symbols: { findByAnalysisRun: ReturnType<typeof vi.fn> };
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let jobs: { enqueue: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    projectAccess = { requireForResource: vi.fn().mockResolvedValue({ project: {}, role: 'WRITER' }) };
    analysisRuns = {
      getById: vi.fn().mockResolvedValue({ id: RUN_ID, projectId: 'project-1', projectVersionId: 'version-1' }),
    };
    symbols = { findByAnalysisRun: vi.fn().mockResolvedValue([symbolRow]) };
    repository = {
      create: vi.fn().mockResolvedValue({ id: CMP_ID, analysisRunId: RUN_ID, projectVersionId: 'version-1' }),
      findById: vi.fn().mockResolvedValue(comparisonRow()),
      findResults: vi.fn().mockResolvedValue([]),
      listByAnalysisRun: vi.fn().mockResolvedValue([]),
    };
    jobs = { enqueue: vi.fn().mockResolvedValue('job-1') };

    @Module({
      controllers: [RetrievalComparisonsController],
      providers: [
        RetrievalComparisonsService,
        { provide: ProjectAccessService, useValue: projectAccess },
        { provide: AnalysisRunsService, useValue: analysisRuns },
        { provide: AnalysisSymbolsRepository, useValue: symbols },
        { provide: RetrievalComparisonsRepository, useValue: repository },
        { provide: JobsService, useValue: jobs },
        { provide: IdempotencyService, useValue: new IdempotencyService(makeIdempotencyPrisma() as never) },
        { provide: ConfigService, useValue: { get: (_key: string, fallback: unknown) => fallback } },
        { provide: APP_GUARD, useClass: ProjectRoleGuard },
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.use((req: { userId?: string }, _res: unknown, next: () => void) => {
      req.userId = 'user-1';
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();

  describe('POST /retrieval-comparisons', () => {
    it('answers 202 with the identity and pollAfterMs, enforces Writer on the Run, and enqueues once', async () => {
      const response = await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', KEY).send(body).expect(202);

      expect(response.body).toEqual({
        analysisRunId: RUN_ID,
        retrievalComparisonId: CMP_ID,
        projectVersionId: 'version-1',
        status: 'PENDING',
        pollAfterMs: 1500,
      });
      expect(projectAccess.requireForResource).toHaveBeenCalledWith('user-1', 'analysisRun', RUN_ID, 'WRITER');
      expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    });

    it('replays the same key and body with the same 202 and no second job', async () => {
      const first = await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', KEY).send(body).expect(202);
      const second = await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', KEY).send(body).expect(202);

      expect(second.body).toEqual(first.body);
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    });

    it('answers 400 when the Idempotency-Key header is missing', async () => {
      const response = await request(server()).post('/retrieval-comparisons').send(body).expect(400);

      expect(response.body.code).toBe(ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
      expect(symbols.findByAnalysisRun).not.toHaveBeenCalled();
    });

    it('answers 400 when the Idempotency-Key is not a UUID', async () => {
      const response = await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', 'nope').send(body).expect(400);

      expect(response.body.code).toBe(ErrorCode.INVALID_IDEMPOTENCY_KEY);
    });

    it('accepts exactly 200 ground-truth items and answers 400 for 201', async () => {
      const item = { filePath: 'src/a.ts', symbolQualifiedName: 'A.run' };

      await request(server())
        .post('/retrieval-comparisons')
        .set('Idempotency-Key', KEY)
        .send({ ...body, groundTruth: Array.from({ length: 200 }, () => item) })
        .expect(202);

      const tooMany = await request(server())
        .post('/retrieval-comparisons')
        .set('Idempotency-Key', '7a2d3c4b-5e6f-4071-9b82-a3c4d5e6f708')
        .send({ ...body, groundTruth: Array.from({ length: 201 }, () => item) })
        .expect(400);

      expect(tooMany.body.code).toBe('INVALID_REQUEST');
    });

    it('answers 400 for a malformed ground-truth item and for an unknown body field', async () => {
      await request(server())
        .post('/retrieval-comparisons')
        .set('Idempotency-Key', KEY)
        .send({ ...body, groundTruth: [{ filePath: 'src/a.ts' }] })
        .expect(400);

      await request(server())
        .post('/retrieval-comparisons')
        .set('Idempotency-Key', KEY)
        .send({ ...body, dedupeKey: 'x' })
        .expect(400);
    });

    it('answers 404 ANALYSIS_RUN_NOT_FOUND when the Run is not visible (guard, same as GET analysis-runs)', async () => {
      projectAccess.requireForResource.mockRejectedValue(
        new AppException(ErrorCode.ANALYSIS_RUN_NOT_FOUND, 'No existe un AnalysisRun.', 404),
      );

      const response = await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', KEY).send(body).expect(404);

      expect(response.body.code).toBe(ErrorCode.ANALYSIS_RUN_NOT_FOUND);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('answers 403 PROJECT_ROLE_INSUFFICIENT for a Reader', async () => {
      projectAccess.requireForResource.mockRejectedValue(
        new AppException(ErrorCode.PROJECT_ROLE_INSUFFICIENT, 'Rol insuficiente.', 403, { requiredRole: 'WRITER', currentRole: 'READER' }),
      );

      const response = await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', KEY).send(body).expect(403);

      expect(response.body.code).toBe(ErrorCode.PROJECT_ROLE_INSUFFICIENT);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('answers 404 ANALYSIS_SYMBOL_NOT_FOUND and 422 UNSUPPORTED_SYMBOL_KIND for the symbol checks', async () => {
      symbols.findByAnalysisRun.mockResolvedValueOnce([]);
      const missing = await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', KEY).send(body).expect(404);
      expect(missing.body.code).toBe(ErrorCode.ANALYSIS_SYMBOL_NOT_FOUND);

      symbols.findByAnalysisRun.mockResolvedValueOnce([{ ...symbolRow, changeKind: 'POTENTIALLY_IMPACTED' }]);
      const impacted = await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', KEY).send(body).expect(422);
      expect(impacted.body.code).toBe(ErrorCode.UNSUPPORTED_SYMBOL_KIND);
    });

    it('answers 409 ANALYSIS_NOT_FINISHED for a visible Run without projectVersionId and creates nothing', async () => {
      analysisRuns.getById.mockResolvedValueOnce({ id: RUN_ID, projectId: 'project-1', projectVersionId: null });
      const response = await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', KEY).send(body).expect(409);
      expect(response.body.code).toBe(ErrorCode.ANALYSIS_NOT_FINISHED);
      expect(repository.create).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('answers 202 for a PHP version (WI-CORE-028) and enqueues the comparison', async () => {
      symbols.findByAnalysisRun.mockResolvedValueOnce([{ ...symbolRow, language: 'PHP' }]);
      await request(server()).post('/retrieval-comparisons').set('Idempotency-Key', KEY).send(body).expect(202);
      expect(repository.create).toHaveBeenCalledTimes(1);
      expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /retrieval-comparisons/{id}', () => {
    it('answers 200 with the status and the symbol snapshot, under Reader on the comparison', async () => {
      const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}`).expect(200);

      expect(response.body).toMatchObject({
        id: CMP_ID,
        analysisRunId: RUN_ID,
        projectId: 'project-1',
        projectVersionId: 'version-1',
        status: 'PENDING',
        symbol: symbolRow,
        failureCode: null,
      });
      expect(projectAccess.requireForResource).toHaveBeenCalledWith('user-1', 'retrievalComparison', CMP_ID, 'READER');
    });

    it('answers 404 RETRIEVAL_COMPARISON_NOT_FOUND for an unknown or invisible comparison', async () => {
      repository.findById.mockResolvedValue(null);

      const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}`).expect(404);

      expect(response.body.code).toBe(ErrorCode.RETRIEVAL_COMPARISON_NOT_FOUND);
    });

    it('answers the guard 404 for a comparison whose Project is not visible', async () => {
      projectAccess.requireForResource.mockRejectedValue(
        new AppException(ErrorCode.RETRIEVAL_COMPARISON_NOT_FOUND, 'no', 404),
      );

      const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}`).expect(404);

      expect(response.body.code).toBe(ErrorCode.RETRIEVAL_COMPARISON_NOT_FOUND);
    });
  });

  describe('GET /retrieval-comparisons/{id}/results', () => {
    it.each(['PENDING', 'RUNNING'])('answers 409 RETRIEVAL_COMPARISON_NOT_FINISHED while %s', async (status) => {
      repository.findById.mockResolvedValue(comparisonRow({ status }));

      const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}/results`).expect(409);

      expect(response.body.code).toBe(ErrorCode.RETRIEVAL_COMPARISON_NOT_FINISHED);
      expect(repository.findResults).not.toHaveBeenCalled();
    });

    it('answers 200 with exactly the SE and SEM modes once COMPLETED', async () => {
      repository.findById.mockResolvedValue(comparisonRow({ status: 'COMPLETED', completedAt: new Date('2026-10-09T12:00:00.000Z') }));
      repository.findResults.mockResolvedValue([
        {
          id: 'ret-sem',
          mode: 'SEM',
          config: { semanticTopK: 20, finalTopK: 10, semanticWeight: null, structuralWeight: null, embeddingModel: 'text-embedding-3-small' },
          candidates: [{ rank: 1, chunkId: 'c1', filePath: 'src/a.ts', symbolQualifiedName: 'A.run', semanticScore: 0.9, structuralRelation: null, combinedScore: null, selected: true }],
          metrics: { precisionAt5: 0.2, recallAt5: 1, precisionAt10: 0.1, recallAt10: 1 },
        },
        {
          id: 'ret-se',
          mode: 'SE',
          config: { semanticTopK: 20, finalTopK: 10, semanticWeight: 0.7, structuralWeight: 0.3, embeddingModel: 'text-embedding-3-small' },
          candidates: [],
          metrics: null,
        },
      ]);

      const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}/results`).expect(200);

      expect(response.body.modes.map((mode: { mode: string }) => mode.mode)).toEqual(['SE', 'SEM']);
      expect(response.body.modes[0]).toMatchObject({ retrievalId: 'ret-se', metrics: null, config: { semanticWeight: 0.7 } });
      expect(response.body.modes[1].candidates[0]).toMatchObject({ rank: 1, selected: true, structuralRelation: null });
      expect(response.body.completedAt).toBe('2026-10-09T12:00:00.000Z');
      expect(response.body.symbol).toEqual(symbolRow);
    });

    it('answers 409 RETRIEVAL_COMPARISON_FAILED for a FAILED comparison, with no results read', async () => {
      repository.findById.mockResolvedValue(
        comparisonRow({
          status: 'FAILED',
          failureCode: 'RETRIEVAL_TARGET_UNRESOLVABLE',
          failureMessage: 'No se pudo resolver el objetivo.',
          completedAt: new Date('2026-10-09T12:00:00.000Z'),
        }),
      );

      const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}/results`).expect(409);

      expect(response.body.code).toBe(ErrorCode.RETRIEVAL_COMPARISON_FAILED);
      expect(repository.findResults).not.toHaveBeenCalled();
    });

    it('answers 409 RETRIEVAL_COMPARISON_FAILED for a FAILED comparison without completedAt', async () => {
      repository.findById.mockResolvedValue(comparisonRow({ status: 'FAILED', failureCode: 'RETRIEVAL_COMPARISON_WORKER_LOST', completedAt: null }));

      const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}/results`).expect(409);

      expect(response.body.code).toBe(ErrorCode.RETRIEVAL_COMPARISON_FAILED);
    });

    it('answers 200 with completedAt null when the row has none (no timestamp is invented)', async () => {
      repository.findById.mockResolvedValue(comparisonRow({ status: 'COMPLETED', completedAt: null }));
      repository.findResults.mockResolvedValue([]);

      const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}/results`).expect(200);

      expect(response.body.completedAt).toBeNull();
    });
  });

  describe('GET /analysis-runs/{analysisRunId}/retrieval-comparisons', () => {
    it('answers a Page newest first with a nextCursor when there are more items', async () => {
      const first = comparisonRow({ id: 'cmp-a' });
      const second = comparisonRow({ id: 'cmp-b' });
      const third = comparisonRow({ id: 'cmp-c' });
      repository.listByAnalysisRun.mockResolvedValue([first, second, third]);

      const response = await request(server()).get(`/analysis-runs/${RUN_ID}/retrieval-comparisons?limit=2`).expect(200);

      expect(projectAccess.requireForResource).toHaveBeenCalledWith('user-1', 'analysisRun', RUN_ID, 'READER');
      expect(repository.listByAnalysisRun).toHaveBeenCalledWith(RUN_ID, 3, undefined);
      expect(response.body.items.map((item: { id: string }) => item.id)).toEqual(['cmp-a', 'cmp-b']);
      expect(response.body.nextCursor).toBe('cmp-b');
    });

    it('answers nextCursor null on the last page and rejects a malformed cursor with 400', async () => {
      repository.listByAnalysisRun.mockResolvedValue([comparisonRow({ id: 'cmp-a' })]);

      const response = await request(server()).get(`/analysis-runs/${RUN_ID}/retrieval-comparisons`).expect(200);
      expect(response.body.nextCursor).toBeNull();

      await request(server()).get(`/analysis-runs/${RUN_ID}/retrieval-comparisons?cursor=not-a-uuid`).expect(400);
    });
  });
});
