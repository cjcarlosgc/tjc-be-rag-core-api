export const GITHUB_ACCESS_PORT = Symbol('GITHUB_ACCESS_PORT');

/** `role_name` de GitHub ya normalizado; un rol personalizado se mapea por su permiso base. */
export type RepositoryPermissionLevel = 'admin' | 'maintain' | 'write' | 'triage' | 'read';

/**
 * Repositorio a consultar con el installation token de la App: las lecturas de
 * GitHub se direccionan por `owner/repo` y el token es por instalación.
 */
export interface RepositoryRef {
  installationId: string;
  repositoryName: string;
}

/**
 * Organización a consultar con el installation token de su instalación. Las
 * lecturas de organización se direccionan por `login` (`/orgs/{org}/...`); el
 * token es de la instalación, así que un `login` que ya no pertenece a esa
 * instalación (renombrado o reasignado) no devuelve datos de otra organización.
 */
export interface OrganizationRef {
  installationId: string;
  organizationLogin: string;
}

/** Instalación de la GitHub App en una organización (`GET /app/installations`, JWT de App). */
export interface OrganizationInstallation {
  installationId: string;
  /** Id numérico de GitHub de la organización, como texto (el `workspaceId`). */
  organizationId: string;
  organizationLogin: string;
  avatarUrl: string | null;
  /** Instalación suspendida: no verificable, no se ofrece como workspace. */
  suspended: boolean;
}

/**
 * `GET /orgs/{org}/memberships/{login}` (permiso `Members: read`): una sola
 * lectura da la membresía y el rol de owner. `admin` = owner; cualquier otro
 * rol de membresía (`member`, `billing_manager`) se normaliza a `member`. Solo
 * `state: 'active'` cuenta como miembro; `pending` no.
 */
export interface OrganizationMembership {
  role: 'admin' | 'member';
  state: 'active' | 'pending';
}

export interface OrganizationOwner {
  /** Id numérico de GitHub del owner, como texto. */
  githubUserId: string;
  login: string;
}

export interface RepositoryOwner {
  /** Id real del repositorio según GitHub (el `repositoryId` del cliente no es autoridad). */
  repositoryId: string;
  /** Id numérico de GitHub de la cuenta u organización propietaria, como texto. */
  ownerId: string;
  ownerLogin: string;
  ownerType: 'User' | 'Organization';
}

/** Repositorio leído por su id inmutable: incluye el nombre vigente (`owner/repo`), que cambia al renombrarlo. */
export interface RepositoryDetails extends RepositoryOwner {
  repositoryName: string;
}

/**
 * Resultado explícito de una consulta a GitHub (`plan.md`, "Puertos con fakes").
 * `UNVERIFIABLE` (red, `5xx`, límite de tasa, instalación suspendida, permiso
 * ausente) nunca se confunde con `NOT_FOUND` ("GitHub confirma que no existe o
 * no hay acceso") ni con `NOT_INSTALLED` (la App no está instalada): es la base
 * de "conservar lo existente, negar lo nuevo".
 */
export type GithubLookup<T> =
  | { status: 'OK'; value: T }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_INSTALLED' }
  | { status: 'UNVERIFIABLE' };

/**
 * Lecturas de GitHub con la identidad de la App. Corte 4a: propietario y permiso
 * de un repositorio. Corte 2: instalaciones de la App, membresía y owners de una
 * organización, con la misma convención de resultado (`GithubLookup`).
 */
export interface GithubAccessPort {
  /** Propietario del repositorio; `NOT_FOUND` si no existe o la instalación no lo ve. */
  getRepositoryOwner(repository: RepositoryRef): Promise<GithubLookup<RepositoryOwner>>;

  /**
   * Repositorio por su id inmutable (`GET /repositories/{id}` con el installation token):
   * devuelve el nombre y el propietario VIGENTES aunque se haya renombrado o transferido, que
   * es lo que revalida la reconciliación (HU61, parte (c)). `NOT_FOUND` = eliminado o la
   * instalación ya no lo ve; `NOT_INSTALLED` = la App ya no está instalada.
   */
  getRepositoryById(installationId: string, repositoryId: string): Promise<GithubLookup<RepositoryDetails>>;

  /**
   * Permiso efectivo de `githubUserId` sobre el repositorio, leído con el
   * installation token por `login` resuelto desde el id (`GET /user/{id}`); el
   * `githubLogin` guardado nunca se usa. `NOT_FOUND` = sin ningún permiso.
   */
  getRepositoryPermission(
    repository: RepositoryRef,
    githubUserId: string,
  ): Promise<GithubLookup<RepositoryPermissionLevel>>;

  /**
   * Instalaciones de la App en organizaciones (las de cuentas personales se
   * omiten), con el JWT de la App: no hay installation token que pueda fallar
   * con `NOT_INSTALLED`. Incluye las suspendidas (`suspended`); una lista vacía
   * es `OK`. `UNVERIFIABLE` = GitHub no responde o la App no está configurada.
   */
  listOrganizationInstallations(): Promise<GithubLookup<OrganizationInstallation[]>>;

  /**
   * Membresía de `githubUserId` en la organización, leída con el installation
   * token por `login` resuelto desde el id (`GET /user/{id}`, sin caché).
   * `NOT_FOUND` = no es miembro (ni pendiente). `UNVERIFIABLE` incluye `Members:
   * read` sin aceptar o la instalación suspendida.
   */
  getOrganizationMembership(
    organization: OrganizationRef,
    githubUserId: string,
  ): Promise<GithubLookup<OrganizationMembership>>;

  /** Owners (`role=admin`) de la organización; una lista vacía es `OK` (organización sin owners). */
  listOrganizationOwners(organization: OrganizationRef): Promise<GithubLookup<OrganizationOwner[]>>;
}
