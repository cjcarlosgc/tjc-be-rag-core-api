import {
  SupabaseIdentityUnavailableError,
  type GithubIdentity,
  type SupabaseIdentityPort,
} from '../../src/common/auth/supabase-identity.port.js';

/**
 * Fake de `SupabaseIdentityPort`: ningún test llama a la Admin API real.
 * `setIdentity(sub, null)` simula "sin identidad GitHub"; `setUnavailable(true)`
 * simula la Admin API caída. Sin configuración explícita usa `fallback`.
 */
export class FakeSupabaseIdentityPort implements SupabaseIdentityPort {
  readonly calls: string[] = [];
  private readonly identities = new Map<string, GithubIdentity | null>();
  private unavailable = false;

  constructor(private readonly fallback: (sub: string) => GithubIdentity | null = () => null) {}

  setIdentity(sub: string, identity: GithubIdentity | null): void {
    this.identities.set(sub, identity);
  }

  setUnavailable(unavailable: boolean): void {
    this.unavailable = unavailable;
  }

  getGithubIdentity(sub: string): Promise<GithubIdentity | null> {
    this.calls.push(sub);

    if (this.unavailable) {
      return Promise.reject(new SupabaseIdentityUnavailableError('Admin API caída (fake).'));
    }

    return Promise.resolve(this.identities.has(sub) ? (this.identities.get(sub) ?? null) : this.fallback(sub));
  }
}
