import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import { ActiveKnowledgeConflictError, FunctionalKnowledgeRepository } from './functional-knowledge.repository.js';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';
import { FUNCTIONAL_CONTINUATION_JOB_TYPE } from './functional-continuation-job.handler.js';
import { AnalysisRunsRepository } from '../analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { ProjectAccessService, type AccessGrant } from '../project-access/project-access.service.js';
import { projectRoleInsufficient } from '../project-access/project-access.errors.js';
import { JobsService } from '../jobs/jobs.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import {
  toFunctionalQuestionResponse,
  type ConfirmingRole,
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
import type {
  AnalysisRun,
  FunctionalKnowledge,
  FunctionalKnowledgeStatus,
  FunctionalQuestion,
  FunctionalScope,
  ScenarioKind,
} from '../generated/prisma/client.js';
import type { Page } from '../common/dto/page.response.js';

const DEFAULT_PAGE_LIMIT = 20;
const DEFAULT_POLL_AFTER_MS = 1500;

function questionTargetRef(question: Pick<FunctionalQuestion, 'filePath' | 'qualifiedName'>): string {
  return `${question.filePath}::${question.qualifiedName}`;
}

function questionScope(kind: FunctionalQuestion['symbolKind']): FunctionalScope {
  return kind === 'METHOD' ? 'METHOD' : 'SYMBOL';
}

/**
 * WI-CORE-020 (DEC-FK-004): la regla hereda el escenario de su pregunta. Una pregunta histórica
 * (columnas nulas) produce `EXPECTED_RESULT` / `LEGACY`. Nunca se calcula desde la respuesta.
 */
function questionScenario(
  question: Pick<FunctionalQuestion, 'scenarioKind' | 'scenarioKey'>,
): { scenarioKind: ScenarioKind; scenarioKey: string } {
  return {
    scenarioKind: question.scenarioKind ?? 'EXPECTED_RESULT',
    scenarioKey: question.scenarioKey ?? 'LEGACY',
  };
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
    // Orden fijo (plan de WI-CORE-018): Run 404 → pregunta 404 → obsoleta 404 → no PENDING 404
    // → rol MAINTAINER → rama UNKNOWN (abstención) → rama normal.
    const run = await this.findRunOrThrow(analysisRunId, ownerUserId);
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

    const grant = await this.projectAccess.require(ownerUserId, run.projectId, 'MAINTAINER');

    if (body.choice === 'UNKNOWN') {
      // DEC-FK-002: abstención auditada. No responde la pregunta, no crea ni toca FunctionalKnowledge,
      // no evalúa ni encola continuación, y no hay generación.
      const abstention = await this.functionalQuestionsRepository.recordAbstention(
        question.id,
        ownerUserId,
        this.confirmingRole(grant),
      );

      if (!abstention) {
        throw this.questionNotFound(analysisRunId, questionId);
      }

      return {
        status: 'PENDING',
        pollAfterMs: this.configService.get<number>('INDEXING_POLL_AFTER_MS', DEFAULT_POLL_AFTER_MS),
        analysisRunId: run.id,
        questionId: question.id,
        continuationAttemptId: null,
        knowledgeId: null,
        outcome: 'ABSTAINED',
      };
    }

    const knowledgeId = await this.resolveKnowledge(run, question, body, ownerUserId, this.confirmingRole(grant));
    const answered = await this.functionalQuestionsRepository.answer(question.id, {
      answerChoice: body.choice,
      answerText: body.answer ?? null,
      knowledgeId,
    });

    if (!answered) {
      // La pregunta dejó de estar PENDING entre la lectura y la escritura condicional.
      throw this.questionNotFound(analysisRunId, questionId);
    }

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
      outcome: 'ANSWERED',
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
   * Solo para respuestas no `UNKNOWN`: la abstención (DEC-FK-002) se resuelve antes en
   * `submitAnswer` y nunca crea ni modifica `FunctionalKnowledge`. Sin normalización
   * semántica vía LLM: `normalizedRule` es la respuesta cruda.
   *
   * WI-CORE-020 (DEC-FK-001): la búsqueda de regla activa, el conflicto y el SUPERSEDE se
   * acotan a Project + scope + targetRef + `scenarioKey`. Reglas con otra clave coexisten como
   * ACTIVE. El `scenarioKind`/`scenarioKey` se hereda de la pregunta (DEC-FK-004). Una carrera
   * con otra respuesta de la misma clave la resuelve el índice único: la segunda recibe el 409.
   *
   * Procedencia (INTEROP-2.7): toda regla nueva o sustituida registra quién la confirmó,
   * con qué rol y el `headSha` de la pregunta respondida. `originHeadSha` no invalida la
   * regla: la vigencia se decide solo por status/scope/targetRef/scenarioKey.
   */
  private async resolveKnowledge(
    run: AnalysisRun,
    question: FunctionalQuestion,
    body: SubmitFunctionalAnswerRequestDto,
    confirmedByUserId: string,
    confirmedRole: ConfirmingRole,
  ): Promise<string | null> {
    const scope = questionScope(question.symbolKind);
    const targetRef = questionTargetRef(question);
    const scenario = questionScenario(question);
    const normalizedRule = body.answer ?? body.choice;
    const ruleInput = {
      projectId: run.projectId,
      scope,
      targetRef,
      originalQuestion: question.question,
      originalAnswer: normalizedRule,
      normalizedRule,
      ...scenario,
      confirmedByUserId,
      confirmedRole,
      originHeadSha: run.headSha,
    };
    const existing = await this.functionalKnowledgeRepository.findActive(
      run.projectId,
      scope,
      targetRef,
      scenario.scenarioKey,
    );

    if (!existing) {
      const created = await this.persistRule(run, question, normalizedRule, () =>
        this.functionalKnowledgeRepository.create(ruleInput),
      );
      return created.id;
    }

    if (!body.conflictResolution) {
      throw this.knowledgeConflict(run, question, existing, normalizedRule);
    }

    if (body.conflictResolution.conflictId !== question.id) {
      throw this.questionNotFound(run.id, question.id);
    }

    if (body.conflictResolution.action === 'KEEP_EXISTING') {
      return null;
    }

    const superseded = await this.persistRule(run, question, normalizedRule, () =>
      this.functionalKnowledgeRepository.supersede(existing.id, ruleInput),
    );
    return superseded.id;
  }

  /**
   * Traduce la violación del índice ACTIVE (carrera entre dos respuestas con la misma clave) al
   * mismo 409 que el conflicto normal, con la regla ganadora en `conflictingKnowledge`.
   */
  private async persistRule(
    run: AnalysisRun,
    question: FunctionalQuestion,
    normalizedRule: string,
    write: () => Promise<FunctionalKnowledge>,
  ): Promise<FunctionalKnowledge> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof ActiveKnowledgeConflictError) {
        throw this.knowledgeConflict(run, question, error.winner, normalizedRule);
      }

      throw error;
    }
  }

  private knowledgeConflict(
    run: AnalysisRun,
    question: FunctionalQuestion,
    active: FunctionalKnowledge,
    normalizedRule: string,
  ): AppException {
    const targetRef = questionTargetRef(question);
    const conflict: FunctionalKnowledgeConflictResponse = {
      conflictId: question.id,
      analysisRunId: run.id,
      questionId: question.id,
      conflictingKnowledge: toFunctionalKnowledgeResponse(active),
      proposedNormalizedRule: normalizedRule,
    };

    return new AppException(
      ErrorCode.FUNCTIONAL_KNOWLEDGE_CONFLICT,
      `La respuesta contradice una regla funcional ACTIVE existente para "${targetRef}".`,
      HttpStatus.CONFLICT,
      conflict,
    );
  }

  private isRunStale(run: AnalysisRun): boolean {
    return run.status !== 'ACTION_REQUIRED' || !run.current;
  }

  /** El rol efectivo de una abstención es ADMIN o MAINTAINER; cualquier otro rol no puede registrarla. */
  private confirmingRole(grant: AccessGrant): ConfirmingRole {
    if (grant.role === 'ADMIN' || grant.role === 'MAINTAINER') {
      return grant.role;
    }

    throw projectRoleInsufficient('MAINTAINER', grant.role);
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
