import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceService } from './evidence.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

const NOW = new Date('2026-10-09T12:34:56.000Z');
const CORRELATION = 'corr-from-header';

function run(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    repositoryName: 'org/repo',
    prNumber: 42,
    headSha: 'head-1',
    projectVersionId: 'pv-1',
    createdAt: new Date('2026-10-09T10:00:00.000Z'),
    checkId: null,
    checkPublishedAt: null,
    status,
    ...overrides,
  };
}

function makeService(options: {
  analysisRun?: ReturnType<typeof run> | Error;
  experiment?: Record<string, unknown> | null;
  comparison?: Record<string, unknown> | null;
  results?: unknown[];
} = {}) {
  const analysisRunsService = {
    getById: vi.fn(async () => {
      if (options.analysisRun instanceof Error) throw options.analysisRun;
      return options.analysisRun ?? run('SUCCESS');
    }),
  };
  const analysisRunTraceService = {
    loadTargets: vi.fn().mockResolvedValue({
      targetSymbols: [],
      publication: { status: 'NOT_APPLICABLE', checkId: null, companionBranch: null, companionPullRequestUrl: null, sourceHeadSha: null, freshness: null },
    }),
  };
  const evidenceRepository = {
    findRetrievalsForEvidence: vi.fn().mockResolvedValue([]),
    findContextsForEvidence: vi.fn().mockResolvedValue([]),
    findProposalsForEvidence: vi.fn().mockResolvedValue([]),
    findExecutionsForEvidence: vi.fn().mockResolvedValue([]),
    findContextTracesByRepetitionIds: vi.fn().mockResolvedValue([]),
  };
  const experimentRunsRepository = {
    findByIdForOwner: vi.fn().mockResolvedValue(options.experiment === undefined ? experimentRow('COMPLETED') : options.experiment),
    findRepetitions: vi.fn().mockResolvedValue([]),
  };
  const retrievalComparisonsRepository = {
    findById: vi.fn().mockResolvedValue(options.comparison === undefined ? comparisonRow('COMPLETED') : options.comparison),
    findResults: vi.fn().mockResolvedValue(options.results ?? []),
  };
  const service = new EvidenceService(
    analysisRunsService as never,
    analysisRunTraceService as never,
    evidenceRepository as never,
    experimentRunsRepository as never,
    retrievalComparisonsRepository as never,
    () => NOW,
  );

  return { service, analysisRunsService, analysisRunTraceService, evidenceRepository, experimentRunsRepository, retrievalComparisonsRepository };
}

function experimentRow(status: string) {
  return {
    id: 'exp-1',
    status,
    randomizationSeed: 'seed-1',
    executionProfile: 'NODE_TYPESCRIPT',
    runnerHint: 'JEST',
    modelConfig: { provider: 'openai', model: 'gpt-x' },
  };
}

function comparisonRow(status: string) {
  return { id: 'cmp-1', status };
}

/** Captura la excepción de aplicación y devuelve su código y su estado HTTP. */
async function failureOf(promise: Promise<unknown>): Promise<{ code: string; status: number }> {
  const error = await promise.then(
    () => {
      throw new Error('se esperaba una excepción');
    },
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(AppException);
  return { code: (error as AppException).code, status: (error as AppException).getStatus() };
}

describe('EvidenceService.getAnalysisRunEvidence (WI-CORE-027)', () => {
  it('answers 404 through the status route rule when the run is not visible', async () => {
    const error = new AppException(ErrorCode.ANALYSIS_RUN_NOT_FOUND, 'no', HttpStatus.NOT_FOUND);
    const { service } = makeService({ analysisRun: error });

    await expect(service.getAnalysisRunEvidence('run-1', 'user-1', CORRELATION)).rejects.toBe(error);
  });

  it.each(['QUEUED', 'PROCESSING'])('answers 409 EVIDENCE_NOT_FINISHED while the run is %s', async (status) => {
    const { service, evidenceRepository } = makeService({ analysisRun: run(status) });

    const failure = await failureOf(service.getAnalysisRunEvidence('run-1', 'user-1', CORRELATION));

    expect(failure).toEqual({ code: ErrorCode.EVIDENCE_NOT_FINISHED, status: HttpStatus.CONFLICT });
    expect(evidenceRepository.findExecutionsForEvidence).not.toHaveBeenCalled();
  });

  it.each(['ACTION_REQUIRED', 'SUCCESS', 'BEHAVIORAL_MISMATCH', 'INFRASTRUCTURE_FAILURE', 'OBSOLETE'])(
    'answers 200 for the terminal or action-required status %s',
    async (status) => {
      const { service } = makeService({ analysisRun: run(status) });

      const bundle = await service.getAnalysisRunEvidence('run-1', 'user-1', CORRELATION);

      expect(bundle).toMatchObject({ kind: 'ANALYSIS_RUN', subjectId: 'run-1', correlationId: CORRELATION });
    },
  );

  it('uses the injected clock for generatedAt and the x-correlation-id value as correlationId', async () => {
    const { service } = makeService();

    const bundle = await service.getAnalysisRunEvidence('run-1', 'user-1', CORRELATION);

    expect(bundle.generatedAt).toBe('2026-10-09T12:34:56.000Z');
    expect(bundle.correlationId).toBe(CORRELATION);
  });

  it('reuses the trace targets and publication instead of rereading them', async () => {
    const { service, analysisRunTraceService } = makeService();

    await service.getAnalysisRunEvidence('run-1', 'user-1', CORRELATION);

    expect(analysisRunTraceService.loadTargets).toHaveBeenCalledTimes(1);
  });
});

describe('EvidenceService.getExperimentEvidence (WI-CORE-027)', () => {
  it('answers 404 EXPERIMENT_NOT_FOUND when the experiment is not visible', async () => {
    const { service } = makeService({ experiment: null });

    const failure = await failureOf(service.getExperimentEvidence('exp-1', 'user-1', CORRELATION));

    expect(failure).toEqual({ code: ErrorCode.EXPERIMENT_NOT_FOUND, status: HttpStatus.NOT_FOUND });
  });

  it.each(['PENDING', 'RUNNING'])('answers 409 EVIDENCE_NOT_FINISHED while the experiment is %s', async (status) => {
    const { service, experimentRunsRepository } = makeService({ experiment: experimentRow(status) });

    const failure = await failureOf(service.getExperimentEvidence('exp-1', 'user-1', CORRELATION));

    expect(failure).toEqual({ code: ErrorCode.EVIDENCE_NOT_FINISHED, status: HttpStatus.CONFLICT });
    expect(experimentRunsRepository.findRepetitions).not.toHaveBeenCalled();
  });

  it('answers 200 for a FAILED experiment, which is terminal', async () => {
    const { service } = makeService({ experiment: experimentRow('FAILED') });

    const bundle = await service.getExperimentEvidence('exp-1', 'user-1', CORRELATION);

    expect(bundle).toMatchObject({ kind: 'EXPERIMENT', subjectId: 'exp-1', analysisRun: null, publication: null });
  });

  it('reads the traces of the current repetitions only, from the repetitions the service returned', async () => {
    const { service, experimentRunsRepository, evidenceRepository } = makeService();
    experimentRunsRepository.findRepetitions.mockResolvedValueOnce([{ id: 'rep-1' }, { id: 'rep-2' }]);

    await service.getExperimentEvidence('exp-1', 'user-1', CORRELATION);

    expect(evidenceRepository.findContextTracesByRepetitionIds).toHaveBeenCalledWith(['rep-1', 'rep-2']);
  });
});

describe('EvidenceService.getRetrievalComparisonEvidence (WI-CORE-027)', () => {
  it('answers 404 RETRIEVAL_COMPARISON_NOT_FOUND when the comparison does not exist', async () => {
    const { service } = makeService({ comparison: null });

    const failure = await failureOf(service.getRetrievalComparisonEvidence('cmp-1', CORRELATION));

    expect(failure).toEqual({ code: ErrorCode.RETRIEVAL_COMPARISON_NOT_FOUND, status: HttpStatus.NOT_FOUND });
  });

  it.each(['PENDING', 'RUNNING'])('answers 409 EVIDENCE_NOT_FINISHED while the comparison is %s', async (status) => {
    const { service, retrievalComparisonsRepository } = makeService({ comparison: comparisonRow(status) });

    const failure = await failureOf(service.getRetrievalComparisonEvidence('cmp-1', CORRELATION));

    expect(failure).toEqual({ code: ErrorCode.EVIDENCE_NOT_FINISHED, status: HttpStatus.CONFLICT });
    expect(retrievalComparisonsRepository.findResults).not.toHaveBeenCalled();
  });

  it('answers 200 for a FAILED comparison with an empty retrieval and without reading results', async () => {
    const { service, retrievalComparisonsRepository } = makeService({ comparison: comparisonRow('FAILED') });

    const bundle = await service.getRetrievalComparisonEvidence('cmp-1', CORRELATION);

    expect(bundle).toMatchObject({ kind: 'RETRIEVAL_COMPARISON', subjectId: 'cmp-1', retrieval: [] });
    expect(retrievalComparisonsRepository.findResults).not.toHaveBeenCalled();
  });

  it('reads the results of a COMPLETED comparison', async () => {
    const { service, retrievalComparisonsRepository } = makeService({ results: [] });

    await service.getRetrievalComparisonEvidence('cmp-1', CORRELATION);

    expect(retrievalComparisonsRepository.findResults).toHaveBeenCalledWith('cmp-1');
  });
});
