import { Controller, Get } from '@nestjs/common';
import { CurrentGithubUserId } from '../common/auth/current-github-user-id.decorator.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import type { WorkspaceListResponse } from './dto/workspace.response.js';
import { WorkspacesService } from './workspaces.service.js';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  list(
    @CurrentUserId() userId: string,
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<WorkspaceListResponse> {
    return this.workspacesService.list(userId, githubUserId);
  }
}
