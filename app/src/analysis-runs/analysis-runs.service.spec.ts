import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisRunsService } from './analysis-runs.service.js';
import { AnalysisRunsRepository } from './analysis-runs.repository.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { AnalysisRun, Project } from '../generated/prisma/client.js';

describe('AnalysisRunsService', () => {
  let service: AnalysisRunsService;
  let repository: {
    create: ReturnType<typeof vi.fn>;
    findCurrentByPullRequest: ReturnType<typeof vi.fn>;
    findByIdForOwner: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findByProjectForOwner: ReturnType<typeof vi.fn>;
  };
  let projectsRepository: { findById: ReturnType<typeof vi.fn> };

  const OWNER_USER_ID = 'user-1';
  const PROJECT_ID = 'project-1';

  const project: Project = {
    id: PROJECT_ID,
    name: 'demo',
    ownerUserId: OWNER_USER_ID,
    currentVersionId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
    return {
      id: 'run-1',
      projectId: PROJECT_ID,
      repositoryId: 'repo-1',
      repositoryName: 'org/repo',
      prNumber: 42,
      prTitle: 'Add feature',
      baseRef: 'develop',
      headRef: 'feature/x',
      baseSha: 'base-sha-1',
      headSha: 'head-sha-1',
      draft: false,
      prState: 'OPEN',
      actorLogin: 'octocat',
      status: 'QUEUED',
      current: true,
      attemptCount: 0,
      indexMode: 'BOOTSTRAP',
      changesetBaseSha: 'base-sha-1',
      changesetHeadSha: 'head-sha-1',
      indexDeltaBaseSha: null,
      functionalBehaviorValidated: false,
      actionRequiredCount: 0,
      generatedTestsCount: 0,
      resultSummary: null,
      completedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    repository = {
      create: vi.fn(),
      findCurrentByPullRequest: vi.fn(),
      findByIdForOwner: vi.fn(),
      update: vi.fn(),
      findByProjectForOwner: vi.fn(),
    };
    projectsRepository = { findById: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisRunsService,
        { provide: AnalysisRunsRepository, useValue: repository },
        { provide: ProjectsRepository, useValue: projectsRepository },
      ],
    }).compile();

    service = module.get(AnalysisRunsService);
  });

  const createInput = {
    projectId: PROJECT_ID,
    repositoryId: 'repo-1',
    repositoryName: 'org/repo',
    prNumber: 42,
    prTitle: 'Add feature',
    baseRef: 'develop',
    headRef: 'feature/x',
    baseSha: 'base-sha-1',
    headSha: 'head-sha-2',
    draft: false,
    actorLogin: 'octocat',
  };

  describe('startRun', () => {
    it('creates a new run when none exists yet for the PR', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      repository.findCurrentByPullRequest.mockResolvedValue(null);
      const created = buildRun({ headSha: 'head-sha-2' });
      repository.create.mockResolvedValue(created);

      const result = await service.startRun(createInput, OWNER_USER_ID);

      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalledWith(createInput);
      expect(result).toEqual(created);
    });

    it('returns the existing run unchanged when the HEAD did not change (redelivery)', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      const existing = buildRun({ headSha: 'head-sha-2', status: 'PROCESSING' });
      repository.findCurrentByPullRequest.mockResolvedValue(existing);

      const result = await service.startRun(createInput, OWNER_USER_ID);

      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it.each(['PROCESSING', 'ACTION_REQUIRED', 'SUCCESS'] as const)(
      'obsoletes the previous current run from %s and creates a new one when the HEAD changed',
      async (previousStatus) => {
        projectsRepository.findById.mockResolvedValue(project);
        const existing = buildRun({ headSha: 'head-sha-1', status: previousStatus });
        repository.findCurrentByPullRequest.mockResolvedValue(existing);
        repository.update.mockResolvedValue({ ...existing, status: 'OBSOLETE', current: false });
        const created = buildRun({ id: 'run-2', headSha: 'head-sha-2' });
        repository.create.mockResolvedValue(created);

        const result = await service.startRun(createInput, OWNER_USER_ID);

        expect(repository.update).toHaveBeenCalledWith(existing.id, {
          status: 'OBSOLETE',
          current: false,
        });
        expect(repository.create).toHaveBeenCalledWith(createInput);
        expect(result).toEqual(created);
      },
    );

    it('throws PROJECT_NOT_FOUND when the project does not belong to the owner', async () => {
      projectsRepository.findById.mockResolvedValue(null);

      await expect(
        service.startRun(createInput, OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({ code: ErrorCode.PROJECT_NOT_FOUND });
    });
  });

  describe('requestContinuation', () => {
    it('moves ACTION_REQUIRED back to PROCESSING and increments attemptCount', async () => {
      const run = buildRun({ status: 'ACTION_REQUIRED', attemptCount: 1 });
      repository.findByIdForOwner.mockResolvedValue(run);
      repository.update.mockResolvedValue({ ...run, status: 'PROCESSING', attemptCount: 2 });

      const result = await service.requestContinuation(run.id, OWNER_USER_ID);

      expect(repository.update).toHaveBeenCalledWith(run.id, {
        status: 'PROCESSING',
        attemptCount: 2,
      });
      expect(result.attemptCount).toBe(2);
    });

    it('throws ANALYSIS_RUN_INVALID_TRANSITION when the run is not ACTION_REQUIRED', async () => {
      const run = buildRun({ status: 'QUEUED' });
      repository.findByIdForOwner.mockResolvedValue(run);

      await expect(
        service.requestContinuation(run.id, OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.ANALYSIS_RUN_INVALID_TRANSITION,
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('throws ANALYSIS_RUN_NOT_FOUND when the run does not belong to the owner', async () => {
      repository.findByIdForOwner.mockResolvedValue(null);

      await expect(
        service.requestContinuation('missing', OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.ANALYSIS_RUN_NOT_FOUND,
      });
    });
  });

  describe('markActionRequired', () => {
    it('moves PROCESSING to ACTION_REQUIRED and increments actionRequiredCount', async () => {
      const run = buildRun({ status: 'PROCESSING', actionRequiredCount: 0 });
      repository.findByIdForOwner.mockResolvedValue(run);
      repository.update.mockResolvedValue({
        ...run,
        status: 'ACTION_REQUIRED',
        actionRequiredCount: 1,
      });

      const result = await service.markActionRequired(run.id, OWNER_USER_ID);

      expect(repository.update).toHaveBeenCalledWith(run.id, {
        status: 'ACTION_REQUIRED',
        actionRequiredCount: 1,
      });
      expect(result.status).toBe('ACTION_REQUIRED');
    });
  });

  describe('completeRun', () => {
    it('moves PROCESSING to a terminal status and stamps completedAt', async () => {
      const run = buildRun({ status: 'PROCESSING' });
      repository.findByIdForOwner.mockResolvedValue(run);
      repository.update.mockResolvedValue({ ...run, status: 'SUCCESS' });

      await service.completeRun(
        run.id,
        'SUCCESS',
        { resultSummary: 'ok', generatedTestsCount: 3 },
        OWNER_USER_ID,
      );

      expect(repository.update).toHaveBeenCalledWith(
        run.id,
        expect.objectContaining({
          status: 'SUCCESS',
          resultSummary: 'ok',
          generatedTestsCount: 3,
          completedAt: expect.any(Date),
        }),
      );
    });

    it('throws ANALYSIS_RUN_INVALID_TRANSITION when the run is not PROCESSING', async () => {
      const run = buildRun({ status: 'QUEUED' });
      repository.findByIdForOwner.mockResolvedValue(run);

      await expect(
        service.completeRun(run.id, 'SUCCESS', {}, OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.ANALYSIS_RUN_INVALID_TRANSITION,
      });
    });
  });

  describe('obsoleteRun', () => {
    it.each(['QUEUED', 'PROCESSING', 'ACTION_REQUIRED', 'SUCCESS'] as const)(
      'obsoletes a run from %s',
      async (status) => {
        const run = buildRun({ status });
        repository.findByIdForOwner.mockResolvedValue(run);
        repository.update.mockResolvedValue({ ...run, status: 'OBSOLETE', current: false });

        const result = await service.obsoleteRun(run.id, OWNER_USER_ID);

        expect(repository.update).toHaveBeenCalledWith(run.id, {
          status: 'OBSOLETE',
          current: false,
        });
        expect(result.status).toBe('OBSOLETE');
      },
    );

    it('is a no-op when the run is already OBSOLETE', async () => {
      const run = buildRun({ status: 'OBSOLETE', current: false });
      repository.findByIdForOwner.mockResolvedValue(run);

      const result = await service.obsoleteRun(run.id, OWNER_USER_ID);

      expect(repository.update).not.toHaveBeenCalled();
      expect(result).toEqual(run);
    });
  });

  describe('listByProject', () => {
    it('requests one extra row to detect a next page and strips it from the returned items', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      repository.findByProjectForOwner.mockResolvedValue([
        buildRun({ id: 'run-3' }),
        buildRun({ id: 'run-2' }),
        buildRun({ id: 'run-1' }),
      ]);

      const page = await service.listByProject(PROJECT_ID, undefined, 2, undefined, OWNER_USER_ID);

      expect(repository.findByProjectForOwner).toHaveBeenCalledWith(
        PROJECT_ID,
        OWNER_USER_ID,
        2,
        undefined,
        undefined,
      );
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBe('run-2');
    });

    it('throws PROJECT_NOT_FOUND when the project does not belong to the owner', async () => {
      projectsRepository.findById.mockResolvedValue(null);

      await expect(
        service.listByProject(PROJECT_ID, undefined, undefined, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({ code: ErrorCode.PROJECT_NOT_FOUND });
    });
  });
});
