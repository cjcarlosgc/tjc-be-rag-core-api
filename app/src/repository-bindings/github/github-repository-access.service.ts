import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import {
  GithubAppAuthService,
  GithubAppUnavailableError,
} from '../../github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../../github-app/github-repository-content.service.js';
import {
  GITHUB_ACCESS_PORT,
  type GithubAccessPort,
  type RepositoryOwner,
  type RepositoryPermissionLevel,
} from '../../github-app/github-access.port.js';
import type { GitHubRepositoryBranchResponse } from '../dto/github-repository-branches.response.js';

export interface GitHubAppInfo {
  displayName: string;
  configureUrl: string;
}

/** Permiso mínimo de repositorio para vincular o consultar (la App publica con permisos de escritura). */
const SUFFICIENT_PERMISSIONS: readonly RepositoryPermissionLevel[] = ['maintain', 'write', 'admin'];

export function isSufficientRepositoryPermission(level: RepositoryPermissionLevel): boolean {
  return SUFFICIENT_PERMISSIONS.includes(level);
}

/** `NONE`: GitHub confirma que el usuario no tiene ningún permiso; `APP_NOT_INSTALLED`: la App perdió la instalación. */
export type UserRepositoryPermission = RepositoryPermissionLevel | 'NONE' | 'APP_NOT_INSTALLED';

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
    @Inject(GITHUB_ACCESS_PORT) private readonly githubAccessPort: GithubAccessPort,
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

    try {
      return await this.githubAppAuthService.findInstallationForRepository(owner, repo);
    } catch (error) {
      if (error instanceof GithubAppUnavailableError) {
        throw this.verificationUnavailable();
      }
      throw error;
    }
  }

  async requireInstallation(repositoryName: string): Promise<string> {
    const installationId = await this.resolveInstallation(repositoryName);

    if (!installationId) {
      throw this.appAccessRequired(repositoryName);
    }

    return installationId;
  }

  /**
   * HU64: propietario y `repositoryId` reales del repositorio según GitHub
   * (leídos con el installation token; el `repositoryId` del cliente no es
   * autoridad). `404 GITHUB_REPOSITORY_NOT_FOUND` si no existe o la instalación
   * no lo ve; `503` si no es verificable.
   */
  async requireRepositoryOwner(repositoryName: string, installationId: string): Promise<RepositoryOwner> {
    const result = await this.githubAccessPort.getRepositoryOwner({ installationId, repositoryName });

    switch (result.status) {
      case 'OK':
        return result.value;
      case 'NOT_FOUND':
        throw new AppException(
          ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
          `No se encontró el repositorio "${repositoryName}" en GitHub.`,
          HttpStatus.NOT_FOUND,
        );
      case 'NOT_INSTALLED':
        throw this.appAccessRequired(repositoryName);
      case 'UNVERIFIABLE':
        throw this.verificationUnavailable();
    }
  }

  /** HU64: permiso efectivo del usuario sobre el repositorio; `503` si GitHub no permite verificarlo. */
  async getUserPermission(
    repositoryName: string,
    installationId: string,
    githubUserId: string,
  ): Promise<UserRepositoryPermission> {
    const result = await this.githubAccessPort.getRepositoryPermission(
      { installationId, repositoryName },
      githubUserId,
    );

    switch (result.status) {
      case 'OK':
        return result.value;
      case 'NOT_FOUND':
        return 'NONE';
      case 'NOT_INSTALLED':
        return 'APP_NOT_INSTALLED';
      case 'UNVERIFIABLE':
        throw this.verificationUnavailable();
    }
  }

  /**
   * HU64: exige permiso `maintain`/`write`/`admin` sobre el repositorio (`branches`).
   * Sin ningún permiso: `404 GITHUB_REPOSITORY_NOT_FOUND`; menor: `403
   * REPOSITORY_PERMISSION_INSUFFICIENT`; no verificable: `503`.
   */
  async requireSufficientUserPermission(
    repositoryName: string,
    installationId: string,
    githubUserId: string,
  ): Promise<void> {
    const permission = await this.getUserPermission(repositoryName, installationId, githubUserId);

    if (permission === 'APP_NOT_INSTALLED') {
      throw this.appAccessRequired(repositoryName);
    }

    if (permission === 'NONE') {
      throw this.repositoryNotFound(repositoryName);
    }

    if (!isSufficientRepositoryPermission(permission)) {
      throw this.permissionInsufficient();
    }
  }

  repositoryNotFound(repositoryName: string): AppException {
    return new AppException(
      ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
      `No se encontró el repositorio "${repositoryName}" en GitHub.`,
      HttpStatus.NOT_FOUND,
    );
  }

  permissionInsufficient(): AppException {
    return new AppException(
      ErrorCode.REPOSITORY_PERMISSION_INSUFFICIENT,
      'Se requiere permiso maintain, write o admin sobre el repositorio.',
      HttpStatus.FORBIDDEN,
    );
  }

  outsideWorkspace(): AppException {
    return new AppException(
      ErrorCode.REPOSITORY_OUTSIDE_WORKSPACE,
      'El repositorio no pertenece al workspace del proyecto.',
      HttpStatus.BAD_REQUEST,
    );
  }

  verificationUnavailable(): AppException {
    return new AppException(
      ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
      'GitHub no permite verificar el acceso en este momento; reintenta.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  appAccessRequired(repositoryName: string): AppException {
    return new AppException(
      ErrorCode.GITHUB_APP_ACCESS_REQUIRED,
      `La GitHub App no tiene acceso a "${repositoryName}".`,
      HttpStatus.FORBIDDEN,
    );
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
