import 'reflect-metadata';
import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { AnalysisRunTraceService } from '../analysis-runs/analysis-run-trace.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { CorrelationIdMiddleware } from '../common/middleware/correlation-id.middleware.js';
import { ExperimentRunsRepository } from '../experiments/persistence/experiment-runs.repository.js';
import { ProjectRoleGuard } from '../project-access/project-role.guard.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import { ACCESS_POLICY_KEY, type AccessPolicy } from '../project-access/access-policy.js';
import { RetrievalComparisonsRepository } from '../retrieval-comparisons/persistence/retrieval-comparisons.repository.js';
import { EvidenceController } from './evidence.controller.js';
import { EVIDENCE_CLOCK, EvidenceService } from './evidence.service.js';
import { EvidenceRepository } from './persistence/evidence.repository.js';

const RUN_ID = '0b3f9c2e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const EXP_ID = '2d4f6a8b-3c5d-4e6f-8a9b-0c1d2e3f4a5b';
const CMP_ID = '1c4e8d7f-2b3c-4d5e-9f60-7a8b9c0d1e2f';
const CORRELATION = 'trace-corr-123';
const NOW = new Date('2026-10-09T12:00:00.000Z');

describe('EvidenceController route policy (INTEROP-2.7 §6.13, §6.16)', () => {
  it.each([
    ['getAnalysisRunEvidence', { from: 'param', name: 'id', resource: 'analysisRun' }],
    ['getExperimentEvidence', { from: 'param', name: 'id', resource: 'experiment' }],
    ['getRetrievalComparisonEvidence', { from: 'param', name: 'id', resource: 'retrievalComparison' }],
  ] as const)('%s requires READER on the resource named by :id', (method, target) => {
    const policy = Reflect.getMetadata(ACCESS_POLICY_KEY, EvidenceController.prototype[method] as object) as AccessPolicy;

    expect(policy).toEqual({ kind: 'ROLE', minRole: 'READER', target });
  });
});

describe('Evidence HTTP contract (INTEROP-2.7 §6.16, WI-CORE-027)', () => {
  let app: INestApplication;
  let projectAccess: { requireForResource: ReturnType<typeof vi.fn> };
  let analysisRuns: { getById: ReturnType<typeof vi.fn> };
  let traceService: { loadTargets: ReturnType<typeof vi.fn> };
  let evidenceRepository: Record<string, ReturnType<typeof vi.fn>>;
  let experiments: { findByIdForOwner: ReturnType<typeof vi.fn>; findRepetitions: ReturnType<typeof vi.fn> };
  let comparisons: { findById: ReturnType<typeof vi.fn>; findResults: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    projectAccess = { requireForResource: vi.fn().mockResolvedValue({ project: {}, role: 'READER' }) };
    analysisRuns = {
      getById: vi.fn().mockResolvedValue({
        id: RUN_ID,
        repositoryName: 'org/repo',
        prNumber: 7,
        headSha: 'head-1',
        projectVersionId: 'pv-1',
        createdAt: NOW,
        checkId: null,
        checkPublishedAt: null,
        status: 'SUCCESS',
      }),
    };
    traceService = {
      loadTargets: vi.fn().mockResolvedValue({
        targetSymbols: [],
        publication: { status: 'NOT_APPLICABLE', checkId: null, companionBranch: null, companionPullRequestUrl: null, sourceHeadSha: null, freshness: null },
      }),
    };
    evidenceRepository = {
      findRetrievalsForEvidence: vi.fn().mockResolvedValue([]),
      findContextsForEvidence: vi.fn().mockResolvedValue([]),
      findProposalsForEvidence: vi.fn().mockResolvedValue([]),
      findExecutionsForEvidence: vi.fn().mockResolvedValue([]),
      findContextTracesByRepetitionIds: vi.fn().mockResolvedValue([]),
    };
    experiments = {
      findByIdForOwner: vi.fn().mockResolvedValue({ id: EXP_ID, status: 'COMPLETED', randomizationSeed: null, executionProfile: null, runnerHint: null, modelConfig: null }),
      findRepetitions: vi.fn().mockResolvedValue([]),
    };
    comparisons = {
      findById: vi.fn().mockResolvedValue({ id: CMP_ID, status: 'COMPLETED' }),
      findResults: vi.fn().mockResolvedValue([]),
    };

    @Module({
      controllers: [EvidenceController],
      providers: [
        EvidenceService,
        { provide: ProjectAccessService, useValue: projectAccess },
        { provide: AnalysisRunsService, useValue: analysisRuns },
        { provide: AnalysisRunTraceService, useValue: traceService },
        { provide: EvidenceRepository, useValue: evidenceRepository },
        { provide: ExperimentRunsRepository, useValue: experiments },
        { provide: RetrievalComparisonsRepository, useValue: comparisons },
        { provide: EVIDENCE_CLOCK, useValue: () => NOW },
        { provide: APP_GUARD, useClass: ProjectRoleGuard },
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    const correlation = new CorrelationIdMiddleware();
    app.use((req: { userId?: string }, res: never, next: () => void) => {
      req.userId = 'user-1';
      correlation.use(req as never, res, next);
    });
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();

  it('answers 200 with the bundle, the x-correlation-id value and the injected generatedAt, and checks READER on the run', async () => {
    const response = await request(server()).get(`/analysis-runs/${RUN_ID}/evidence`).set('x-correlation-id', CORRELATION).expect(200);

    expect(response.body).toMatchObject({
      schemaVersion: '1',
      kind: 'ANALYSIS_RUN',
      subjectId: RUN_ID,
      generatedAt: NOW.toISOString(),
      correlationId: CORRELATION,
    });
    expect(projectAccess.requireForResource).toHaveBeenCalledWith('user-1', 'analysisRun', RUN_ID, 'READER');
    expect(response.headers['x-correlation-id']).toBe(CORRELATION);
  });

  it('answers 409 EVIDENCE_NOT_FINISHED for a run still processing', async () => {
    analysisRuns.getById.mockResolvedValueOnce({ id: RUN_ID, status: 'PROCESSING' });

    const response = await request(server()).get(`/analysis-runs/${RUN_ID}/evidence`).expect(409);

    expect(response.body.code).toBe('EVIDENCE_NOT_FINISHED');
  });

  it('answers the status route 404 for a run that is not found', async () => {
    analysisRuns.getById.mockRejectedValueOnce(new AppException(ErrorCode.ANALYSIS_RUN_NOT_FOUND, 'no', 404));

    const response = await request(server()).get(`/analysis-runs/${RUN_ID}/evidence`).expect(404);

    expect(response.body.code).toBe('ANALYSIS_RUN_NOT_FOUND');
  });

  it('answers 200 for an experiment in FAILED, and 409 while it is RUNNING', async () => {
    experiments.findByIdForOwner.mockResolvedValueOnce({ id: EXP_ID, status: 'FAILED', randomizationSeed: null, executionProfile: null, runnerHint: null, modelConfig: null });
    await request(server()).get(`/experiments/${EXP_ID}/evidence`).expect(200);
    expect(projectAccess.requireForResource).toHaveBeenCalledWith('user-1', 'experiment', EXP_ID, 'READER');

    experiments.findByIdForOwner.mockResolvedValueOnce({ id: EXP_ID, status: 'RUNNING', randomizationSeed: null, executionProfile: null, runnerHint: null, modelConfig: null });
    const response = await request(server()).get(`/experiments/${EXP_ID}/evidence`).expect(409);
    expect(response.body.code).toBe('EVIDENCE_NOT_FINISHED');
  });

  it('answers 404 for an experiment that is not visible to the caller', async () => {
    experiments.findByIdForOwner.mockResolvedValueOnce(null);

    const response = await request(server()).get(`/experiments/${EXP_ID}/evidence`).expect(404);

    expect(response.body.code).toBe('EXPERIMENT_NOT_FOUND');
  });

  it('answers 200 for a completed comparison and 409 while it is PENDING', async () => {
    await request(server()).get(`/retrieval-comparisons/${CMP_ID}/evidence`).expect(200);
    expect(projectAccess.requireForResource).toHaveBeenCalledWith('user-1', 'retrievalComparison', CMP_ID, 'READER');

    comparisons.findById.mockResolvedValueOnce({ id: CMP_ID, status: 'PENDING' });
    const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}/evidence`).expect(409);
    expect(response.body.code).toBe('EVIDENCE_NOT_FINISHED');
  });

  it('answers 404 for a comparison that does not exist', async () => {
    comparisons.findById.mockResolvedValueOnce(null);

    const response = await request(server()).get(`/retrieval-comparisons/${CMP_ID}/evidence`).expect(404);

    expect(response.body.code).toBe('RETRIEVAL_COMPARISON_NOT_FOUND');
  });
});
