import { Injectable, Logger } from '@nestjs/common';
import { GithubAppAuthService, GithubAppUnavailableError } from './github-app-auth.service.js';
import type {
  GithubAccessPort,
  GithubLookup,
  RepositoryOwner,
  RepositoryPermissionLevel,
  RepositoryRef,
} from './github-access.port.js';

const GITHUB_API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 10_000;
const KNOWN_ROLES: readonly RepositoryPermissionLevel[] = ['admin', 'maintain', 'write', 'triage', 'read'];

interface GithubApiRepository {
  id: number;
  full_name: string;
  owner: { id: number; login: string; type: string };
}

interface GithubApiCollaboratorPermission {
  permission?: string;
  role_name?: string;
}

type HttpOutcome<T> = { kind: 'OK'; body: T } | { kind: 'NOT_FOUND' } | { kind: 'UNVERIFIABLE' };

/**
 * Adapter productivo de `GithubAccessPort`: solo installation token de la App
 * (`Metadata: read`), nunca el token OAuth del usuario. El login se resuelve por
 * `GET /user/{id}` en cada verificación, sin caché: un login renombrado o
 * reasignado a otra persona nunca hereda el permiso del usuario original.
 */
@Injectable()
export class GithubAccessHttpAdapter implements GithubAccessPort {
  private readonly logger = new Logger(GithubAccessHttpAdapter.name);

  constructor(private readonly githubAppAuthService: GithubAppAuthService) {}

  async getRepositoryOwner(repository: RepositoryRef): Promise<GithubLookup<RepositoryOwner>> {
    const token = await this.installationToken(repository.installationId);
    if (typeof token !== 'string') {
      return token;
    }

    const outcome = await this.get<GithubApiRepository>(`/repos/${repository.repositoryName}`, token);

    if (outcome.kind !== 'OK') {
      return { status: outcome.kind };
    }

    const { id, owner } = outcome.body;
    return {
      status: 'OK',
      value: {
        repositoryId: String(id),
        ownerId: String(owner.id),
        ownerLogin: owner.login,
        ownerType: owner.type === 'Organization' ? 'Organization' : 'User',
      },
    };
  }

  async getRepositoryPermission(
    repository: RepositoryRef,
    githubUserId: string,
  ): Promise<GithubLookup<RepositoryPermissionLevel>> {
    const token = await this.installationToken(repository.installationId);
    if (typeof token !== 'string') {
      return token;
    }

    const login = await this.resolveLogin(githubUserId, token);

    if (login === 'UNVERIFIABLE' || login === 'NOT_FOUND') {
      return { status: login };
    }

    const outcome = await this.readPermission(repository, login, token);

    if (outcome.kind !== 'OK') {
      return { status: outcome.kind };
    }

    const level = toPermissionLevel(outcome.body);
    return level ? { status: 'OK', value: level } : { status: 'NOT_FOUND' };
  }

  private readPermission(
    repository: RepositoryRef,
    login: string,
    token: string,
  ): Promise<HttpOutcome<GithubApiCollaboratorPermission>> {
    return this.get<GithubApiCollaboratorPermission>(
      `/repos/${repository.repositoryName}/collaborators/${encodeURIComponent(login)}/permission`,
      token,
    );
  }

  /** `GET /user/{id}`: el login sale del id inmutable, no del `githubLogin` persistido. */
  private async resolveLogin(githubUserId: string, token: string): Promise<string | 'NOT_FOUND' | 'UNVERIFIABLE'> {
    const outcome = await this.get<{ login?: string }>(`/user/${encodeURIComponent(githubUserId)}`, token);

    if (outcome.kind !== 'OK') {
      return outcome.kind;
    }

    if (!outcome.body.login) {
      return 'UNVERIFIABLE';
    }

    return outcome.body.login;
  }

  /** Installation token; un fallo se traduce a `NOT_INSTALLED` (404) o `UNVERIFIABLE`. */
  private async installationToken(
    installationId: string,
  ): Promise<string | { status: 'NOT_INSTALLED' } | { status: 'UNVERIFIABLE' }> {
    try {
      return await this.githubAppAuthService.getInstallationToken(installationId);
    } catch (error) {
      if (error instanceof GithubAppUnavailableError && error.status === 404) {
        return { status: 'NOT_INSTALLED' };
      }
      this.logger.warn(`No se pudo autenticar la instalación "${installationId}" para verificar accesos.`);
      return { status: 'UNVERIFIABLE' };
    }
  }

  private async get<T>(path: string, token: string): Promise<HttpOutcome<T>> {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      this.logger.warn(`GitHub no respondió a GET ${path}.`);
      return { kind: 'UNVERIFIABLE' };
    }

    if (response.status === 404) {
      return { kind: 'NOT_FOUND' };
    }

    if (!response.ok) {
      // 401/403 (instalación suspendida, límite de tasa), 429 y 5xx.
      this.logger.warn(`GitHub respondió ${response.status} a GET ${path}.`);
      return { kind: 'UNVERIFIABLE' };
    }

    try {
      return { kind: 'OK', body: (await response.json()) as T };
    } catch {
      return { kind: 'UNVERIFIABLE' };
    }
  }
}

/**
 * `role_name` (admin, maintain, write, triage, read o un rol personalizado). El
 * campo `permission` colapsa maintain a write y triage a read, así que solo se
 * usa para mapear un rol personalizado por su permiso base. `none` = sin acceso.
 */
export function toPermissionLevel(body: GithubApiCollaboratorPermission): RepositoryPermissionLevel | null {
  const role = body.role_name as RepositoryPermissionLevel | undefined;

  if (role && KNOWN_ROLES.includes(role)) {
    return role;
  }

  if (body.permission === 'admin' || body.permission === 'write' || body.permission === 'read') {
    return body.permission;
  }

  return null;
}
