import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import type { Page } from '../common/dto/page.response.js';
import {
  ProjectTargets,
  RequireProjectRole,
} from '../project-access/access-policy.js';
import { ContextTracesService } from '../context-traces/context-traces.service.js';
import { ListDiscoveredFilesQueryDto } from './dto/context-traces-query.dto.js';
import type {
  ContextTraceDetailResponse,
  DiscoveredFileResponse,
} from './dto/context-trace.response.js';

@Controller('context-traces')
export class ContextTracesController {
  constructor(private readonly contextTracesService: ContextTracesService) {}

  @Get(':traceId')
  @RequireProjectRole('READER', ProjectTargets.param('contextTrace', 'traceId'))
  getDetail(
    @Param('traceId', ParseUUIDPipe) traceId: string,
    @CurrentUserId() userId: string,
  ): Promise<ContextTraceDetailResponse> {
    return this.contextTracesService.getContextTraceDetail(traceId, userId);
  }

  @Get(':traceId/discovered-files')
  @RequireProjectRole('READER', ProjectTargets.param('contextTrace', 'traceId'))
  listDiscoveredFiles(
    @Param('traceId', ParseUUIDPipe) traceId: string,
    @CurrentUserId() userId: string,
    @Query() query: ListDiscoveredFilesQueryDto,
  ): Promise<Page<DiscoveredFileResponse>> {
    return this.contextTracesService.listDiscoveredFiles(
      traceId,
      userId,
      query,
    );
  }
}
