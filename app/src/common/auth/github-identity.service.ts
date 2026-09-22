import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import {
  SUPABASE_IDENTITY_PORT,
  SupabaseIdentityUnavailableError,
  type SupabaseIdentityPort,
} from './supabase-identity.port.js';
import { UserGithubIdentitiesRepository } from './user-github-identities.repository.js';

/**
 * HU62: resuelve `PlatformUser (sub) -> githubUserId` una sola vez y persiste el
 * vínculo. Con vínculo persistido no se consulta Supabase (una caída de la
 * Admin API no afecta a quien ya lo tiene). HTTP y handshake WebSocket usan
 * esta misma resolución. Bajo `AUTH_BYPASS` (solo local/mock) se devuelve la
 * identidad sintética configurada, sin base de datos ni Supabase.
 */
@Injectable()
export class GithubIdentityService {
  private readonly logger = new Logger(GithubIdentityService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly identities: UserGithubIdentitiesRepository,
    @Inject(SUPABASE_IDENTITY_PORT) private readonly supabaseIdentity: SupabaseIdentityPort,
  ) {}

  async resolve(userId: string): Promise<string> {
    if (this.config.get<boolean>('AUTH_BYPASS_ENABLED', false)) {
      return this.syntheticBypassIdentity();
    }

    const linked = await this.identities.findByUserId(userId);

    if (linked) {
      return linked.githubUserId;
    }

    let identity;
    try {
      identity = await this.supabaseIdentity.getGithubIdentity(userId);
    } catch (error) {
      if (error instanceof SupabaseIdentityUnavailableError) {
        this.logger.warn(`Admin API de Supabase no disponible al resolver la identidad GitHub: ${error.message}`);
        throw new AppException(
          ErrorCode.IDENTITY_UNAVAILABLE,
          'No se pudo resolver la identidad GitHub de la sesión; reintenta.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }

    if (!identity) {
      throw this.identityRequired('La cuenta no tiene una identidad GitHub; inicia sesión con GitHub.');
    }

    return this.persist(userId, identity.githubUserId, identity.login ?? null);
  }

  /**
   * `githubLogin` guardado: solo presentación (etiqueta del workspace personal),
   * nunca autoriza. `null` si aún no se conoce o bajo `AUTH_BYPASS` (sin base de datos).
   */
  async findGithubLogin(userId: string): Promise<string | null> {
    if (this.config.get<boolean>('AUTH_BYPASS_ENABLED', false)) {
      return null;
    }

    return (await this.identities.findByUserId(userId))?.githubLogin ?? null;
  }

  private async persist(userId: string, githubUserId: string, login: string | null): Promise<string> {
    try {
      const created = await this.identities.create(userId, githubUserId, login);
      this.logger.log(`Vínculo de identidad GitHub creado para el usuario "${userId}".`);
      return created.githubUserId;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      // Carrera con otra petición del mismo usuario: gana el vínculo ya persistido.
      const existing = await this.identities.findByUserId(userId);

      if (existing) {
        return existing.githubUserId;
      }

      // Otro `sub` ya está vinculado a esa cuenta de GitHub: nunca se comparten
      // roles entre cuentas de Supabase distintas.
      this.logger.warn(`La identidad GitHub del usuario "${userId}" ya está vinculada a otra cuenta.`);
      throw this.identityRequired('La identidad GitHub ya está vinculada a otra cuenta.');
    }
  }

  private syntheticBypassIdentity(): string {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new Error('AUTH_BYPASS_ENABLED no puede resolver identidades con NODE_ENV=production.');
    }
    return this.config.getOrThrow<string>('AUTH_BYPASS_GITHUB_USER_ID');
  }

  private identityRequired(message: string): AppException {
    return new AppException(ErrorCode.GITHUB_IDENTITY_REQUIRED, message, HttpStatus.UNAUTHORIZED);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
