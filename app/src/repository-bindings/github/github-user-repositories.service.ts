import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { GithubAppUnavailableError } from '../../github-app/github-app-auth.service.js';
import type { GitHubUserRepositoryResponse } from '../dto/github-user-repository.response.js';

const GITHUB_API_VERSION = '2022-11-28';

interface GithubApiUserRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { id: number; login: string; type: string; avatar_url: string | null };
  private: boolean;
  default_branch: string;
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; pull?: boolean };
}

export interface ListGithubUserRepositoriesOptions {
  /**
   * HU64: con el workspace personal, solo repositorios cuyo propietario es esta
   * cuenta (`githubUserId`). Se pide `affiliation=owner` y se vuelve a filtrar
   * por id de propietario: el filtrado no depende de un login.
   */
  personalOwnerId?: string;
}

export interface ListGithubUserRepositoriesResult {
  items: GitHubUserRepositoryResponse[];
  hasNextPage: boolean;
}

/**
 * HU30: discovery user-centric. `providerToken` es el provider token OAuth
 * GitHub de la sesión Supabase (`X-GitHub-Provider-Token`), nunca persistido
 * ni reenviado; solo autoriza listar los repos visibles para el usuario, no
 * automatización.
 */
@Injectable()
export class GithubUserRepositoriesService {
  async list(
    providerToken: string,
    page: number,
    perPage: number,
    options: ListGithubUserRepositoriesOptions = {},
  ): Promise<ListGithubUserRepositoriesResult> {
    const affiliation = options.personalOwnerId ? '&affiliation=owner' : '';
    const response = await fetch(
      `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=updated${affiliation}`,
      {
        headers: {
          Authorization: `Bearer ${providerToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new AppException(
        ErrorCode.GITHUB_USER_TOKEN_INVALID,
        'El provider token de GitHub es inválido o expiró.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new GithubAppUnavailableError(
        `GitHub API ${response.status} en /user/repos: ${body}`,
        response.status,
      );
    }

    const data = (await response.json()) as GithubApiUserRepository[];

    const visible = options.personalOwnerId
      ? data.filter((repo) => String(repo.owner.id) === options.personalOwnerId)
      : data;

    return {
      items: visible.map(toGitHubUserRepositoryResponse),
      hasNextPage: data.length === perPage,
    };
  }
}

function toGitHubUserRepositoryResponse(repo: GithubApiUserRepository): GitHubUserRepositoryResponse {
  return {
    repositoryId: String(repo.id),
    name: repo.name,
    repositoryName: repo.full_name,
    owner: {
      login: repo.owner.login,
      type: repo.owner.type === 'Organization' ? 'Organization' : 'User',
      avatarUrl: repo.owner.avatar_url ?? null,
    },
    private: repo.private,
    defaultBranch: repo.default_branch,
    permissions: {
      admin: repo.permissions?.admin ?? false,
      maintain: repo.permissions?.maintain ?? false,
      push: repo.permissions?.push ?? false,
      pull: repo.permissions?.pull ?? false,
    },
  };
}
