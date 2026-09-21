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
import {
  GithubRepositoryAccessService,
  isSufficientRepositoryPermission,
} from './github/github-repository-access.service.js';
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
import { CurrentGithubUserId } from '../common/auth/current-github-user-id.decorator.js';
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
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<Page<GitHubUserRepositoryResponse>> {
    if (!providerToken) {
      throw new AppException(
        ErrorCode.GITHUB_ACCOUNT_REQUIRED,
        'Falta el header X-GitHub-Provider-Token.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // HU64 (bundle A): el único workspace es el personal, cuyo id es el githubUserId
    // de la sesión; el de una organización responde 404 hasta el corte 3.
    if (query.workspaceId !== undefined && query.workspaceId !== githubUserId) {
      throw new AppException(
        ErrorCode.WORKSPACE_NOT_FOUND,
        `No existe un workspace con id "${query.workspaceId}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    const page = parseCursor(query.cursor);
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const result = await this.githubUserRepositoriesService.list(
      providerToken,
      page,
      limit,
      query.workspaceId === undefined ? undefined : { personalOwnerId: githubUserId },
    );

    return {
      items: result.items,
      nextCursor: result.hasNextPage ? String(page + 1) : null,
    };
  }

  /**
   * HU64: solo con permiso `maintain`/`write`/`admin` del usuario sobre el
   * repositorio. App no instalada o sin visibilidad del usuario: `NOT_AUTHORIZED`
   * (no revela la instalación); permiso menor: `403`; no verificable: `503`.
   */
  @Post('integrations/github/repositories/verify-app-access')
  @HttpCode(HttpStatus.OK)
  async verifyAppAccess(
    @Body() body: VerifyGitHubAppAccessRequestDto,
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<GitHubAppAccessResponse> {
    const installationId = await this.githubRepositoryAccessService.resolveInstallation(
      body.repositoryName,
    );
    let authorizedInstallationId: string | null = null;

    if (installationId) {
      const permission = await this.githubRepositoryAccessService.getUserPermission(
        body.repositoryName,
        installationId,
        githubUserId,
      );

      if (permission !== 'NONE' && permission !== 'APP_NOT_INSTALLED') {
        if (!isSufficientRepositoryPermission(permission)) {
          throw this.githubRepositoryAccessService.permissionInsufficient();
        }
        authorizedInstallationId = installationId;
      }
    }

    return {
      repositoryId: body.repositoryId,
      repositoryName: body.repositoryName,
      status: authorizedInstallationId ? 'AUTHORIZED' : 'NOT_AUTHORIZED',
      installationId: authorizedInstallationId,
      app: await this.githubRepositoryAccessService.getAppInfo(),
    };
  }

  /**
   * HU64, en este orden: App no instalada `403 GITHUB_APP_ACCESS_REQUIRED`, sin
   * visibilidad `404 GITHUB_REPOSITORY_NOT_FOUND`, permiso menor `403
   * REPOSITORY_PERMISSION_INSUFFICIENT`, no verificable `503`.
   */
  @Get('integrations/github/repositories/:owner/:repo/branches')
  async listBranches(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<GitHubRepositoryBranchesResponse> {
    const repositoryName = `${owner}/${repo}`;
    const installationId = await this.githubRepositoryAccessService.requireInstallation(
      repositoryName,
    );
    await this.githubRepositoryAccessService.requireSufficientUserPermission(
      repositoryName,
      installationId,
      githubUserId,
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
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<ProjectRepositoryBindingResponse> {
    const binding = await this.repositoryBindingsService.create(projectId, body, userId, githubUserId);
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

  @Post('projects/:projectId/integrations/github/enable')
  @HttpCode(HttpStatus.OK)
  async enable(
    @Param('projectId') projectId: string,
    @CurrentUserId() userId: string,
    @CurrentGithubUserId() githubUserId: string,
  ): Promise<ProjectRepositoryBindingResponse> {
    const binding = await this.repositoryBindingsService.enable(projectId, userId, githubUserId);
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
