import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import {
  GithubAppAuthService,
  GithubAppUnavailableError,
} from '../../github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../../github-app/github-repository-content.service.js';
import type { GitHubRepositoryBranchResponse } from '../dto/github-repository-branches.response.js';

export interface GitHubAppInfo {
  displayName: string;
  configureUrl: string;
}

/**
 * HU30: autorización/operación GitHub-App-centric. `installationId` siempre
 * se resuelve aquí server-side (JWT de App); nunca se acepta desde el
 * navegador (`system-contract.md` §Onboarding y repository binding).
 */
@Injectable()
export class GithubRepositoryAccessService {
  constructor(
    private readonly githubAppAuthService: GithubAppAuthService,
    private readonly githubRepositoryContentService: GithubRepositoryContentService,
  ) {}

  /** `slug`/`name` se resuelven contra GitHub (`GET /app`), no por env var. */
  async getAppInfo(): Promise<GitHubAppInfo> {
    const { slug, name } = await this.githubAppAuthService.getAppInfo();

    return {
      displayName: name,
      configureUrl: `https://github.com/apps/${slug}/installations/new`,
    };
  }

  /** `null` es un resultado de producto (`NOT_AUTHORIZED`), no un error. */
  async resolveInstallation(repositoryName: string): Promise<string | null> {
    const [owner, repo] = splitRepositoryName(repositoryName);
    return this.githubAppAuthService.findInstallationForRepository(owner, repo);
  }

  async requireInstallation(repositoryName: string): Promise<string> {
    const installationId = await this.resolveInstallation(repositoryName);

    if (!installationId) {
      throw new AppException(
        ErrorCode.GITHUB_APP_ACCESS_REQUIRED,
        `La GitHub App no tiene acceso a "${repositoryName}".`,
        HttpStatus.FORBIDDEN,
      );
    }

    return installationId;
  }

  /** HU57: `repositoryId` autoritativo según GitHub para `repositoryName`. */
  async resolveRepositoryId(repositoryName: string, installationId: string): Promise<string> {
    const token = await this.githubAppAuthService.getInstallationToken(installationId);

    try {
      return await this.githubRepositoryContentService.getRepositoryId(repositoryName, token);
    } catch (error) {
      if (error instanceof GithubAppUnavailableError && error.status === 404) {
        throw new AppException(
          ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
          `No se encontró el repositorio "${repositoryName}" en GitHub.`,
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }

  async listBranches(
    repositoryName: string,
    installationId: string,
  ): Promise<GitHubRepositoryBranchResponse[]> {
    const token = await this.githubAppAuthService.getInstallationToken(installationId);

    try {
      return await this.githubRepositoryContentService.listBranches(repositoryName, token);
    } catch (error) {
      if (error instanceof GithubAppUnavailableError && error.status === 404) {
        throw new AppException(
          ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
          `No se encontró el repositorio "${repositoryName}" en GitHub.`,
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }
}

function splitRepositoryName(repositoryName: string): [string, string] {
  const [owner, repo] = repositoryName.split('/');
  return [owner, repo];
}
