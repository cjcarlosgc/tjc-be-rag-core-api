import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH_TOKEN_VERIFIER } from './auth.constants.js';
import { AuthGuard } from './auth.guard.js';
import { GithubIdentityService } from './github-identity.service.js';
import { SessionAuthService } from './session-auth.service.js';
import { SupabaseAdminIdentityAdapter } from './supabase-admin-identity.adapter.js';
import { SUPABASE_IDENTITY_PORT } from './supabase-identity.port.js';
import { SupabaseJwtVerifier } from './supabase-jwt-verifier.js';
import { UserGithubIdentitiesRepository } from './user-github-identities.repository.js';

@Global()
@Module({
  providers: [
    { provide: AUTH_TOKEN_VERIFIER, useClass: SupabaseJwtVerifier },
    { provide: SUPABASE_IDENTITY_PORT, useClass: SupabaseAdminIdentityAdapter },
    UserGithubIdentitiesRepository,
    GithubIdentityService,
    SessionAuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [
    AUTH_TOKEN_VERIFIER,
    SUPABASE_IDENTITY_PORT,
    UserGithubIdentitiesRepository,
    GithubIdentityService,
    SessionAuthService,
  ],
})
export class AuthModule {}
