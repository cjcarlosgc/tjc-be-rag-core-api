import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const GITHUB_INTEGRATION_FETCH = Symbol('GITHUB_INTEGRATION_FETCH');

const INTERNAL_API_PREFIX = '/internal/v1/github';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 180_000;
const ALLOWED_EXTRA_HEADERS = new Set(['x-correlation-id', 'x-github-provider-token']);

export type GithubIntegrationErrorCode =
  | 'INVALID_REQUEST'
  | 'SERVICE_UNAUTHORIZED'
  | 'GITHUB_USER_TOKEN_INVALID'
  | 'GITHUB_RESOURCE_NOT_FOUND'
  | 'GITHUB_APP_CONFIGURATION_UNAVAILABLE'
  | 'GITHUB_UPSTREAM_UNAVAILABLE';

export class GithubIntegrationClientError extends Error {
  constructor(
    readonly code: GithubIntegrationErrorCode,
    readonly status: number | undefined,
    readonly retryable: boolean,
  ) {
    super(`GitHub Integration request failed (${code}).`);
  }
}

export interface GithubIntegrationRequestOptions {
  /** Only correlation and the ephemeral discovery provider token are forwarded. */
  headers?: Record<string, string>;
  /** Per-request deadline; publication/blob requests may use up to 180 seconds. */
  timeoutMs?: number;
}

const CONTRACT_ERRORS: Record<
  GithubIntegrationErrorCode,
  { status: number[]; retryable: boolean }
> = {
  INVALID_REQUEST: { status: [400, 413], retryable: false },
  SERVICE_UNAUTHORIZED: { status: [401], retryable: false },
  GITHUB_USER_TOKEN_INVALID: { status: [401], retryable: false },
  GITHUB_RESOURCE_NOT_FOUND: { status: [404], retryable: false },
  GITHUB_APP_CONFIGURATION_UNAVAILABLE: { status: [503], retryable: false },
  GITHUB_UPSTREAM_UNAVAILABLE: { status: [503], retryable: true },
};

@Injectable()
export class GithubIntegrationClient {
  constructor(
    private readonly config: ConfigService,
    @Inject(GITHUB_INTEGRATION_FETCH) private readonly fetcher: typeof fetch,
  ) {}

  get<T>(path: string, options?: GithubIntegrationRequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T>(
    path: string,
    body: unknown,
    options?: GithubIntegrationRequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: GithubIntegrationRequestOptions = {},
  ): Promise<T> {
    const baseUrl = this.config.get<unknown>('GITHUB_INTEGRATION_API_BASE_URL');
    const nodeEnvironment = this.config.get<unknown>('NODE_ENV');
    const token = this.config.get<unknown>('CORE_TO_GITHUB_INTEGRATION_TOKEN');
    const url = normalizeBaseUrl(baseUrl, nodeEnvironment !== 'production');
    const normalizedPath = normalizePath(path);
    const timeoutMs = resolveTimeout(options.timeoutMs);

    if (
      !url ||
      typeof token !== 'string' ||
      token.trim() !== token ||
      token.length === 0 ||
      !normalizedPath ||
      timeoutMs === null
    ) {
      throw new GithubIntegrationClientError('GITHUB_UPSTREAM_UNAVAILABLE', undefined, false);
    }

    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    });
    if (method === 'POST') headers.set('Content-Type', 'application/json');
    addAllowedHeaders(headers, options.headers);

    let serializedBody: string | undefined;
    if (method === 'POST') {
      try {
        serializedBody = JSON.stringify(body);
      } catch {
        throw new GithubIntegrationClientError('INVALID_REQUEST', 400, false);
      }
      if (serializedBody === undefined) {
        throw new GithubIntegrationClientError('INVALID_REQUEST', 400, false);
      }
    }

    let response: Response;
    try {
      response = await this.fetcher(`${url}${normalizedPath}`, {
        method,
        headers,
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new GithubIntegrationClientError('GITHUB_UPSTREAM_UNAVAILABLE', undefined, true);
    }

    if (!response.ok) throw await toContractError(response);
    if (response.status === 204) return undefined as T;

    try {
      return (await response.json()) as T;
    } catch {
      throw new GithubIntegrationClientError('GITHUB_UPSTREAM_UNAVAILABLE', response.status, true);
    }
  }
}

function normalizeBaseUrl(value: unknown, allowHttpLoopback: boolean): string | null {
  if (typeof value !== 'string' || !value || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowHttpLoopback && isLoopbackHostname(url.hostname))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '' && url.pathname !== '/')
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function normalizePath(value: string): string | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('://') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    return null;
  }
  const path = value.startsWith('/') ? value : `/${value}`;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..') || path.startsWith('//')) {
    return null;
  }

  if (path === INTERNAL_API_PREFIX || path.startsWith(`${INTERNAL_API_PREFIX}/`)) return path;
  return `${INTERNAL_API_PREFIX}${path}`;
}

function resolveTimeout(value: number | undefined): number | null {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) return null;
  return value;
}

function addAllowedHeaders(headers: Headers, extra: Record<string, string> | undefined): void {
  if (!extra) return;
  for (const [name, value] of Object.entries(extra)) {
    const normalizedName = name.toLowerCase();
    if (
      !ALLOWED_EXTRA_HEADERS.has(normalizedName) ||
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 8_192 ||
      /[\r\n]/.test(value)
    ) {
      continue;
    }
    headers.set(name, value);
  }
}

async function toContractError(response: Response): Promise<GithubIntegrationClientError> {
  const status = response.status;

  // Rate limits and unknown 5xx responses are always reduced to the neutral upstream error.
  if (status === 429) {
    return new GithubIntegrationClientError('GITHUB_UPSTREAM_UNAVAILABLE', status, true);
  }

  const envelope = await readContractErrorEnvelope(response);
  if (envelope) {
    const rule = CONTRACT_ERRORS[envelope.code];
    if (rule?.status.includes(status) && rule.retryable === envelope.retryable) {
      return new GithubIntegrationClientError(envelope.code, status, rule.retryable);
    }
  }

  if (status >= 500) {
    return new GithubIntegrationClientError('GITHUB_UPSTREAM_UNAVAILABLE', status, true);
  }
  if (status === 403) {
    return new GithubIntegrationClientError('GITHUB_UPSTREAM_UNAVAILABLE', status, true);
  }
  return new GithubIntegrationClientError('GITHUB_UPSTREAM_UNAVAILABLE', status, false);
}

async function readContractErrorEnvelope(
  response: Response,
): Promise<{ code: GithubIntegrationErrorCode; retryable: boolean } | null> {
  try {
    const value: unknown = await response.json();
    if (!isRecord(value) || typeof value.code !== 'string' || typeof value.retryable !== 'boolean') {
      return null;
    }
    if (!Object.hasOwn(CONTRACT_ERRORS, value.code)) return null;
    return { code: value.code as GithubIntegrationErrorCode, retryable: value.retryable };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
