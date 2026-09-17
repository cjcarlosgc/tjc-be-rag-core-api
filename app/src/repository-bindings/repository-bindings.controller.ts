import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { RepositoryBindingsService } from './repository-bindings.service.js';
import { GithubUserRepositoriesService } from './github/github-user-repositories.service.js';
import { GithubRepositoryAccessService } from './github/github-repository-access.service.js';
import { ListGithubRepositoriesQueryDto } from './dto/list-github-repositories-query.dto.js';
import { VerifyGitHubAppAccessRequestDto } from './dto/github-app-access.dto.js';
import type { GitHubAppAccessResponse } from './dto/github-app-access.dto.js';
import { CreateRepositoryBindingRequestDto } from './dto/create-repository-binding.dto.js';
import type { GitHubUserRepositoryResponse } from './dto/github-user-repository.response.js';
import type { GitHubRepositoryBranchesResponse } from './dto/github-repository-branches.response.js';
import {
  toProjectRepositoryBindingResponse,
  type ProjectRepositoryBindingResponse,
} from './dto/repository-binding.response.js';
import { CurrentUserId } from '../common/auth/current-user-id.decorator.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Page } from '../common/dto/page.response.js';

const DEFAULT_PAGE_SIZE = 30;

@Controller()
export class RepositoryBindingsController {
  constructor(
    private readonly repositoryBindingsService: RepositoryBindingsService,
    private readonly githubUserRepositoriesService: GithubUserRepositoriesService,
    private readonly githubRepositoryAccessService: GithubRepositoryAccessService,
  ) {}

  @Get('integrations/github/repositories')
  async listRepositories(
    @Query() query: ListGithubRepositoriesQueryDto,
    @Headers('x-github-provider-token') providerToken: string | undefined,
  ): Promise<Page<GitHubUserRepositoryResponse>> {
    if (!providerToken) {
      throw new AppException(
        ErrorCode.GITHUB_ACCOUNT_REQUIRED,
        'Falta el header X-GitHub-Provider-Token.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const page = parseCursor(query.cursor);
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const result = await this.githubUserRepositoriesService.list(providerToken, page, limit);

    return {
      items: result.items,
      nextCursor: result.hasNextPage ? String(page + 1) : null,
    };
  }

  @Post('integrations/github/repositories/verify-app-access')
  async verifyAppAccess(
    @Body() body: VerifyGitHubAppAccessRequestDto,
  ): Promise<GitHubAppAccessResponse> {
    const [installationId, app] = await Promise.all([
      this.githubRepositoryAccessService.resolveInstallation(body.repositoryName),
      this.githubRepositoryAccessService.getAppInfo(),
    ]);

    return {
      repositoryId: body.repositoryId,
      repositoryName: body.repositoryName,
      status: installationId ? 'AUTHORIZED' : 'NOT_AUTHORIZED',
      installationId,
      app,
    };
  }

  @Get('integrations/github/repositories/:owner/:repo/branches')
  async listBranches(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ): Promise<GitHubRepositoryBranchesResponse> {
    const repositoryName = `${owner}/${repo}`;
    const installationId = await this.githubRepositoryAccessService.requireInstallation(
      repositoryName,
    );
    const items = await this.githubRepositoryAccessService.listBranches(
      repositoryName,
      installationId,
    );

    return { items };
  }

  @Post('projects/:projectId/integrations/github')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('projectId') projectId: string,
    @Body() body: CreateRepositoryBindingRequestDto,
    @CurrentUserId() userId: string,
  ): Promise<ProjectRepositoryBindingResponse> {
    const binding = await this.repositoryBindingsService.create(projectId, body, userId);
    return toProjectRepositoryBindingResponse(binding);
  }

  @Get('projects/:projectId/integrations/github')
  async get(
    @Param('projectId') projectId: string,
    @CurrentUserId() userId: string,
  ): Promise<ProjectRepositoryBindingResponse> {
    const binding = await this.repositoryBindingsService.get(projectId, userId);
    return toProjectRepositoryBindingResponse(binding);
  }

  @Delete('projects/:projectId/integrations/github')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('projectId') projectId: string, @CurrentUserId() userId: string): Promise<void> {
    await this.repositoryBindingsService.disable(projectId, userId);
  }
}

function parseCursor(cursor: string | undefined): number {
  const page = cursor ? Number(cursor) : 1;
  return Number.isInteger(page) && page > 0 ? page : 1;
}
