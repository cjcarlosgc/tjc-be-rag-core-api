import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'secret',
    SUPABASE_STORAGE_BUCKET: 'bucket',
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('accepts a minimal valid config and applies defaults', () => {
    const result = validateEnv(baseConfig());

    expect(result.PORT).toBe(3000);
    expect(result.EMBEDDING_MODEL).toBe('text-embedding-3-small');
  });

  it('throws when a required field is missing', () => {
    const config = baseConfig();
    delete config.DATABASE_URL;

    expect(() => validateEnv(config)).toThrow(/inválida/);
  });

  it('accepts SANDBOX_URL and SANDBOX_SERVICE_TOKEN both unset', () => {
    expect(() => validateEnv(baseConfig())).not.toThrow();
  });

  it('accepts SANDBOX_URL and SANDBOX_SERVICE_TOKEN both set (DEC-AUTH-001)', () => {
    expect(() =>
      validateEnv(
        baseConfig({ SANDBOX_URL: 'http://sandbox.local', SANDBOX_SERVICE_TOKEN: 'token' }),
      ),
    ).not.toThrow();
  });

  it('rejects SANDBOX_URL set without SANDBOX_SERVICE_TOKEN (DEC-AUTH-001)', () => {
    expect(() => validateEnv(baseConfig({ SANDBOX_URL: 'http://sandbox.local' }))).toThrow(
      /DEC-AUTH-001/,
    );
  });

  it('rejects SANDBOX_SERVICE_TOKEN set without SANDBOX_URL (DEC-AUTH-001)', () => {
    expect(() => validateEnv(baseConfig({ SANDBOX_SERVICE_TOKEN: 'token' }))).toThrow(
      /DEC-AUTH-001/,
    );
  });

  it('accepts GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_BASE64 both set', () => {
    expect(() =>
      validateEnv(baseConfig({ GITHUB_APP_ID: '123', GITHUB_APP_PRIVATE_KEY_BASE64: 'a2V5' })),
    ).not.toThrow();
  });

  it('rejects GITHUB_APP_ID set without GITHUB_APP_PRIVATE_KEY_BASE64', () => {
    expect(() => validateEnv(baseConfig({ GITHUB_APP_ID: '123' }))).toThrow(
      /GITHUB_APP_ID y GITHUB_APP_PRIVATE_KEY_BASE64/,
    );
  });

  it('rejects GITHUB_APP_PRIVATE_KEY_BASE64 set without GITHUB_APP_ID', () => {
    expect(() => validateEnv(baseConfig({ GITHUB_APP_PRIVATE_KEY_BASE64: 'a2V5' }))).toThrow(
      /GITHUB_APP_ID y GITHUB_APP_PRIVATE_KEY_BASE64/,
    );
  });

  it('defaults NODE_ENV to development and AUTH_BYPASS_ENABLED to false', () => {
    const result = validateEnv(baseConfig());

    expect(result.NODE_ENV).toBe('development');
    expect(result.AUTH_BYPASS_ENABLED).toBe(false);
    expect(result.AUTH_BYPASS_USER_ID).toBe('local-dev-user');
  });

  it('treats the literal string "false" as AUTH_BYPASS_ENABLED=false', () => {
    const result = validateEnv(baseConfig({ AUTH_BYPASS_ENABLED: 'false' }));

    expect(result.AUTH_BYPASS_ENABLED).toBe(false);
  });

  it('treats the literal string "true" as AUTH_BYPASS_ENABLED=true', () => {
    const result = validateEnv(baseConfig({ AUTH_BYPASS_ENABLED: 'true', NODE_ENV: 'development' }));

    expect(result.AUTH_BYPASS_ENABLED).toBe(true);
  });

  it('allows AUTH_BYPASS_ENABLED=true outside production', () => {
    expect(() =>
      validateEnv(baseConfig({ NODE_ENV: 'development', AUTH_BYPASS_ENABLED: 'true' })),
    ).not.toThrow();
  });

  it('rejects AUTH_BYPASS_ENABLED=true with NODE_ENV=production (DEC-WEB-AUTH-001)', () => {
    expect(() =>
      validateEnv(baseConfig({ NODE_ENV: 'production', AUTH_BYPASS_ENABLED: 'true' })),
    ).toThrow(/DEC-WEB-AUTH-001/);
  });

  it('exposes a synthetic numeric GitHub identity for the bypass (HU62)', () => {
    const result = validateEnv(baseConfig({ AUTH_BYPASS_ENABLED: 'true', AUTH_BYPASS_GITHUB_USER_ID: '12345' }));

    expect(result.AUTH_BYPASS_GITHUB_USER_ID).toBe('12345');
    expect(validateEnv(baseConfig()).AUTH_BYPASS_GITHUB_USER_ID).toMatch(/^\d+$/);
  });

  it('rejects a non-numeric AUTH_BYPASS_GITHUB_USER_ID', () => {
    expect(() => validateEnv(baseConfig({ AUTH_BYPASS_GITHUB_USER_ID: 'octocat' }))).toThrow(/inválida/);
  });

  it('rejects the bypass with a synthetic GitHub identity in production (HU62)', () => {
    expect(() =>
      validateEnv(
        baseConfig({
          NODE_ENV: 'production',
          AUTH_BYPASS_ENABLED: 'true',
          AUTH_BYPASS_GITHUB_USER_ID: '12345',
        }),
      ),
    ).toThrow(/DEC-WEB-AUTH-001/);
  });
});
