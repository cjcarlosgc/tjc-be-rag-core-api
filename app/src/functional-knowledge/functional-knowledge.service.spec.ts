import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionalKnowledgeService } from './functional-knowledge.service.js';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import { FunctionalKnowledgeRepository } from './functional-knowledge.repository.js';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';
import { FUNCTIONAL_CONTINUATION_JOB_TYPE } from './functional-continuation-job.handler.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type {
  AnalysisRun,
  FunctionalKnowledge,
  FunctionalQuestion,
  FunctionalQuestionAbstention,
} from '../generated/prisma/client.js';

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

type QuestionWithAbstentions = FunctionalQuestion & { abstentions: FunctionalQuestionAbstention[] };

function buildQuestion(overrides: Partial<QuestionWithAbstentions> = {}): QuestionWithAbstentions {
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
    scenarioKind: null,
    scenarioKey: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    answeredAt: null,
    abstentions: [],
    ...overrides,
  } as QuestionWithAbstentions;
}

function buildAbstention(overrides: Partial<FunctionalQuestionAbstention> = {}): FunctionalQuestionAbstention {
  return {
    id: 'abstention-1',
    questionId: 'question-1',
    userId: 'user-1',
    role: 'MAINTAINER',
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  } as FunctionalQuestionAbstention;
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
    recordAbstention: ReturnType<typeof vi.fn>;
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
  let projectAccess: { require: ReturnType<typeof vi.fn> };
  let jobsService: { enqueue: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    functionalQuestionsRepository = {
      findActionRequired: vi.fn(),
      findPendingByAnalysisRun: vi.fn(),
      findById: vi.fn(),
      markObsolete: vi.fn(),
      answer: vi.fn().mockResolvedValue(buildQuestion({ status: 'ANSWERED' })),
      recordAbstention: vi.fn(),
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
    projectAccess = { require: vi.fn().mockResolvedValue({ project: { id: 'project-1' }, role: 'MAINTAINER' }) };
    jobsService = { enqueue: vi.fn() };

    service = new FunctionalKnowledgeService(
      functionalQuestionsRepository as unknown as FunctionalQuestionsRepository,
      functionalKnowledgeRepository as unknown as FunctionalKnowledgeRepository,
      functionalContextEvaluatorService as unknown as FunctionalContextEvaluatorService,
      analysisRunsRepository as unknown as AnalysisRunsRepository,
      analysisRunsService as unknown as AnalysisRunsService,
      projectAccess as unknown as ProjectAccessService,
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

      await expect(service.getQuestionSet('run-1', OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.ANALYSIS_RUN_NOT_FOUND,
      });
    });

    it('exposes the abstention summary computed from the question abstentions', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findPendingByAnalysisRun.mockResolvedValue(
        buildQuestion({
          abstentions: [
            buildAbstention({ id: 'a-2', userId: 'user-2', role: 'ADMIN', createdAt: new Date('2026-01-03T00:00:00.000Z') }),
            buildAbstention({ id: 'a-1', userId: 'user-1', role: 'MAINTAINER', createdAt: new Date('2026-01-02T00:00:00.000Z') }),
          ],
        }),
      );

      const result = await service.getQuestionSet('run-1', OWNER_USER_ID);

      expect(result.currentQuestion?.abstention).toEqual({
        count: 2,
        lastAt: '2026-01-03T00:00:00.000Z',
        lastByUserId: 'user-2',
        lastByRole: 'ADMIN',
      });
    });

    it('reports abstention null when the question has no abstentions', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findPendingByAnalysisRun.mockResolvedValue(buildQuestion());

      const result = await service.getQuestionSet('run-1', OWNER_USER_ID);

      expect(result.currentQuestion?.abstention).toBeNull();
    });

    it('maps historical questions (null scenario columns) to EXPECTED_RESULT and LEGACY', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findPendingByAnalysisRun.mockResolvedValue(buildQuestion());

      const result = await service.getQuestionSet('run-1', OWNER_USER_ID);

      expect(result.currentQuestion).toMatchObject({ scenarioKind: 'EXPECTED_RESULT', scenarioKey: 'LEGACY' });
    });

    it('exposes the scenario of a question created with one', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findPendingByAnalysisRun.mockResolvedValue(
        buildQuestion({ scenarioKind: 'EXCEPTION', scenarioKey: 'EXCEPTION:0123456789abcdef' }),
      );

      const result = await service.getQuestionSet('run-1', OWNER_USER_ID);

      expect(result.currentQuestion).toMatchObject({
        scenarioKind: 'EXCEPTION',
        scenarioKey: 'EXCEPTION:0123456789abcdef',
      });
    });
  });

  describe('submitAnswer', () => {
    it('answers 403 PROJECT_ROLE_INSUFFICIENT to a Reader on a pending question, before any write (HU60)', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      projectAccess.require.mockRejectedValue(new AppException(ErrorCode.PROJECT_ROLE_INSUFFICIENT, 'no', 403));

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_ROLE_INSUFFICIENT });
      expect(projectAccess.require).toHaveBeenCalledWith(OWNER_USER_ID, 'project-1', 'MAINTAINER');
      expect(functionalQuestionsRepository.answer).not.toHaveBeenCalled();
      expect(functionalQuestionsRepository.recordAbstention).not.toHaveBeenCalled();
    });

    it('throws FUNCTIONAL_QUESTION_NOT_FOUND when the question does not belong to the run', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion({ analysisRunId: 'other-run' }));

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
    });

    it('throws FUNCTIONAL_QUESTION_NOT_FOUND for an already-answered question', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion({ status: 'ANSWERED' }));

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
    });

    it('obsoletes and rejects a PENDING question when the run is no longer current', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun({ current: false }));
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
      expect(functionalQuestionsRepository.markObsolete).toHaveBeenCalledWith('question-1');
      expect(functionalQuestionsRepository.answer).not.toHaveBeenCalled();
    });

    it('a HEAD change makes a pending question OBSOLETE even when the answer is UNKNOWN', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun({ current: false }));
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'UNKNOWN' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
      expect(functionalQuestionsRepository.markObsolete).toHaveBeenCalledWith('question-1');
      expect(functionalQuestionsRepository.recordAbstention).not.toHaveBeenCalled();
    });

    it('orders the checks as 404 run, 404 question, obsolete, then role: a missing question never reaches the role check', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(null);
      projectAccess.require.mockRejectedValue(new AppException(ErrorCode.PROJECT_ROLE_INSUFFICIENT, 'no', 403));

      await expect(
        service.submitAnswer('run-1', 'missing', { choice: 'UNKNOWN' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
      expect(projectAccess.require).not.toHaveBeenCalled();
      expect(functionalQuestionsRepository.recordAbstention).not.toHaveBeenCalled();
    });

    it('a stale question is obsoleted and answers 404 for a Reader with UNKNOWN, without reaching the role check', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun({ current: false }));
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      projectAccess.require.mockRejectedValue(new AppException(ErrorCode.PROJECT_ROLE_INSUFFICIENT, 'no', 403));

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'UNKNOWN' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
      expect(projectAccess.require).not.toHaveBeenCalled();
      expect(functionalQuestionsRepository.markObsolete).toHaveBeenCalledWith('question-1');
    });

    it('rejects UNKNOWN from a Reader with 403 and records no abstention (DEC-FK-002)', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      projectAccess.require.mockRejectedValue(new AppException(ErrorCode.PROJECT_ROLE_INSUFFICIENT, 'no', 403));

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'UNKNOWN' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_ROLE_INSUFFICIENT });
      expect(functionalQuestionsRepository.recordAbstention).not.toHaveBeenCalled();
    });

    it('rejects UNKNOWN when the effective grant role is below MAINTAINER (defensive)', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      projectAccess.require.mockResolvedValue({ project: { id: 'project-1' }, role: 'READER' });

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'UNKNOWN' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_ROLE_INSUFFICIENT });
      expect(functionalQuestionsRepository.recordAbstention).not.toHaveBeenCalled();
    });

    it('UNKNOWN registers an abstention with the Maintainer role and touches nothing else (ABSTAINED)', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalQuestionsRepository.recordAbstention.mockResolvedValue({
        count: 1,
        lastAt: '2026-01-02T00:00:00.000Z',
        lastByUserId: OWNER_USER_ID,
        lastByRole: 'MAINTAINER',
      });

      const result = await service.submitAnswer(
        'run-1',
        'question-1',
        { choice: 'UNKNOWN', answer: 'no lo sé' },
        OWNER_USER_ID,
      );

      expect(functionalQuestionsRepository.recordAbstention).toHaveBeenCalledWith('question-1', OWNER_USER_ID, 'MAINTAINER');
      expect(functionalQuestionsRepository.answer).not.toHaveBeenCalled();
      expect(functionalKnowledgeRepository.findActive).not.toHaveBeenCalled();
      expect(functionalKnowledgeRepository.create).not.toHaveBeenCalled();
      expect(functionalKnowledgeRepository.supersede).not.toHaveBeenCalled();
      expect(functionalContextEvaluatorService.evaluate).not.toHaveBeenCalled();
      expect(analysisRunsService.requestContinuation).not.toHaveBeenCalled();
      expect(jobsService.enqueue).not.toHaveBeenCalled();
      expect(functionalQuestionsRepository.markObsolete).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'PENDING',
        pollAfterMs: 1500,
        analysisRunId: 'run-1',
        questionId: 'question-1',
        continuationAttemptId: null,
        knowledgeId: null,
        outcome: 'ABSTAINED',
      });
    });

    it('records the effective ADMIN role of the grant on an abstention', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      projectAccess.require.mockResolvedValue({ project: { id: 'project-1' }, role: 'ADMIN' });
      functionalQuestionsRepository.recordAbstention.mockResolvedValue({
        count: 1,
        lastAt: '2026-01-02T00:00:00.000Z',
        lastByUserId: OWNER_USER_ID,
        lastByRole: 'ADMIN',
      });

      await service.submitAnswer('run-1', 'question-1', { choice: 'UNKNOWN' }, OWNER_USER_ID);

      expect(functionalQuestionsRepository.recordAbstention).toHaveBeenCalledWith('question-1', OWNER_USER_ID, 'ADMIN');
    });

    it('UNKNOWN on a question answered or obsoleted in parallel answers 404 (no abstention recorded)', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalQuestionsRepository.recordAbstention.mockResolvedValue(null);

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'UNKNOWN' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
      expect(functionalQuestionsRepository.answer).not.toHaveBeenCalled();
      expect(functionalContextEvaluatorService.evaluate).not.toHaveBeenCalled();
    });

    it('UNKNOWN on an already-answered question answers 404 before recording anything', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion({ status: 'ANSWERED' }));

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'UNKNOWN' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
      expect(functionalQuestionsRepository.recordAbstention).not.toHaveBeenCalled();
    });

    it('two concurrent UNKNOWN submissions both answer ABSTAINED and never mutate the question or the run', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalQuestionsRepository.recordAbstention
        .mockResolvedValueOnce({ count: 1, lastAt: '2026-01-02T00:00:00.000Z', lastByUserId: 'user-1', lastByRole: 'MAINTAINER' })
        .mockResolvedValueOnce({ count: 2, lastAt: '2026-01-02T00:00:01.000Z', lastByUserId: 'user-2', lastByRole: 'ADMIN' });

      const [first, second] = await Promise.all([
        service.submitAnswer('run-1', 'question-1', { choice: 'UNKNOWN' }, OWNER_USER_ID),
        service.submitAnswer('run-1', 'question-1', { choice: 'UNKNOWN' }, 'user-2'),
      ]);

      expect(first.outcome).toBe('ABSTAINED');
      expect(second.outcome).toBe('ABSTAINED');
      expect(functionalQuestionsRepository.recordAbstention).toHaveBeenCalledTimes(2);
      expect(functionalQuestionsRepository.answer).not.toHaveBeenCalled();
      expect(functionalQuestionsRepository.markObsolete).not.toHaveBeenCalled();
      expect(analysisRunsService.requestContinuation).not.toHaveBeenCalled();
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
      expect(result.outcome).toBe('ANSWERED');
      expect(functionalQuestionsRepository.recordAbstention).not.toHaveBeenCalled();
    });

    it('responds 409 FUNCTIONAL_KNOWLEDGE_CONFLICT when ACTIVE knowledge exists and no conflictResolution is given', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalKnowledgeRepository.findActive.mockResolvedValue(buildKnowledge());

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'NO', answer: 'no, cambió' }, OWNER_USER_ID),
      ).rejects.toMatchObject({
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
      expect(result.outcome).toBe('ANSWERED');
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
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
    });

    it('answers 404 when the conditional answer finds the question no longer PENDING', async () => {
      analysisRunsRepository.findByIdForOwner.mockResolvedValue(buildRun());
      functionalQuestionsRepository.findById.mockResolvedValue(buildQuestion());
      functionalKnowledgeRepository.create.mockResolvedValue(buildKnowledge());
      functionalQuestionsRepository.answer.mockResolvedValue(null);

      await expect(
        service.submitAnswer('run-1', 'question-1', { choice: 'YES' }, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND });
      expect(functionalContextEvaluatorService.evaluate).not.toHaveBeenCalled();
      expect(analysisRunsService.requestContinuation).not.toHaveBeenCalled();
      expect(jobsService.enqueue).not.toHaveBeenCalled();
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
      expect(result.outcome).toBe('ANSWERED');
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
      expect(result.outcome).toBe('ANSWERED');
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
      expect(projectAccess.require).not.toHaveBeenCalled();
    });

    it('exposes the abstention summary and scenario fields of each inbox item', async () => {
      functionalQuestionsRepository.findActionRequired.mockResolvedValue([
        {
          ...buildQuestion({
            scenarioKind: 'BOUNDARY',
            scenarioKey: 'BOUNDARY:0123456789abcdef',
            abstentions: [
              buildAbstention({ userId: 'user-9', role: 'ADMIN', createdAt: new Date('2026-01-05T10:00:00.000Z') }),
            ],
          }),
          analysisRun: buildRun(),
        },
      ]);

      const result = await service.listActionRequired(OWNER_USER_ID, undefined, undefined, undefined);

      expect(result.items[0]).toMatchObject({
        scenarioKind: 'BOUNDARY',
        scenarioKey: 'BOUNDARY:0123456789abcdef',
        abstention: {
          count: 1,
          lastAt: '2026-01-05T10:00:00.000Z',
          lastByUserId: 'user-9',
          lastByRole: 'ADMIN',
        },
      });
    });

    it('requires Reader access to the requested project and answers 404 PROJECT_NOT_FOUND when it is not visible', async () => {
      projectAccess.require.mockRejectedValue(new AppException(ErrorCode.PROJECT_NOT_FOUND, 'nope', 404));

      await expect(
        service.listActionRequired(OWNER_USER_ID, 'project-x', undefined, undefined),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NOT_FOUND });
      expect(projectAccess.require).toHaveBeenCalledWith(OWNER_USER_ID, 'project-x', 'READER');
      expect(functionalQuestionsRepository.findActionRequired).not.toHaveBeenCalled();
    });

    it('lists the questions of a visible project', async () => {
      functionalQuestionsRepository.findActionRequired.mockResolvedValue([]);

      await service.listActionRequired(OWNER_USER_ID, 'project-1', undefined, undefined);

      expect(functionalQuestionsRepository.findActionRequired).toHaveBeenCalledWith(
        OWNER_USER_ID,
        'project-1',
        'PENDING',
        20,
        undefined,
      );
    });
  });

  describe('listKnowledge', () => {
    it('throws PROJECT_NOT_FOUND when the project is not visible to the user', async () => {
      projectAccess.require.mockRejectedValue(new AppException(ErrorCode.PROJECT_NOT_FOUND, 'nope', 404));

      await expect(
        service.listKnowledge('project-1', undefined, undefined, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NOT_FOUND });
    });

    it('lists knowledge scoped to the project', async () => {
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
