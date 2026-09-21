import { Body, Controller, HttpCode, HttpStatus, Param, Post, Get } from '@nestjs/common';
import { TestPublicationsService } from './test-publications.service.js';
import { CreateTestPublicationRequestDto } from './dto/create-test-publication.dto.js';
import type {
  TestPublicationAcceptedResponse,
  TestPublicationResponse,
} from './dto/test-publication.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import { ProjectTargets, RequireProjectRole } from '../project-access/access-policy.js';

@Controller()
export class TestPublicationsController {
  constructor(private readonly testPublicationsService: TestPublicationsService) {}

  @Post('analysis-runs/:analysisRunId/test-publications')
  @RequireProjectRole('MAINTAINER', ProjectTargets.param('analysisRun', 'analysisRunId'))
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Param('analysisRunId') analysisRunId: string,
    @Body() body: CreateTestPublicationRequestDto,
    @CurrentUserId() userId: string,
  ): Promise<TestPublicationAcceptedResponse> {
    return this.testPublicationsService.create(analysisRunId, body.proposalIds, userId);
  }

  @Get('test-publications/:publicationId')
  @RequireProjectRole('READER', ProjectTargets.param('testPublication', 'publicationId'))
  getById(
    @Param('publicationId') publicationId: string,
    @CurrentUserId() userId: string,
  ): Promise<TestPublicationResponse> {
    return this.testPublicationsService.getById(publicationId, userId);
  }
}
