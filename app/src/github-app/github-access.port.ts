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

export interface RepositoryOwner {
  /** Id real del repositorio según GitHub (el `repositoryId` del cliente no es autoridad). */
  repositoryId: string;
  /** Id numérico de GitHub de la cuenta u organización propietaria, como texto. */
  ownerId: string;
  ownerLogin: string;
  ownerType: 'User' | 'Organization';
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
 * Corte 4a: lecturas de propietario y permiso de un repositorio. El corte 2
 * agrega instalaciones, membresía y owners de organización al mismo puerto.
 */
export interface GithubAccessPort {
  /** Propietario del repositorio; `NOT_FOUND` si no existe o la instalación no lo ve. */
  getRepositoryOwner(repository: RepositoryRef): Promise<GithubLookup<RepositoryOwner>>;

  /**
   * Permiso efectivo de `githubUserId` sobre el repositorio, leído con el
   * installation token por `login` resuelto desde el id (`GET /user/{id}`); el
   * `githubLogin` guardado nunca se usa. `NOT_FOUND` = sin ningún permiso.
   */
  getRepositoryPermission(
    repository: RepositoryRef,
    githubUserId: string,
  ): Promise<GithubLookup<RepositoryPermissionLevel>>;
}
