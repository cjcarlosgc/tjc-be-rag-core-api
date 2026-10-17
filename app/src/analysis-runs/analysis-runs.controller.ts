import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalysisRunsService } from './analysis-runs.service.js';
import { AnalysisSymbolsRepository } from './persistence/analysis-symbols.repository.js';
import { AnalysisRunTraceService } from './analysis-run-trace.service.js';
import type { AnalysisRunTraceResponse } from './dto/analysis-run-trace.response.js';
import { ListAnalysisRunsQueryDto } from './dto/list-analysis-runs-query.dto.js';
import {
  toAnalysisRunDetailResponse,
  toAnalysisRunSummaryResponse,
  type AnalysisRunDetailResponse,
  type AnalysisRunSummaryResponse,
} from './dto/analysis-run.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import type { Page } from '../common/dto/page.response.js';
import { ProjectTargets, RequireProjectRole } from '../project-access/access-policy.js';

@Controller()
export class AnalysisRunsController {
  constructor(
    private readonly analysisRunsService: AnalysisRunsService,
    private readonly analysisSymbolsRepository: AnalysisSymbolsRepository,
    private readonly analysisRunTraceService: AnalysisRunTraceService,
  ) {}

  @Get('projects/:projectId/analysis-runs')
  @RequireProjectRole('READER', ProjectTargets.project('projectId'))
  async list(
    @Param('projectId') projectId: string,
    @Query() query: ListAnalysisRunsQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<Page<AnalysisRunSummaryResponse>> {
    const page = await this.analysisRunsService.listByProject(
      projectId,
      query.status,
      query.limit,
      query.cursor,
      userId,
    );

    return {
      items: page.items.map((run) => toAnalysisRunSummaryResponse(run)),
      nextCursor: page.nextCursor,
    };
  }

  /** HU55: cross-proyecto (Projects visibles del usuario); declarada antes de `analysis-runs/:id`. */
  @Get('analysis-runs')
  @RequireProjectRole('READER', ProjectTargets.listing())
  async listVisible(
    @Query() query: ListAnalysisRunsQueryDto,
    @CurrentUserId() userId: string,
  ): Promise<Page<AnalysisRunSummaryResponse>> {
    const page = await this.analysisRunsService.listVisible(query.status, query.limit, query.cursor, userId);

    return {
      items: page.items.map((run) => toAnalysisRunSummaryResponse(run)),
      nextCursor: page.nextCursor,
    };
  }

  @Get('analysis-runs/:id')
  @RequireProjectRole('READER', ProjectTargets.param('analysisRun', 'id'))
  async getById(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<AnalysisRunDetailResponse> {
    const run = await this.analysisRunsService.getById(id, userId);
    const symbols = await this.analysisSymbolsRepository.findByAnalysisRun(run.id);
    return toAnalysisRunDetailResponse(run, symbols);
  }

  /** WI-CORE-026 (INTEROP-2.7 §6.16): trace operativo; 409 EVIDENCE_NOT_FINISHED en QUEUED y PROCESSING. */
  @Get('analysis-runs/:id/trace')
  @RequireProjectRole('READER', ProjectTargets.param('analysisRun', 'id'))
  async getTrace(
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<AnalysisRunTraceResponse> {
    return this.analysisRunTraceService.getTrace(id, userId);
  }
}
