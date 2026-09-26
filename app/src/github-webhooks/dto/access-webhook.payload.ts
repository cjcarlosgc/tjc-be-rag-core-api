/** Campos allowlisted adaptados desde eventos normalizados; no determinan roles ni permisos. */
export interface GithubMemberWebhookPayload {
  action: 'added' | 'edited' | 'removed' | string;
  /** Colaborador directo afectado. */
  member?: { id?: number | string };
  repository?: { id?: number | string };
}

export interface GithubMembershipWebhookPayload {
  action: 'added' | 'removed' | string;
  /** Miembro del Team afectado. */
  member?: { id?: number | string };
  organization?: { id?: number | string };
}

export interface GithubOrganizationWebhookPayload {
  action: 'member_added' | 'member_invited' | 'member_removed' | 'renamed' | 'deleted' | string;
  /** `member_*`: la membresía afectada. */
  membership?: { user?: { id?: number | string } };
  /** Tras `renamed`, `login` es el nombre nuevo. */
  organization?: { id?: number | string; login?: string };
}

export interface GithubTeamWebhookPayload {
  action: 'created' | 'deleted' | 'edited' | 'added_to_repository' | 'removed_from_repository' | string;
  /** Solo viene en los cambios de un repositorio del Team. */
  repository?: { id?: number | string };
  organization?: { id?: number | string };
}
