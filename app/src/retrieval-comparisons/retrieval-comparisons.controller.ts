import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import type { Page } from '../common/dto/page.response.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { ProjectTargets, RequireProjectRole } from '../project-access/access-policy.js';
import { CreateRetrievalComparisonDto } from './dto/create-retrieval-comparison.dto.js';
import type {
  RetrievalComparisonAcceptedResponse,
  RetrievalComparisonResultsResponse,
  RetrievalComparisonStatusResponse,
} from './dto/retrieval-comparison.response.js';
import { RetrievalComparisonsService } from './retrieval-comparisons.service.js';

/**
 * Comparación de retrieval SE vs SEM (INTEROP-2.7 §6.15, WI-CORE-022). Crear exige Writer; leer, Reader.
 * El guard default-deny resuelve el Project de cada recurso (404 si no es visible, 403 si el rol es menor).
 */
@Controller()
export class RetrievalComparisonsController {
  constructor(private readonly retrievalComparisonsService: RetrievalComparisonsService) {}

  @Post('retrieval-comparisons')
  @RequireProjectRole('WRITER', ProjectTargets.body('analysisRun', 'analysisRunId'))
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Body() dto: CreateRetrievalComparisonDto,
    @CurrentUserId() userId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<RetrievalComparisonAcceptedResponse> {
    return this.retrievalComparisonsService.create(dto, idempotencyKey, userId);
  }

  @Get('retrieval-comparisons/:id')
  @RequireProjectRole('READER', ProjectTargets.param('retrievalComparison', 'id'))
  getStatus(@Param('id') id: string): Promise<RetrievalComparisonStatusResponse> {
    return this.retrievalComparisonsService.getStatus(id);
  }

  @Get('retrieval-comparisons/:id/results')
  @RequireProjectRole('READER', ProjectTargets.param('retrievalComparison', 'id'))
  getResults(@Param('id') id: string): Promise<RetrievalComparisonResultsResponse> {
    return this.retrievalComparisonsService.getResults(id);
  }

  @Get('analysis-runs/:analysisRunId/retrieval-comparisons')
  @RequireProjectRole('READER', ProjectTargets.param('analysisRun', 'analysisRunId'))
  list(
    @Param('analysisRunId') analysisRunId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<Page<RetrievalComparisonStatusResponse>> {
    return this.retrievalComparisonsService.listByAnalysisRun(analysisRunId, query, userId);
  }
}
