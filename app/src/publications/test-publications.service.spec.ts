import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestPublicationsService } from './test-publications.service.js';
import { TestPublicationsRepository } from './test-publications.repository.js';
import { GeneratedTestProposalsRepository } from '../validation/generated-test-proposals.repository.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { JobsService } from '../jobs/jobs.service.js';
import { TEST_PUBLICATION_JOB_TYPE } from './test-publication-job.handler.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { AnalysisRun, GeneratedTestProposal, TestPublication } from '../generated/prisma/client.js';

const OWNER_USER_ID = 'user-1';

function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    headSha: 'head-sha',
    status: 'SUCCESS',
    current: true,
    ...overrides,
  } as AnalysisRun;
}

function buildProposal(overrides: Partial<GeneratedTestProposal> = {}): GeneratedTestProposal {
  return { id: 'proposal-1', status: 'AVAILABLE', ...overrides } as GeneratedTestProposal;
}

describe('TestPublicationsService', () => {
  let service: TestPublicationsService;
  let testPublicationsRepository: { create: ReturnType<typeof vi.fn>; findByIdForOwner: ReturnType<typeof vi.fn> };
  let generatedTestProposalsRepository: { findByIdsForRun: ReturnType<typeof vi.fn> };
  let analysisRunsRepository: { findByIdForOwner: ReturnType<typeof vi.fn> };
  let jobsService: { enqueue: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    testPublicationsRepository = {
      create: vi.fn().mockResolvedValue({ id: 'publication-1' } as TestPublication),
      findByIdForOwner: vi.fn(),
    };
    generatedTestProposalsRepository = { findByIdsForRun: vi.fn().mockResolvedValue([buildProposal()]) };
    analysisRunsRepository = { findByIdForOwner: vi.fn().mockResolvedValue(buildRun()) };
    jobsService = { enqueue: vi.fn().mockResolvedValue('job-1') };

    service = new TestPublicationsService(
      testPublicationsRepository as unknown as TestPublicationsRepository,
      generatedTestProposalsRepository as unknown as GeneratedTestProposalsRepository,
      analysisRunsRepository as unknown as AnalysisRunsRepository,
      jobsService as unknown as JobsService,
      { get: vi.fn().mockReturnValue(1500) } as never,
    );
  });

  describe('create', () => {
    it('creates a PENDING publication and enqueues the job', async () => {
      const result = await service.create('run-1', ['proposal-1'], OWNER_USER_ID);

      expect(testPublicationsRepository.create).toHaveBeenCalledWith({
        analysisRunId: 'run-1',
        proposalIds: ['proposal-1'],
        sourceHeadSha: 'head-sha',
      });
      expect(jobsService.enqueue).toHaveBeenCalledWith(TEST_PUBLICATION_JOB_TYPE, { publicationId: 'publication-1' });
      expect(result).toEqual({
        status: 'PENDING',
        pollAfterMs: 1500,
        publicationId: 'publication-1',
        analysisRunId: 'run-1',
      });
    });

    it('throws ANALYSIS_RUN_NOT_FOUND when the run does not belong to the owner', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(null);

      await expect(service.create('run-1', ['proposal-1'], OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.ANALYSIS_RUN_NOT_FOUND });
      expect(testPublicationsRepository.create).not.toHaveBeenCalled();
    });

    it('throws TEST_PUBLICATION_INVALID_RUN_STATUS when the run is not SUCCESS', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun({ status: 'PROCESSING' }));

      await expect(service.create('run-1', ['proposal-1'], OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.TEST_PUBLICATION_INVALID_RUN_STATUS });
    });

    it('throws TEST_PUBLICATION_INVALID_RUN_STATUS when the run is no longer current', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun({ current: false }));

      await expect(service.create('run-1', ['proposal-1'], OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.TEST_PUBLICATION_INVALID_RUN_STATUS });
    });

    it('throws TEST_PUBLICATION_PROPOSAL_NOT_AVAILABLE when a proposalId does not belong to the run', async () => {
      generatedTestProposalsRepository.findByIdsForRun.mockResolvedValue([]);

      await expect(service.create('run-1', ['proposal-1'], OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.TEST_PUBLICATION_PROPOSAL_NOT_AVAILABLE });
    });

    it('throws TEST_PUBLICATION_PROPOSAL_NOT_AVAILABLE when a proposal is not AVAILABLE', async () => {
      generatedTestProposalsRepository.findByIdsForRun.mockResolvedValue([buildProposal({ status: 'HELD' })]);

      await expect(service.create('run-1', ['proposal-1'], OWNER_USER_ID)).rejects.toMatchObject<
        Partial<AppException>
      >({ code: ErrorCode.TEST_PUBLICATION_PROPOSAL_NOT_AVAILABLE });
    });
  });

  describe('getById', () => {
    it('returns the mapped publication', async () => {
      testPublicationsRepository.findByIdForOwner.mockResolvedValue({
        id: 'publication-1',
        analysisRunId: 'run-1',
        sourceHeadSha: 'head-sha',
        status: 'PUBLISHED',
        branchName: 'rag-tests/pr-1-abc1234',
        companionPullRequestNumber: 9,
        companionPullRequestUrl: 'https://github.com/org/repo/pull/9',
        failureMessage: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      } as TestPublication);

      const result = await service.getById('publication-1', OWNER_USER_ID);

      expect(result.status).toBe('PUBLISHED');
      expect(result.companionPullRequestNumber).toBe(9);
    });

    it('throws TEST_PUBLICATION_NOT_FOUND when missing', async () => {
      testPublicationsRepository.findByIdForOwner.mockResolvedValue(null);

      await expect(service.getById('publication-1', OWNER_USER_ID)).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.TEST_PUBLICATION_NOT_FOUND,
      });
    });
  });
});
