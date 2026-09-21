import { Controller, Get } from '@nestjs/common';
import { CurrentGithubUserId } from '../common/auth/current-github-user-id.decorator.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import type { WorkspaceListResponse } from './dto/workspace.response.js';
import { WorkspacesService } from './workspaces.service.js';
import { NoProjectRole } from '../project-access/access-policy.js';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  @NoProjectRole('Lista los workspaces del propio usuario autenticado (solo sesión GitHub válida); no hay Project.')
  list(
    @CurrentUserId() userId: string,
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<WorkspaceListResponse> {
    return this.workspacesService.list(userId, githubUserId);
  }
}
