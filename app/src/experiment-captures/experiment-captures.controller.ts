import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import type { Page } from '../common/dto/page.response.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { ProjectTargets, RequireProjectRole } from '../project-access/access-policy.js';
import type { ExperimentCaptureResponse } from './dto/experiment-capture.response.js';
import { ExperimentCapturesService } from './experiment-captures.service.js';

/**
 * Captura armada de experimentación (HU18, INTEROP-2.25 §6.17, WI-CORE-109). Armar y desarmar exigen Maintainer
 * (D2); listar, Reader. El guard default-deny resuelve el Project (404 si no es visible, 403 si el rol es menor).
 */
@Controller()
export class ExperimentCapturesController {
  constructor(private readonly experimentCapturesService: ExperimentCapturesService) {}

  @Post('projects/:projectId/experiment-captures')
  @RequireProjectRole('MAINTAINER', ProjectTargets.project('projectId'))
  @HttpCode(HttpStatus.CREATED)
  arm(@Param('projectId') projectId: string, @CurrentUserId() userId: string): Promise<ExperimentCaptureResponse> {
    return this.experimentCapturesService.arm(projectId, userId);
  }

  @Get('projects/:projectId/experiment-captures')
  @RequireProjectRole('READER', ProjectTargets.project('projectId'))
  list(
    @Param('projectId') projectId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Page<ExperimentCaptureResponse>> {
    return this.experimentCapturesService.list(projectId, query);
  }

  @Delete('projects/:projectId/experiment-captures/current')
  @RequireProjectRole('MAINTAINER', ProjectTargets.project('projectId'))
  disarm(@Param('projectId') projectId: string, @CurrentUserId() userId: string): Promise<ExperimentCaptureResponse> {
    return this.experimentCapturesService.disarmCurrent(projectId, userId);
  }
}
