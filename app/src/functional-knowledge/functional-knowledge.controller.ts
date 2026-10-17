import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { FunctionalKnowledgeService } from './functional-knowledge.service.js';
import { ListActionRequiredQueryDto } from './dto/list-action-required-query.dto.js';
import { ListFunctionalKnowledgeQueryDto } from './dto/list-functional-knowledge-query.dto.js';
import { SubmitFunctionalAnswerRequestDto } from './dto/submit-functional-answer.dto.js';
import type { FunctionalQuestionResponse, FunctionalQuestionSetResponse } from './dto/functional-question.response.js';
import type { FunctionalKnowledgeResponse } from './dto/functional-knowledge.response.js';
import type { FunctionalAnswerAcceptedResponse } from './dto/functional-answer-accepted.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import type { Page } from '../common/dto/page.response.js';
import { ProjectTargets, RequireProjectRole } from '../project-access/access-policy.js';

@Controller()
export class FunctionalKnowledgeController {
  constructor(private readonly functionalKnowledgeService: FunctionalKnowledgeService) {}

  @Get('action-required')
  @RequireProjectRole('READER', ProjectTargets.optionalQueryProject('projectId'))
  listActionRequired(
    @Query() query: ListActionRequiredQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<Page<FunctionalQuestionResponse>> {
    return this.functionalKnowledgeService.listActionRequired(userId, query.projectId, query.cursor, query.limit);
  }

  @Get('analysis-runs/:analysisRunId/context-questions')
  @RequireProjectRole('READER', ProjectTargets.param('analysisRun', 'analysisRunId'))
  getQuestionSet(
    @Param('analysisRunId') analysisRunId: string,
    @CurrentUserId() userId: string,
  ): Promise<FunctionalQuestionSetResponse> {
    return this.functionalKnowledgeService.getQuestionSet(analysisRunId, userId);
  }

  @Post('analysis-runs/:analysisRunId/context-questions/:questionId/answers')
  @RequireProjectRole('MAINTAINER', ProjectTargets.param('analysisRun', 'analysisRunId'))
  @HttpCode(HttpStatus.ACCEPTED)
  submitAnswer(
    @Param('analysisRunId') analysisRunId: string,
    @Param('questionId') questionId: string,
    @Body() body: SubmitFunctionalAnswerRequestDto,
    @CurrentUserId() userId: string,
  ): Promise<FunctionalAnswerAcceptedResponse> {
    return this.functionalKnowledgeService.submitAnswer(analysisRunId, questionId, body, userId);
  }

  @Get('projects/:projectId/functional-knowledge')
  @RequireProjectRole('READER', ProjectTargets.project('projectId'))
  listKnowledge(
    @Param('projectId') projectId: string,
    @Query() query: ListFunctionalKnowledgeQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<Page<FunctionalKnowledgeResponse>> {
    return this.functionalKnowledgeService.listKnowledge(projectId, query.status, query.cursor, query.limit, userId);
  }
}
