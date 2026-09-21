import { Injectable, Logger } from '@nestjs/common';
import { GithubAppAuthService, GithubAppUnavailableError } from './github-app-auth.service.js';
import type {
  GithubAccessPort,
  GithubLookup,
  OrganizationInstallation,
  OrganizationMembership,
  OrganizationOwner,
  OrganizationRef,
  RepositoryDetails,
  RepositoryOwner,
  RepositoryPermissionLevel,
  RepositoryRef,
} from './github-access.port.js';

const GITHUB_API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
/** Tope de páginas por listado: a escala de tesis basta; más allá se registra y se devuelve lo leído. */
const MAX_PAGES = 10;
const KNOWN_ROLES: readonly RepositoryPermissionLevel[] = ['admin', 'maintain', 'write', 'triage', 'read'];

interface GithubApiRepository {
  id: number;
  full_name: string;
  owner: { id: number; login: string; type: string };
}

interface GithubApiInstallation {
  id: number;
  account?: { id: number; login: string; type: string; avatar_url?: string | null } | null;
  suspended_at?: string | null;
}

interface GithubApiMembership {
  state?: string;
  role?: string;
}

interface GithubApiCollaboratorPermission {
  permission?: string;
  role_name?: string;
}

type HttpOutcome<T> = { kind: 'OK'; body: T } | { kind: 'NOT_FOUND' } | { kind: 'UNVERIFIABLE' };

/**
 * Adapter productivo de `GithubAccessPort`: solo la identidad de la App (JWT de
 * App para listar instalaciones, installation token para el resto; `Metadata:
 * read` y `Members: read`), nunca el token OAuth del usuario. El login se resuelve por
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

  async getRepositoryById(installationId: string, repositoryId: string): Promise<GithubLookup<RepositoryDetails>> {
    const token = await this.installationToken(installationId);
    if (typeof token !== 'string') {
      return token;
    }

    const outcome = await this.get<GithubApiRepository>(`/repositories/${encodeURIComponent(repositoryId)}`, token);

    if (outcome.kind !== 'OK') {
      return { status: outcome.kind };
    }

    const { id, full_name: fullName, owner } = outcome.body;

    // Un cuerpo sin los campos que se comparan no es una verificación: nunca revoca por él.
    if (typeof id !== 'number' || typeof fullName !== 'string' || !owner || typeof owner.id !== 'number') {
      return { status: 'UNVERIFIABLE' };
    }

    return {
      status: 'OK',
      value: {
        repositoryId: String(id),
        repositoryName: fullName,
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

  async listOrganizationInstallations(): Promise<GithubLookup<OrganizationInstallation[]>> {
    let appJwt: string;
    try {
      appJwt = await this.githubAppAuthService.signAppJwt();
    } catch {
      this.logger.warn('No se pudo firmar el JWT de la App para listar sus instalaciones.');
      return { status: 'UNVERIFIABLE' };
    }

    const outcome = await this.getAllPages<GithubApiInstallation>('/app/installations', appJwt);

    if (outcome.kind !== 'OK') {
      // 404 en este endpoint no significa "sin instalaciones": no es un resultado esperado.
      return { status: 'UNVERIFIABLE' };
    }

    const installations: OrganizationInstallation[] = [];

    for (const installation of outcome.body) {
      const account = installation.account;

      if (account?.type === 'Organization') {
        installations.push({
          installationId: String(installation.id),
          organizationId: String(account.id),
          organizationLogin: account.login,
          avatarUrl: account.avatar_url ?? null,
          suspended: Boolean(installation.suspended_at),
        });
      }
    }

    return { status: 'OK', value: installations };
  }

  async getOrganizationMembership(
    organization: OrganizationRef,
    githubUserId: string,
  ): Promise<GithubLookup<OrganizationMembership>> {
    const token = await this.installationToken(organization.installationId);
    if (typeof token !== 'string') {
      return token;
    }

    const login = await this.resolveLogin(githubUserId, token);

    if (login === 'UNVERIFIABLE' || login === 'NOT_FOUND') {
      return { status: login };
    }

    const outcome = await this.get<GithubApiMembership>(
      `/orgs/${encodeURIComponent(organization.organizationLogin)}/memberships/${encodeURIComponent(login)}`,
      token,
    );

    if (outcome.kind !== 'OK') {
      return { status: outcome.kind };
    }

    // Un cuerpo sin `state` reconocible no es una membresía activa verificada.
    return {
      status: 'OK',
      value: {
        role: outcome.body.role === 'admin' ? 'admin' : 'member',
        state: outcome.body.state === 'active' ? 'active' : 'pending',
      },
    };
  }

  async listOrganizationOwners(organization: OrganizationRef): Promise<GithubLookup<OrganizationOwner[]>> {
    const token = await this.installationToken(organization.installationId);
    if (typeof token !== 'string') {
      return token;
    }

    const outcome = await this.getAllPages<{ id: number; login: string }>(
      `/orgs/${encodeURIComponent(organization.organizationLogin)}/members?role=admin`,
      token,
    );

    if (outcome.kind !== 'OK') {
      return { status: outcome.kind };
    }

    // Una organización de GitHub no puede tener cero owners: un 200 con lista vacía es un artefacto de
    // visibilidad (p. ej. `Members: read` ausente o un límite de la lectura), no una ausencia confirmada.
    if (outcome.body.length === 0) {
      this.logger.warn(`La lista de owners de "${organization.organizationLogin}" llegó vacía con 200: no verificable.`);
      return { status: 'UNVERIFIABLE' };
    }

    return {
      status: 'OK',
      value: outcome.body.map((member) => ({ githubUserId: String(member.id), login: member.login })),
    };
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

  /**
   * Lista paginada (`per_page`/`page`); el primer fallo de una página aborta todo el listado y un
   * listado que alcanza el tope de páginas es `UNVERIFIABLE` (no se devuelve un OK truncado).
   */
  private async getAllPages<T>(path: string, token: string): Promise<HttpOutcome<T[]>> {
    const separator = path.includes('?') ? '&' : '?';
    const items: T[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const outcome = await this.get<T[]>(`${path}${separator}per_page=${PAGE_SIZE}&page=${page}`, token);

      if (outcome.kind !== 'OK') {
        return outcome;
      }

      const batch = Array.isArray(outcome.body) ? outcome.body : [];
      items.push(...batch);

      if (batch.length < PAGE_SIZE) {
        return { kind: 'OK', body: items };
      }
    }

    // Tope alcanzado con la última página llena: puede haber más. Los listados que usa el adaptador
    // (instalaciones y owners) sirven para NEGAR (ocultar una organización, denegar un acceso), y un
    // listado truncado no prueba una ausencia: no es verificable, nunca un OK parcial.
    this.logger.warn(`Listado de "${path}" alcanzó el tope de ${MAX_PAGES} páginas: se trata como no verificable.`);
    return { kind: 'UNVERIFIABLE' };
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
