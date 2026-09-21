import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import {
  toFunctionalQuestionResponse,
  type FunctionalQuestionResponse,
  type FunctionalQuestionSetResponse,
} from './dto/functional-question.response.js';
import {
  toFunctionalKnowledgeResponse,
  type FunctionalKnowledgeConflictResponse,
  type FunctionalKnowledgeResponse,
} from './dto/functional-knowledge.response.js';
import type { FunctionalAnswerAcceptedResponse } from './dto/functional-answer-accepted.response.js';
import type { SubmitFunctionalAnswerRequestDto } from './dto/submit-functional-answer.dto.js';
import type { AnalysisRun, FunctionalKnowledgeStatus, FunctionalQuestion, FunctionalScope } from '../generated/prisma/client.js';
import type { Page } from '../common/dto/page.response.js';

const DEFAULT_PAGE_LIMIT = 20;
const DEFAULT_POLL_AFTER_MS = 1500;

function questionTargetRef(question: Pick<FunctionalQuestion, 'filePath' | 'qualifiedName'>): string {
  return `${question.filePath}::${question.qualifiedName}`;
}

function questionScope(kind: FunctionalQuestion['symbolKind']): FunctionalScope {
  return kind === 'METHOD' ? 'METHOD' : 'SYMBOL';
}

@Injectable()
export class FunctionalKnowledgeService {
  constructor(
    private readonly functionalQuestionsRepository: FunctionalQuestionsRepository,
    private readonly functionalKnowledgeRepository: FunctionalKnowledgeRepository,
    private readonly functionalContextEvaluatorService: FunctionalContextEvaluatorService,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly projectAccess: ProjectAccessService,
    private readonly jobsService: JobsService,
    private readonly configService: ConfigService,
  ) {}

  async listActionRequired(
    ownerUserId: string,
    projectId: string | undefined,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<Page<FunctionalQuestionResponse>> {
    if (projectId) {
      // Un Project no visible responde `404 PROJECT_NOT_FOUND` (antes, una página vacía).
      await this.projectAccess.require(ownerUserId, projectId, 'READER');
    }

    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.functionalQuestionsRepository.findActionRequired(
      ownerUserId,
      projectId,
      'PENDING',
      take,
      cursor,
    );
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;

    return {
      items: items.map((question) => toFunctionalQuestionResponse(question, question.analysisRun)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async getQuestionSet(analysisRunId: string, ownerUserId: string): Promise<FunctionalQuestionSetResponse> {
    const run = await this.findRunOrThrow(analysisRunId, ownerUserId);
    let pending = await this.functionalQuestionsRepository.findPendingByAnalysisRun(analysisRunId);

    if (pending && this.isRunStale(run)) {
      await this.functionalQuestionsRepository.markObsolete(pending.id);
      pending = null;
    }

    return {
      analysisRunId: run.id,
      currentQuestion: pending ? toFunctionalQuestionResponse(pending, run) : null,
      functionalBehaviorValidated: run.functionalBehaviorValidated,
    };
  }

  async submitAnswer(
    analysisRunId: string,
    questionId: string,
    body: SubmitFunctionalAnswerRequestDto,
    ownerUserId: string,
  ): Promise<FunctionalAnswerAcceptedResponse> {
    const run = await this.findRunOrThrow(analysisRunId, ownerUserId);
    await this.projectAccess.require(ownerUserId, run.projectId, 'MAINTAINER');
    const question = await this.functionalQuestionsRepository.findById(questionId);

    if (!question || question.analysisRunId !== run.id) {
      throw this.questionNotFound(analysisRunId, questionId);
    }

    if (question.status === 'PENDING' && this.isRunStale(run)) {
      await this.functionalQuestionsRepository.markObsolete(question.id);
      throw this.questionNotFound(analysisRunId, questionId);
    }

    if (question.status !== 'PENDING') {
      throw this.questionNotFound(analysisRunId, questionId);
    }

    const knowledgeId = await this.resolveKnowledge(run, question, body);
    await this.functionalQuestionsRepository.answer(question.id, {
      answerChoice: body.choice,
      answerText: body.answer ?? null,
      knowledgeId,
    });

    const evaluation = await this.functionalContextEvaluatorService.evaluate(run);
    let continuationAttemptId: string | null = null;

    if (!evaluation.actionRequired) {
      const continued = await this.analysisRunsService.requestContinuation(run.id, ownerUserId);
      continuationAttemptId = randomUUID();
      await this.jobsService.enqueue(FUNCTIONAL_CONTINUATION_JOB_TYPE, { analysisRunId: continued.id });
    }

    return {
      status: 'PENDING',
      pollAfterMs: this.configService.get<number>('INDEXING_POLL_AFTER_MS', DEFAULT_POLL_AFTER_MS),
      analysisRunId: run.id,
      questionId: question.id,
      continuationAttemptId,
      knowledgeId,
    };
  }

  async listKnowledge(
    projectId: string,
    status: FunctionalKnowledgeStatus | undefined,
    cursor: string | undefined,
    limit: number | undefined,
    ownerUserId: string,
  ): Promise<Page<FunctionalKnowledgeResponse>> {
    await this.projectAccess.require(ownerUserId, projectId, 'READER');

    const take = limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.functionalKnowledgeRepository.findByProjectForOwner(
      projectId,
      ownerUserId,
      status,
      take,
      cursor,
    );
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;

    return {
      items: items.map(toFunctionalKnowledgeResponse),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  /**
   * `UNKNOWN` nunca crea/toca `FunctionalKnowledge` (invariante de
   * `spec.md`). Sin normalización semántica vía LLM: `normalizedRule` es la
   * respuesta cruda. "Conflicto" es conservador (match exacto de scope +
   * targetRef, sin resolver jerarquía PROJECT⊃MODULE⊃CLASS todavía): nunca
   * sobrescribe en silencio, a costa de pedir resolución explícita más
   * seguido de lo estrictamente necesario.
   */
  private async resolveKnowledge(
    run: AnalysisRun,
    question: FunctionalQuestion,
    body: SubmitFunctionalAnswerRequestDto,
  ): Promise<string | null> {
    if (body.choice === 'UNKNOWN') {
      return null;
    }

    const scope = questionScope(question.symbolKind);
    const targetRef = questionTargetRef(question);
    const normalizedRule = body.answer ?? body.choice;
    const existing = await this.functionalKnowledgeRepository.findActive(run.projectId, scope, targetRef);

    if (!existing) {
      const created = await this.functionalKnowledgeRepository.create({
        projectId: run.projectId,
        scope,
        targetRef,
        originalQuestion: question.question,
        originalAnswer: normalizedRule,
        normalizedRule,
      });
      return created.id;
    }

    if (!body.conflictResolution) {
      const conflict: FunctionalKnowledgeConflictResponse = {
        conflictId: question.id,
        analysisRunId: run.id,
        questionId: question.id,
        conflictingKnowledge: toFunctionalKnowledgeResponse(existing),
        proposedNormalizedRule: normalizedRule,
      };
      throw new AppException(
        ErrorCode.FUNCTIONAL_KNOWLEDGE_CONFLICT,
        `La respuesta contradice una regla funcional ACTIVE existente para "${targetRef}".`,
        HttpStatus.CONFLICT,
        conflict,
      );
    }

    if (body.conflictResolution.conflictId !== question.id) {
      throw this.questionNotFound(run.id, question.id);
    }

    if (body.conflictResolution.action === 'KEEP_EXISTING') {
      return null;
    }

    const superseded = await this.functionalKnowledgeRepository.supersede(existing.id, {
      projectId: run.projectId,
      scope,
      targetRef,
      originalQuestion: question.question,
      originalAnswer: normalizedRule,
      normalizedRule,
    });
    return superseded.id;
  }

  private isRunStale(run: AnalysisRun): boolean {
    return run.status !== 'ACTION_REQUIRED' || !run.current;
  }

  private questionNotFound(analysisRunId: string, questionId: string): AppException {
    return new AppException(
      ErrorCode.FUNCTIONAL_QUESTION_NOT_FOUND,
      `No existe una pregunta pendiente "${questionId}" para el AnalysisRun "${analysisRunId}".`,
      HttpStatus.NOT_FOUND,
    );
  }

  private async findRunOrThrow(id: string, ownerUserId: string): Promise<AnalysisRun> {
    const run = await this.analysisRunsRepository.findByIdForOwner(id, ownerUserId);

    if (!run) {
      throw new AppException(
        ErrorCode.ANALYSIS_RUN_NOT_FOUND,
        `No existe un AnalysisRun con id "${id}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return run;
  }
}
