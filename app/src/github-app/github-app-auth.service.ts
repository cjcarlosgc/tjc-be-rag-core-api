import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';

export class GithubAppUnavailableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const APP_JWT_TTL_SECONDS = 9 * 60; // GitHub exige un máximo de 10 minutos.
const INSTALLATION_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const GITHUB_API_VERSION = '2022-11-28';

interface CachedInstallationToken {
  token: string;
  expiresAt: number;
}

export interface GithubAppInfo {
  slug: string;
  name: string;
}

/**
 * Autenticación real como la GitHub App (HU33/34): JWT de App firmado con la
 * private key, intercambiado por un installation access token por
 * instalación. La private key de GitHub viene en PKCS#1
 * (`BEGIN RSA PRIVATE KEY`); `jose.importPKCS8` exige PKCS#8, así que se
 * convierte primero con `node:crypto` (validado en esta sesión contra
 * `api.github.com/app` con la App real, id 4935151).
 */
@Injectable()
export class GithubAppAuthService {
  private readonly logger = new Logger(GithubAppAuthService.name);
  private readonly installationTokens = new Map<string, CachedInstallationToken>();
  private appInfoCache: GithubAppInfo | null = null;

  constructor(private readonly configService: ConfigService) {}

  async signAppJwt(): Promise<string> {
    const appId = this.configService.get<string>('GITHUB_APP_ID');
    const privateKeyBase64 = this.configService.get<string>('GITHUB_APP_PRIVATE_KEY_BASE64');

    if (!appId || !privateKeyBase64) {
      throw new GithubAppUnavailableError(
        'GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY_BASE64 no están configurados.',
      );
    }

    const pkcs1Pem = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
    const pkcs8Pem = createPrivateKey(pkcs1Pem).export({ type: 'pkcs8', format: 'pem' }) as string;
    const key = await importPKCS8(pkcs8Pem, 'RS256');

    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer(appId)
      .setExpirationTime(`${APP_JWT_TTL_SECONDS}s`)
      .sign(key);
  }

  async getInstallationToken(installationId: string): Promise<string> {
    const cached = this.installationTokens.get(installationId);

    if (cached && cached.expiresAt - INSTALLATION_TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return cached.token;
    }

    const appJwt = await this.signAppJwt();
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `No se pudo obtener installation token para "${installationId}": ${response.status} ${body}`,
      );
      throw new GithubAppUnavailableError(
        `GitHub App no pudo autenticar la instalación "${installationId}" (${response.status}).`,
        response.status,
      );
    }

    const data = (await response.json()) as { token: string; expires_at: string };
    const expiresAt = new Date(data.expires_at).getTime();
    this.installationTokens.set(installationId, { token: data.token, expiresAt });

    return data.token;
  }

  /**
   * HU30: resuelve server-side qué instalación (si alguna) tiene acceso a
   * `owner/repo`. `404` significa "sin acceso" (repo inexistente o App no
   * instalada allí, indistinguibles con solo el JWT de App) y se traduce a
   * `null`, nunca a una excepción: el resultado de producto es `NOT_AUTHORIZED`.
   */
  async findInstallationForRepository(owner: string, repo: string): Promise<string | null> {
    const appJwt = await this.signAppJwt();
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(
        `No se pudo resolver la instalación de "${owner}/${repo}": ${response.status} ${body}`,
      );
      throw new GithubAppUnavailableError(
        `GitHub App no pudo resolver la instalación de "${owner}/${repo}" (${response.status}).`,
        response.status,
      );
    }

    const data = (await response.json()) as { id: number };
    return String(data.id);
  }

  /**
   * HU30: `slug`/`name` de la propia App (para `app.configureUrl`/
   * `app.displayName` de `verify-app-access`), resueltos vía `GET /app` en
   * vez de configurarse por env var. Solo cambian si renombras la App, así
   * que se cachean en memoria sin expiración.
   */
  async getAppInfo(): Promise<GithubAppInfo> {
    if (this.appInfoCache) {
      return this.appInfoCache;
    }

    const appJwt = await this.signAppJwt();
    const response = await fetch('https://api.github.com/app', {
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn(`No se pudo resolver la info de la GitHub App: ${response.status} ${body}`);
      throw new GithubAppUnavailableError(
        `GitHub App no pudo resolver su propia info (${response.status}).`,
        response.status,
      );
    }

    const data = (await response.json()) as { slug: string; name: string };
    this.appInfoCache = { slug: data.slug, name: data.name };

    return this.appInfoCache;
  }
}
