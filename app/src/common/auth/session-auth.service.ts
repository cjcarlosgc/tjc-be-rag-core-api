import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_TOKEN_VERIFIER } from './auth.constants.js';
import { GithubIdentityService } from './github-identity.service.js';
import type { TokenVerifierPort } from './token-verifier.port.js';

export interface SessionIdentity {
  userId: string;
  githubUserId: string;
}

/**
 * Autenticación de una sesión: valida el JWT (`InvalidTokenError` si es
 * inválido) y resuelve la identidad GitHub. La usan el guard HTTP/WS y el
 * middleware de handshake de WebSocket, para que ambos apliquen la misma
 * resolución. Bajo `AUTH_BYPASS` el `userId` y el `githubUserId` son los
 * sintéticos configurados y no se llama al verificador ni a Supabase.
 */
@Injectable()
export class SessionAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly identity: GithubIdentityService,
    @Inject(AUTH_TOKEN_VERIFIER) private readonly verifier: TokenVerifierPort,
  ) {}

  async authenticate(token: string): Promise<SessionIdentity> {
    const userId = this.config.get<boolean>('AUTH_BYPASS_ENABLED', false)
      ? this.config.get<string>('AUTH_BYPASS_USER_ID', 'local-dev-user')
      : (await this.verifier.verify(token)).userId;

    return { userId, githubUserId: await this.identity.resolve(userId) };
  }
}
