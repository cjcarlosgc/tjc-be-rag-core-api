/**
 * Subconjuntos tipados de los payloads reales de GitHub para `member`, `membership`,
 * `organization` y `team`; solo los campos que Core lee. Todo se acepta como aserción firmada
 * (HMAC) sobre QUÉ reverificar; ningún campo concede acceso ni fija un rol (`INTEROP-2.4` §6.9,
 * "Regla de confianza"). Los ids pueden faltar en un payload atípico: el manejador los
 * valida y, si no están, ignora el evento.
 */
export interface GithubMemberWebhookPayload {
  action: 'added' | 'edited' | 'removed' | string;
  /** Colaborador directo afectado. */
  member?: { id?: number };
  repository?: { id?: number };
}

export interface GithubMembershipWebhookPayload {
  action: 'added' | 'removed' | string;
  /** Miembro del Team afectado. */
  member?: { id?: number };
  organization?: { id?: number };
}

export interface GithubOrganizationWebhookPayload {
  action: 'member_added' | 'member_invited' | 'member_removed' | 'renamed' | 'deleted' | string;
  /** `member_*`: la membresía afectada. */
  membership?: { user?: { id?: number } };
  /** Tras `renamed`, `login` es el nombre nuevo. */
  organization?: { id?: number; login?: string };
}

export interface GithubTeamWebhookPayload {
  action: 'created' | 'deleted' | 'edited' | 'added_to_repository' | 'removed_from_repository' | string;
  /** Solo viene en los cambios de un repositorio del Team. */
  repository?: { id?: number };
  organization?: { id?: number };
}
