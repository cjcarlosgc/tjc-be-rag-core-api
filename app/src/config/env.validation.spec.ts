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
});
