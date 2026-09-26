import { Injectable } from '@nestjs/common';
import {
  GithubIntegrationClient,
  GithubIntegrationClientError,
} from './github-integration.client.js';

export class GithubAppUnavailableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = GithubAppUnavailableError.name;
  }
}

export interface GithubAppInfo {
  slug: string;
  name: string;
}

interface GithubAppInfoResponse {
  slug: string;
  displayName: string;
}

interface GithubInstallationResponse {
  installationId: string | null;
}

/**
 * Gateway de Core para operaciones de identidad de GitHub App. La firma de
 * JWT y los installation tokens pertenecen a GitHub Integration; Core solo
 * conserva la fachada usada por sus consumidores y nunca recibe credenciales
 * privadas de la App.
 */
@Injectable()
export class GithubAppAuthService {
  private appInfoCache: GithubAppInfo | null = null;

  constructor(
    private readonly githubIntegrationClient: GithubIntegrationClient,
  ) {}

  /**
   * Resuelve server-side si existe una instalación con acceso a `owner/repo`.
   * GitHub Integration expresa la ausencia confirmada como `installationId:
   * null`, que Core conserva como el resultado de producto NOT_AUTHORIZED.
   */
  async findInstallationForRepository(
    owner: string,
    repo: string,
  ): Promise<string | null> {
    try {
      const result =
        await this.githubIntegrationClient.post<GithubInstallationResponse>(
          '/repositories/installation',
          { repositoryName: `${owner}/${repo}` },
        );
      return result.installationId;
    } catch (error) {
      throw unavailableError(
        error,
        'GitHub App no pudo resolver la instalación del repositorio.',
      );
    }
  }

  /** Resuelve y cachea el nombre y slug públicos de la GitHub App. */
  async getAppInfo(): Promise<GithubAppInfo> {
    if (this.appInfoCache) return this.appInfoCache;

    try {
      const result =
        await this.githubIntegrationClient.get<GithubAppInfoResponse>('/app');
      this.appInfoCache = { slug: result.slug, name: result.displayName };
      return this.appInfoCache;
    } catch (error) {
      throw unavailableError(
        error,
        'GitHub App no pudo resolver su propia información.',
      );
    }
  }
}

function unavailableError(
  error: unknown,
  message: string,
): GithubAppUnavailableError {
  const status =
    error instanceof GithubIntegrationClientError ? error.status : undefined;
  return new GithubAppUnavailableError(message, status);
}
