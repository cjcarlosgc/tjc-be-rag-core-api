/**
 * Job `ACCESS_REVERIFY` (`INTEROP-2.4` §6.9, "Eventos de acceso"): reverifica en vivo los
 * registros de acceso que un evento de GitHub señala. El payload solo SELECCIONA qué
 * registros reverificar; el rol siempre sale de una verificación viva con el installation
 * token (un evento puede llegar duplicado, tarde o fuera de orden).
 *
 * El alcance sigue la tabla de §6.9 y no lleva más que ids de GitHub: `jobs` no tiene columna
 * de alcance, así que la `dedupeKey` (índice único parcial, solo sobre `PENDING`) lo codifica
 * y dos eventos del mismo alcance mientras uno espera se absorben en un solo job.
 */
export const ACCESS_REVERIFY_JOB_TYPE = 'access-reverify';

export type AccessReverifyScope =
  /** `member` (`added`/`edited`/`removed`): un usuario sobre los Projects de organización vinculados a un repositorio. */
  | { scope: 'USER_REPOSITORY'; githubUserId: string; repositoryId: string }
  /** `organization.member_removed`: un usuario sobre TODOS los Projects de la organización (borra también su Admin). */
  | { scope: 'USER_ORGANIZATION'; githubUserId: string; organizationId: string }
  /** `membership` (Team): un usuario sobre los Projects CON repositorio de la organización. */
  | { scope: 'USER_ORGANIZATION_REPOSITORIES'; githubUserId: string; organizationId: string }
  /** `repository.privatized` y `team` con `repository.id`: todos los registros de los Projects vinculados a un repositorio. */
  | { scope: 'REPOSITORY'; repositoryId: string }
  /** `team` sin `repository.id`: todos los registros de los Projects con repositorio de la organización. */
  | { scope: 'ORGANIZATION_REPOSITORIES'; organizationId: string };

/**
 * Payload del job: el alcance más el contador de reprogramaciones por "no verificable". Siempre
 * es el alcance COMPLETO (nunca una lista parcial de pendientes): un evento nuevo del mismo
 * alcance se absorbe en el `PENDING` reprogramado y este debe cubrirlo.
 */
export type AccessReverifyPayload = AccessReverifyScope & { deferrals?: number };

const GITHUB_ID = /^[1-9][0-9]*$/;

/** Id numérico de GitHub (número o texto) como texto, o `null` si falta o no es un id válido. */
export function toGithubId(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;

  return typeof text === 'string' && GITHUB_ID.test(text) ? text : null;
}

export function reverifyDedupeKey(scope: AccessReverifyScope): string {
  switch (scope.scope) {
    case 'USER_REPOSITORY':
      return `ACCESS_REVERIFY:USER_REPOSITORY:${scope.githubUserId}:${scope.repositoryId}`;
    case 'USER_ORGANIZATION':
      return `ACCESS_REVERIFY:USER_ORGANIZATION:${scope.githubUserId}:${scope.organizationId}`;
    case 'USER_ORGANIZATION_REPOSITORIES':
      return `ACCESS_REVERIFY:USER_ORGANIZATION_REPOSITORIES:${scope.githubUserId}:${scope.organizationId}`;
    case 'REPOSITORY':
      return `ACCESS_REVERIFY:REPOSITORY:${scope.repositoryId}`;
    case 'ORGANIZATION_REPOSITORIES':
      return `ACCESS_REVERIFY:ORGANIZATION_REPOSITORIES:${scope.organizationId}`;
  }
}

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * Valida el payload de un job: lo encoló Core con ids ya validados por el ingress (`toGithubId`), así
 * que aquí basta con exigir ids de texto presentes. Un payload irreconocible se descarta, no se reintenta.
 */
export function parseReverifyPayload(payload: unknown): AccessReverifyPayload | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const raw = payload as Record<string, unknown>;
  const githubUserId = nonEmptyString(raw.githubUserId);
  const repositoryId = nonEmptyString(raw.repositoryId);
  const organizationId = nonEmptyString(raw.organizationId);
  const deferrals = typeof raw.deferrals === 'number' && raw.deferrals > 0 ? Math.floor(raw.deferrals) : 0;

  switch (raw.scope) {
    case 'USER_REPOSITORY':
      return githubUserId && repositoryId ? { scope: 'USER_REPOSITORY', githubUserId, repositoryId, deferrals } : null;
    case 'USER_ORGANIZATION':
      return githubUserId && organizationId ? { scope: 'USER_ORGANIZATION', githubUserId, organizationId, deferrals } : null;
    case 'USER_ORGANIZATION_REPOSITORIES':
      return githubUserId && organizationId
        ? { scope: 'USER_ORGANIZATION_REPOSITORIES', githubUserId, organizationId, deferrals }
        : null;
    case 'REPOSITORY':
      return repositoryId ? { scope: 'REPOSITORY', repositoryId, deferrals } : null;
    case 'ORGANIZATION_REPOSITORIES':
      return organizationId ? { scope: 'ORGANIZATION_REPOSITORIES', organizationId, deferrals } : null;
    default:
      return null;
  }
}
