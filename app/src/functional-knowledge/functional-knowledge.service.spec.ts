import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionalKnowledgeService } from './functional-knowledge.service.js';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import { FunctionalKnowledgeRepository } from './functional-knowledge.repository.js';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';
import { FUNCTIONAL_CONTINUATION_JOB_TYPE } from './functional-continuation-job.handler.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { AnalysisRun, FunctionalKnowledge, FunctionalQuestion } from '../generated/prisma/client.js';

const OWNER_USER_ID = 'user-1';

function buildRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryName: 'org/repo',
    prNumber: 42,
    headSha: 'head-sha',
    status: 'ACTION_REQUIRED',
    current: true,
    functionalBehaviorValidated: false,
    ...overrides,
  } as AnalysisRun;
}

function buildQuestion(overrides: Partial<FunctionalQuestion> = {}): FunctionalQuestion {
  return {
    id: 'question-1',
    analysisRunId: 'run-1',
    projectId: 'project-1',
    symbolLanguage: 'TYPESCRIPT',
    symbolKind: 'METHOD',
    qualifiedName: 'Thing.doIt',
    filePath: 'src/thing.ts',
    question: '¿...?',
    rationale: '...',
    status: 'PENDING',
    answerChoice: null,
    answerText: null,
    knowledgeId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    answeredAt: null,
    ...overrides,
  } as FunctionalQuestion;
}

function buildKnowledge(overrides: Partial<FunctionalKnowledge> = {}): FunctionalKnowledge {
  return {
    id: 'knowledge-1',
    projectId: 'project-1',
    scope: 'METHOD',
    targetRef: 'src/thing.ts::Thing.doIt',
    originalQuestion: '¿...?',
    originalAnswer: 'yes',
    normalizedRule: 'yes',
    source: 'HUMAN_ANSWER',
    status: 'ACTIVE',
    supersedesId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as FunctionalKnowledge;
}

describe('FunctionalKnowledgeService', () => {
  let service: FunctionalKnowledgeService;
  let functionalQuestionsRepository: {
    findActionRequired: ReturnType<typeof vi.fn>;
    findPendingByAnalysisRun: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    markObsolete: ReturnType<typeof vi.fn>;
    answer: ReturnType<typeof vi.fn>;
  };
  let functionalKnowledgeRepository: {
    findActive: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    supersede: ReturnType<typeof vi.fn>;
    findByProjectForOwner: ReturnType<typeof vi.fn>;
  };
  let functionalContextEvaluatorService: { evaluate: ReturnType<typeof vi.fn> };
  let analysisRunsRepository: { findByIdForOwner: ReturnType<typeof vi.fn> };
  let analysisRunsService: { requestContinuation: ReturnType<typeof vi.fn> };
  let projectsRepository: { findById: ReturnType<typeof vi.fn> };
  let jobsService: { enqueue: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    functionalQuestionsRepository = {
      findActionRequired: vi.fn(),
      findPendingByAnalysisRun: vi.fn(),
      findById: vi.fn(),
      markObsolete: vi.fn(),
      answer: vi.fn(),
    };
    functionalKnowledgeRepository = {
      findActive: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      supersede: vi.fn(),
      findByProjectForOwner: vi.fn(),
    };
    functionalContextEvaluatorService = { evaluate: vi.fn().mockResolvedValue({ actionRequired: false }) };
    analysisRunsRepository = { findByIdForOwner: vi.fn() };
    analysisRunsService = {
      requestContinuation: vi.fn().mockResolvedValue(buildRun({ status: 'PROCESSING' })),
    };
    projectsRepository = { findById: vi.fn() };
    jobsService = { enqueue: vi.fn() };

    service = new FunctionalKnowledgeService(
      functionalQuestionsRepository as unknown as FunctionalQuestionsRepository,
      functionalKnowledgeRepository as unknown as FunctionalKnowledgeRepository,
      functionalContextEvaluatorService as unknown as FunctionalContextEvaluatorService,
      analysisRunsRepository as unknown as AnalysisRunsRepository,
      analysisRunsService as unknown as AnalysisRunsService,
      projectsRepository as unknown as ProjectsRepository,
      jobsService as unknown as JobsService,
      { get: vi.fn().mockReturnValue(1500) } as never,
    );
  });

  describe('getQuestionSet', () => {
    it('returns the pending question when the run is ACTION_REQUIRED and current', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findPendingByAnalysisRun.mockResolvedValue(buildQuestion());

      const result = await service.getQuestionSet('run-1', OWNER_USER_ID);

      expect(result.currentQuestion?.id).toBe('question-1');
      expect(result.functionalBehaviorValidated).toBe(false);
      expect(functionalQuestionsRepository.markObsolete).not.toHaveBeenCalled();
    });

    it('returns null and obsoletes the question when the run is no longer current', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun({ current: false }));
      functionalQuestionsRepository.findPendingByAnalysisRun.mockResolvedValue(buildQuestion());

      const result = await service.getQuestionSet('run-1', OWNER_USER_ID);

      expect(result.currentQuestion).toBeNull();
      expect(functionalQuestionsRepository.markObsolete).toHaveBeenCalledWith('question-1');
    });

    it('returns null when there is no pending question', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findPendingByAnalysisRun.mockResolvedValue(null);

      const result = await service.getQuestionSet('run-1', OWNER_USER_ID);

      expect(result.currentQuestion).toBeNull();
    });

    it('throws ANALYSIS_RUN_NOT_FOUND when the run does not belong to the owner', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(null);

      await expect(service.getQuestionSet('run-1', OWNER_USER_ID)).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.ANALYSIS_RUN_NOT_FOUND,
      });
    });
  });

  describe('submitAnswer', () => {
    it('throws FUNCTIONAL_QUESTION_NOT_FOUND when the question does not belong to the run', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion({ analysisRunId: 'other-run' }));

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
    });

    it('throws FUNCTIONAL_QUESTION_NOT_FOUND for an already-answered question', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion({ status: 'ANSWERED' }));

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
    });

    it('obsoletes and rejects a PENDING question when the run is no longer current', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun({ current: false }));
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
      expect(functionalQuestionsRepository.markObsolete).toHaveBeenCalledWith('question-1');
    });

    it('UNKNOWN never creates knowledge and still answers the question', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalQuestionsRepository.answer.mockResolvedValue(buildQuestion({ status: 'ANSWERED' }));

      const result = await service.submitAnswer(
        'run-1',
        'question-1',
        { choice: 'UNKNOWN', answer: 'no lo sé' },
        OWNER_USER_ID,
      );

      expect(functionalKnowledgeRepository.create).not.toHaveBeenCalled();
      expect(functionalQuestionsRepository.answer).toHaveBeenCalledWith('question-1', {
        answerChoice: 'UNKNOWN',
        answerText: 'no lo sé',
        knowledgeId: null,
      });
      expect(result.knowledgeId).toBeNull();
    });

    it('creates new ACTIVE knowledge when none exists yet for the scope', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalKnowledgeRepository.create.mockResolvedValue(buildKnowledge());

      const result = await service.submitAnswer(
        'run-1',
        'question-1',
        { choice: 'YES', answer: 'sí, es intencional' },
        OWNER_USER_ID,
      );

      expect(functionalKnowledgeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          scope: 'METHOD',
          targetRef: 'src/thing.ts::Thing.doIt',
          normalizedRule: 'sí, es intencional',
        }),
      );
      expect(result.knowledgeId).toBe('knowledge-1');
    });

    it('responds 409 FUNCTIONAL_KNOWLEDGE_CONFLICT when ACTIVE knowledge exists and no conflictResolution is given', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalKnowledgeRepository.findActive.mockResolvedValue(buildKnowledge());

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'NO', answer: 'no, cambió' }, OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.FUNCTIONAL_KNOWLEDGE_CONFLICT,
        details: expect.objectContaining({ conflictId: 'question-1', conflictingKnowledge: expect.objectContaining({ id: 'knowledge-1' }) }),
      });
      expect(functionalQuestionsRepository.answer).not.toHaveBeenCalled();
    });

    it('SUPERSEDE persists a new ACTIVE rule referencing the superseded one', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalKnowledgeRepository.findActive.mockResolvedValue(buildKnowledge());
      functionalKnowledgeRepository.supersede.mockResolvedValue(
        buildKnowledge({ id: 'knowledge-2', supersedesId: 'knowledge-1' }),
      );

      const result = await service.submitAnswer(
        'run-1',
        'question-1',
        {
          choice: 'NO',
          answer: 'no, cambió',
          conflictResolution: { conflictId: 'question-1', action: 'SUPERSEDE' },
        },
        OWNER_USER_ID,
      );

      expect(functionalKnowledgeRepository.supersede).toHaveBeenCalledWith(
        'knowledge-1',
        expect.objectContaining({ normalizedRule: 'no, cambió' }),
      );
      expect(result.knowledgeId).toBe('knowledge-2');
    });

    it('KEEP_EXISTING answers the question as evidence without touching the ACTIVE rule', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalKnowledgeRepository.findActive.mockResolvedValue(buildKnowledge());

      const result = await service.submitAnswer(
        'run-1',
        'question-1',
        {
          choice: 'NO',
          answer: 'no estoy seguro',
          conflictResolution: { conflictId: 'question-1', action: 'KEEP_EXISTING' },
        },
        OWNER_USER_ID,
      );

      expect(functionalKnowledgeRepository.supersede).not.toHaveBeenCalled();
      expect(functionalKnowledgeRepository.create).not.toHaveBeenCalled();
      expect(result.knowledgeId).toBeNull();
      expect(functionalQuestionsRepository.answer).toHaveBeenCalledWith(
        'question-1',
        expect.objectContaining({ knowledgeId: null }),
      );
    });

    it('rejects a conflictResolution whose conflictId does not match the question', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalKnowledgeRepository.findActive.mockResolvedValue(buildKnowledge());

      await expect(
        service.submitAnswer(
          'run-1',
          'question-1',
          { choice: 'NO', conflictResolution: { conflictId: 'stale-conflict', action: 'SUPERSEDE' } },
          OWNER_USER_ID,
        ),
      ).rejects.toMatchObject<Partial<AppException>>({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
    });

    it('requests continuation and enqueues the continuation job when no more context is needed', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalKnowledgeRepository.create.mockResolvedValue(buildKnowledge());
      functionalContextEvaluatorService.evaluate.mockResolvedValue({ actionRequired: false });
      analysisRunsService.requestContinuation.mockResolvedValue(buildRun({ status: 'PROCESSING' }));

      const result = await service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID);

      expect(analysisRunsService.requestContinuation).toHaveBeenCalledWith('run-1', OWNER_USER_ID);
      expect(jobsService.enqueue).toHaveBeenCalledWith(FUNCTIONAL_CONTINUATION_JOB_TYPE, { analysisRunId: 'run-1' });
      expect(result.continuationAttemptId).not.toBeNull();
      expect(result.status).toBe('PENDING');
      expect(result.pollAfterMs).toBe(1500);
    });

    it('does not request continuation when more questions remain', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalKnowledgeRepository.create.mockResolvedValue(buildKnowledge());
      functionalContextEvaluatorService.evaluate.mockResolvedValue({ actionRequired: true });

      const result = await service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID);

      expect(analysisRunsService.requestContinuation).not.toHaveBeenCalled();
      expect(jobsService.enqueue).not.toHaveBeenCalled();
      expect(result.continuationAttemptId).toBeNull();
    });
  });

  describe('listActionRequired', () => {
    it('maps each question with its own run for repositoryName/pullRequestNumber/headSha', async () => {
      const run = buildRun();
      functionalQuestionsRepository.findActionRequired.mockResolvedValue([
        { ...buildQuestion(), analysisRun: run },
      ]);

      const result = await service.listActionRequired(OWNER_USER_ID, undefined, undefined, undefined);

      expect(result.items[0].repositoryName).toBe('org/repo');
      expect(result.items[0].pullRequestNumber).toBe(42);
    });
  });

  describe('listKnowledge', () => {
    it('throws PROJECT_NOT_FOUND when the project does not belong to the owner', async () => {
      projectsRepository.findById.mockResolvedValue(null);

      await expect(
        service.listKnowledge('project-1', undefined, undefined, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({ code: ErrorCode.PROJECT_NOT_FOUND });
    });

    it('lists knowledge scoped to the project', async () => {
      projectsRepository.findById.mockResolvedValue({ id: 'project-1' });
      functionalKnowledgeRepository.findByProjectForOwner.mockResolvedValue([buildKnowledge()]);

      const result = await service.listKnowledge('project-1', 'ACTIVE', undefined, undefined, OWNER_USER_ID);

      expect(functionalKnowledgeRepository.findByProjectForOwner).toHaveBeenCalledWith(
        'project-1',
        OWNER_USER_ID,
        'ACTIVE',
        20,
        undefined,
      );
      expect(result.items).toHaveLength(1);
    });
  });
});
