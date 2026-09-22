import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ExperimentsService } from './experiments.service.js';
import { CreateExperimentDto } from './dto/create-experiment.dto.js';
import type {
  ExperimentAcceptedResponse,
  ExperimentResultsResponse,
  ExperimentStatusResponse,
} from './dto/experiment.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import { ProjectTargets, RequireProjectRole } from '../project-access/access-policy.js';

@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experimentsService: ExperimentsService) {}

  @Post()
  @RequireProjectRole('MAINTAINER', ProjectTargets.body('project', 'projectId'))
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Body() dto: CreateExperimentDto,
    @CurrentUserId() userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ExperimentAcceptedResponse> {
    return this.experimentsService.createRun(dto, idempotencyKey, userId);
  }

  @Get(':id')
  @RequireProjectRole('READER', ProjectTargets.param('experiment', 'id'))
  getStatus(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<ExperimentStatusResponse> {
    return this.experimentsService.getStatus(id, userId);
  }

  @Get(':id/results')
  @RequireProjectRole('READER', ProjectTargets.param('experiment', 'id'))
  getResults(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<ExperimentResultsResponse> {
    return this.experimentsService.getResults(id, userId);
  }
}
