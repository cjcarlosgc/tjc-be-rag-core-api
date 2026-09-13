import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { InvalidTokenError, type TokenVerifierPort, type VerifiedToken } from './token-verifier.port.js';

const SUPABASE_AUDIENCE = 'authenticated';

@Injectable()
export class SupabaseJwtVerifier implements TokenVerifierPort {
  private jwks: JWTVerifyGetKey | null = null;

  constructor(private readonly config: ConfigService) {}

  async verify(token: string): Promise<VerifiedToken> {
    try {
      const { payload } = await jwtVerify(token, this.getJwks(), {
        issuer: `${this.supabaseUrl()}/auth/v1`,
        audience: SUPABASE_AUDIENCE,
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new InvalidTokenError('El token no incluye un sub válido.');
      }

      return { userId: payload.sub };
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw error;
      }
      throw new InvalidTokenError('El access token es inválido o expiró.');
    }
  }

  private getJwks(): JWTVerifyGetKey {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(`${this.supabaseUrl()}/auth/v1/.well-known/jwks.json`));
    }
    return this.jwks;
  }

  private supabaseUrl(): string {
    return this.config.get<string>('SUPABASE_URL', '');
  }
}
