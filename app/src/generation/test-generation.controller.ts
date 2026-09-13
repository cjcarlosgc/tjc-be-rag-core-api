import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { TestGenerationService } from './test-generation.service.js';
import { CreateTestRunDto } from './dto/create-test-run.dto.js';
import type {
  TargetRetryAcceptedResponse,
  TestRunAcceptedResponse,
  TestRunResultsResponse,
  TestRunStatusResponse,
  TestRunSummaryResponse,
} from './dto/test-run.response.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import type { Page } from '../common/dto/page.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';

@Controller()
export class TestGenerationController {
  constructor(private readonly testGenerationService: TestGenerationService) {}

  @Post('test-runs')
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Body() dto: CreateTestRunDto,
    @CurrentUserId() userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<TestRunAcceptedResponse> {
    return this.testGenerationService.createRun(dto, idempotencyKey, userId);
  }

  @Get('test-runs/:id')
  getStatus(@Param('id') id: string, @CurrentUserId() userId: string): Promise<TestRunStatusResponse> {
    return this.testGenerationService.getStatus(id, userId);
  }

  @Get('test-runs/:id/results')
  getResults(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<TestRunResultsResponse> {
    return this.testGenerationService.getResults(id, userId);
  }

  @Get('project-versions/:id/test-runs')
  getHistory(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<Page<TestRunSummaryResponse>> {
    return this.testGenerationService.getHistory(id, query.limit, query.cursor, userId);
  }

  @Post('test-runs/:id/targets/:targetId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retryTarget(
    @Param('id') id: string,
    @Param('targetId') targetId: string,
    @CurrentUserId() userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<TargetRetryAcceptedResponse> {
    return this.testGenerationService.retryTarget(id, targetId, idempotencyKey, userId);
  }
}
