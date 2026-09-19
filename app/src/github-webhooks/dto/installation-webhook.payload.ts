/** Subconjunto tipado del payload real de GitHub para `installation`; solo los campos que Core lee. */
export interface GithubInstallationWebhookPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted' | string;
  installation: { id: number };
}

/** Subconjunto tipado del payload real de GitHub para `installation_repositories`. */
export interface GithubInstallationRepositoriesWebhookPayload {
  action: 'added' | 'removed' | string;
  installation: { id: number };
  repositories_removed?: Array<{ id: number; full_name: string }>;
  repositories_added?: Array<{ id: number; full_name: string }>;
}
