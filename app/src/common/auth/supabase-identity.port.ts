export const SUPABASE_IDENTITY_PORT = Symbol('SUPABASE_IDENTITY_PORT');

export interface GithubIdentity {
  /** `id` numérico de GitHub, como texto. Nunca sale de `user_metadata`. */
  githubUserId: string;
  /** Solo presentación: jamás autoriza. */
  login?: string;
}

/** La Admin API de Supabase no respondió (red, timeout, 5xx o credencial de servicio rechazada). */
export class SupabaseIdentityUnavailableError extends Error {}

/**
 * HU62 / `INTEROP-2.4` §6.13 "Identidad". `null` significa que Supabase
 * confirma que el usuario no tiene identidad GitHub; una caída se comunica con
 * `SupabaseIdentityUnavailableError`, nunca como `null`.
 */
export interface SupabaseIdentityPort {
  getGithubIdentity(sub: string): Promise<GithubIdentity | null>;
}
