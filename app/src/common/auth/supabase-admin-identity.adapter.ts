import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SupabaseIdentityUnavailableError,
  type GithubIdentity,
  type SupabaseIdentityPort,
} from './supabase-identity.port.js';

const ADMIN_API_TIMEOUT_MS = 5_000;
const NUMERIC_ID = /^\d+$/;

interface AdminApiIdentity {
  id?: unknown;
  provider?: unknown;
  identity_data?: { provider_id?: unknown; user_name?: unknown } | null;
}

interface AdminApiUser {
  identities?: AdminApiIdentity[] | null;
}

/**
 * Adapter productivo de `SupabaseIdentityPort`: `GET /auth/v1/admin/users/{sub}`
 * con la credencial de servicio de Core (solo servidor). No se usa el listado
 * `GET /auth/v1/admin/users` porque devuelve `identities: null`, y nunca se
 * lee `user_metadata`, que el propio usuario puede editar.
 */
@Injectable()
export class SupabaseAdminIdentityAdapter implements SupabaseIdentityPort {
  constructor(private readonly config: ConfigService) {}

  async getGithubIdentity(sub: string): Promise<GithubIdentity | null> {
    const baseUrl = this.config.getOrThrow<string>('SUPABASE_URL');
    const serviceKey = this.config.getOrThrow<string>('SUPABASE_SECRET_KEY');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(sub)}`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(ADMIN_API_TIMEOUT_MS),
      });
    } catch {
      throw new SupabaseIdentityUnavailableError('La Admin API de Supabase no respondió.');
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new SupabaseIdentityUnavailableError(
        `La Admin API de Supabase respondió ${response.status}.`,
      );
    }

    let user: AdminApiUser;
    try {
      user = (await response.json()) as AdminApiUser;
    } catch {
      throw new SupabaseIdentityUnavailableError('La Admin API de Supabase devolvió un cuerpo inválido.');
    }

    return toGithubIdentity(user);
  }
}

export function toGithubIdentity(user: AdminApiUser): GithubIdentity | null {
  const entry = (user.identities ?? []).find((identity) => identity.provider === 'github');

  if (!entry) {
    return null;
  }

  // Contrato: `identities[].id` (igual a `identity_data.provider_id`, ambos del
  // provider). Si una versión de Supabase devolviera ahí un UUID de identidad,
  // se usa `identity_data.provider_id`, que también proviene de GitHub y no de
  // `user_metadata`.
  const candidates = [entry.id, entry.identity_data?.provider_id];
  const githubUserId = candidates.map((value) => String(value ?? '')).find((value) => NUMERIC_ID.test(value));

  if (!githubUserId) {
    return null;
  }

  const userName = entry.identity_data?.user_name;
  return { githubUserId, ...(typeof userName === 'string' && userName ? { login: userName } : {}) };
}
