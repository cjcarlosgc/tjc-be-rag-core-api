import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import {
  GithubIntegrationClient,
  GithubIntegrationClientError,
} from '../../github-app/github-integration.client.js';
import type { GitHubUserRepositoryResponse } from '../dto/github-user-repository.response.js';

interface GitHubIntegrationRepository {
  repositoryId: string;
  name: string;
  repositoryName: string;
  owner: { login: string; type: string; avatarUrl: string | null };
  private: boolean;
  defaultBranch: string;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    pull?: boolean;
  };
}

interface GithubRepositoryDiscoveryResponse {
  items: GitHubIntegrationRepository[];
  hasNextPage: boolean;
}

export interface ListGithubUserRepositoriesOptions {
  /**
   * HU64: con el workspace personal, solo repositorios cuyo propietario es esta
   * cuenta (`githubUserId`). GitHub Integration solicita la relación adecuada
   * y aplica el filtro final por id de propietario, nunca por login.
   */
  personalOwnerId?: string;
  /**
   * HU64: con un workspace de organización, solo repositorios cuyo propietario
   * es esa organización. GitHub Integration filtra por el id recibido; el
   * llamador ya verificó la pertenencia del usuario.
   */
  organizationOwnerId?: string;
}

export interface ListGithubUserRepositoriesResult {
  items: GitHubUserRepositoryResponse[];
  hasNextPage: boolean;
}

/**
 * Discovery user-centric. El provider token OAuth de GitHub se reenvía solo
 * como header efímero al servicio GitHub Integration; el bearer de Core→GH lo
 * agrega el cliente interno. El token de usuario nunca se persiste ni registra.
 */
@Injectable()
export class GithubUserRepositoriesService {
  constructor(
    private readonly githubIntegrationClient: GithubIntegrationClient,
  ) {}

  async list(
    providerToken: string,
    page: number,
    perPage: number,
    options: ListGithubUserRepositoriesOptions = {},
  ): Promise<ListGithubUserRepositoriesResult> {
    const request = {
      page,
      perPage,
      ...(options.personalOwnerId
        ? { personalOwnerId: options.personalOwnerId }
        : {}),
      ...(options.organizationOwnerId
        ? { organizationOwnerId: options.organizationOwnerId }
        : {}),
    };

    let rawResponse: unknown;
    try {
      rawResponse =
        await this.githubIntegrationClient.post<unknown>(
          '/repositories/discovery',
          request,
          { headers: { 'X-GitHub-Provider-Token': providerToken } },
        );
    } catch (error) {
      if (
        error instanceof GithubIntegrationClientError &&
        error.code === 'GITHUB_USER_TOKEN_INVALID'
      ) {
        throw new AppException(
          ErrorCode.GITHUB_USER_TOKEN_INVALID,
          'El provider token de GitHub es inválido o expiró.',
          HttpStatus.UNAUTHORIZED,
        );
      }

      throw new AppException(
        ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        'GitHub no pudo completar la búsqueda de repositorios. Reintenta más tarde.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!isGithubRepositoryDiscoveryResponse(rawResponse)) {
      throw new AppException(
        ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        'GitHub Integration devolvió una respuesta de búsqueda inválida. Reintenta más tarde.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const response = rawResponse;

    return {
      items: response.items.map(toGitHubUserRepositoryResponse),
      // GitHub Integration filtra por id de propietario y calcula la marca
      // de página sobre la respuesta ya normalizada.
      hasNextPage: response.hasNextPage,
    };
  }
}

function toGitHubUserRepositoryResponse(
  repo: GitHubIntegrationRepository,
): GitHubUserRepositoryResponse {
  return {
    repositoryId: repo.repositoryId,
    name: repo.name,
    repositoryName: repo.repositoryName,
    owner: {
      login: repo.owner.login,
      type: repo.owner.type === 'Organization' ? 'Organization' : 'User',
      avatarUrl: repo.owner.avatarUrl,
    },
    private: repo.private,
    defaultBranch: repo.defaultBranch,
    permissions: {
      admin: repo.permissions?.admin ?? false,
      maintain: repo.permissions?.maintain ?? false,
      push: repo.permissions?.push ?? false,
      pull: repo.permissions?.pull ?? false,
    },
  };
}

function isGithubRepositoryDiscoveryResponse(
  value: unknown,
): value is GithubRepositoryDiscoveryResponse {
  return (
    isRecord(value) &&
    typeof value.hasNextPage === 'boolean' &&
    Array.isArray(value.items) &&
    value.items.every(
      (repo) =>
        isRecord(repo) &&
        isNonEmptyString(repo.repositoryId) &&
        isNonEmptyString(repo.name) &&
        isNonEmptyString(repo.repositoryName) &&
        isRecord(repo.owner) &&
        isNonEmptyString(repo.owner.login) &&
        (repo.owner.type === 'Organization' || repo.owner.type === 'User') &&
        (repo.owner.avatarUrl === null || typeof repo.owner.avatarUrl === 'string') &&
        typeof repo.private === 'boolean' &&
        isNonEmptyString(repo.defaultBranch) &&
        (repo.permissions === undefined || isRepositoryPermissions(repo.permissions)),
    )
  );
}

function isRepositoryPermissions(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['admin', 'maintain', 'push', 'pull'].every(
      (key) => value[key] === undefined || typeof value[key] === 'boolean',
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
