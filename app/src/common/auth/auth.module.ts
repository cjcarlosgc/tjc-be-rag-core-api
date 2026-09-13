import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH_TOKEN_VERIFIER } from './auth.constants.js';
import { AuthGuard } from './auth.guard.js';
import { SupabaseJwtVerifier } from './supabase-jwt-verifier.js';

@Global()
@Module({
  providers: [
    { provide: AUTH_TOKEN_VERIFIER, useClass: SupabaseJwtVerifier },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AUTH_TOKEN_VERIFIER],
})
export class AuthModule {}
