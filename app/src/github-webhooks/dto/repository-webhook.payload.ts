/**
 * Subconjunto tipado del payload real de GitHub para `repository`; solo los campos que Core
 * lee. Se acepta como aserción firmada de GitHub (HMAC) sobre QUÉ binding cambió (`repository.id`)
 * y su nombre/propietario nuevos; no sirve para conceder acceso a ningún usuario.
 */
export interface GithubRepositoryWebhookPayload {
  action: 'renamed' | 'transferred' | 'deleted' | 'privatized' | string;
  repository: {
    id: number;
    /** `owner/repo` vigente tras el evento. */
    full_name: string;
    /** Propietario vigente tras el evento (tras `transferred`, el nuevo). */
    owner?: { id: number; login?: string; type?: string };
  };
  installation?: { id: number };
}
