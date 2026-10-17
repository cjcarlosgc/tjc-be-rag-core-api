/** Campos allowlisted adaptados desde el evento normalizado de GH Integration. */
export interface GithubRepositoryWebhookPayload {
  action: 'renamed' | 'transferred' | 'deleted' | 'privatized' | string;
  repository: {
    id: number | string;
    /** `owner/repo` vigente tras el evento. */
    full_name: string;
    /** Propietario vigente tras el evento (tras `transferred`, el nuevo). */
    owner?: { id: number | string; login?: string; type?: string };
  };
  installation?: { id: number | string };
}
