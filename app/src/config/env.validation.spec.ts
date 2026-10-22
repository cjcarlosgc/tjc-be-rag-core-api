import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { retiredLlmVariablesIn, validateEnv } from './env.validation.js';

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'secret',
    SUPABASE_STORAGE_BUCKET: 'bucket',
    LLM_REASONING_EFFORT: 'low',
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
        baseConfig({ SANDBOX_URL: 'http://localhost:3001', SANDBOX_SERVICE_TOKEN: 'token' }),
      ),
    ).not.toThrow();
  });

  it('rejects SANDBOX_URL set without SANDBOX_SERVICE_TOKEN (DEC-AUTH-001)', () => {
    expect(() => validateEnv(baseConfig({ SANDBOX_URL: 'http://localhost:3001' }))).toThrow(
      /DEC-AUTH-001/,
    );
  });

  it('rejects SANDBOX_SERVICE_TOKEN set without SANDBOX_URL (DEC-AUTH-001)', () => {
    expect(() => validateEnv(baseConfig({ SANDBOX_SERVICE_TOKEN: 'token' }))).toThrow(
      /DEC-AUTH-001/,
    );
  });

  it('accepts GitHub Integration URL and both service tokens together', () => {
    expect(() =>
      validateEnv(baseConfig({
        GITHUB_INTEGRATION_API_BASE_URL: 'https://github-integration.local',
        CORE_TO_GITHUB_INTEGRATION_TOKEN: 'core-token',
        GITHUB_INTEGRATION_TO_CORE_TOKEN: 'gh-token',
        GITHUB_BINDING_EVIDENCE_SECRET: 'test-only-github-binding-evidence-secret',
      })),
    ).not.toThrow();
  });

  it('rejects partial GitHub Integration configuration', () => {
    expect(() => validateEnv(baseConfig({ CORE_TO_GITHUB_INTEGRATION_TOKEN: 'core-token' }))).toThrow(
      /GITHUB_INTEGRATION_API_BASE_URL y ambos tokens internos/,
    );
  });

  it('keeps GitHub Integration optional in local configs', () => {
    expect(() => validateEnv(baseConfig())).not.toThrow();
  });

  it('requires a scoped binding-evidence key and HTTPS for configured remote Integration', () => {
    expect(() => validateEnv(baseConfig({
      GITHUB_INTEGRATION_API_BASE_URL: 'https://github-integration.local',
      CORE_TO_GITHUB_INTEGRATION_TOKEN: 'core-token',
      GITHUB_INTEGRATION_TO_CORE_TOKEN: 'gh-token',
    }))).toThrow(/GITHUB_BINDING_EVIDENCE_SECRET es obligatorio/);

    expect(() => validateEnv(baseConfig({
      GITHUB_INTEGRATION_API_BASE_URL: 'http://integration.internal',
      CORE_TO_GITHUB_INTEGRATION_TOKEN: 'core-token',
      GITHUB_INTEGRATION_TO_CORE_TOKEN: 'gh-token',
      GITHUB_BINDING_EVIDENCE_SECRET: 'test-only-github-binding-evidence-secret',
    }))).toThrow(/debe usar HTTPS/);
  });

  it('allows loopback HTTP for local Integration but rejects it in production', () => {
    const local = baseConfig({
      GITHUB_INTEGRATION_API_BASE_URL: 'http://localhost:3002',
      CORE_TO_GITHUB_INTEGRATION_TOKEN: 'core-token',
      GITHUB_INTEGRATION_TO_CORE_TOKEN: 'gh-token',
      GITHUB_BINDING_EVIDENCE_SECRET: 'test-only-github-binding-evidence-secret',
    });
    expect(() => validateEnv(local)).not.toThrow();
    expect(() => validateEnv({ ...local, NODE_ENV: 'production' })).toThrow(/debe usar HTTPS/);
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

  it('configures the access jobs (HU61): reconciliation on by default, hourly, with budget, concurrency and stale-lock threshold', () => {
    const result = validateEnv(baseConfig());

    expect(result).toMatchObject({
      ACCESS_RECONCILIATION_ENABLED: true,
      ACCESS_RECONCILIATION_INTERVAL_MS: 3_600_000,
      ACCESS_RECONCILIATION_BUDGET: 500,
      ACCESS_RECONCILIATION_CONCURRENCY: 5,
      JOBS_STALE_LOCK_MS: 600_000,
    });
  });

  it('defaults the job lock heartbeat to 60 s and accepts it while it is at most JOBS_STALE_LOCK_MS / 3 (WI-CORE-030)', () => {
    expect(validateEnv(baseConfig()).JOBS_HEARTBEAT_INTERVAL_MS).toBe(60_000);
    expect(
      validateEnv(baseConfig({ JOBS_STALE_LOCK_MS: 180_000, JOBS_HEARTBEAT_INTERVAL_MS: 60_000 })).JOBS_HEARTBEAT_INTERVAL_MS,
    ).toBe(60_000);
    expect(() =>
      validateEnv(baseConfig({ JOBS_STALE_LOCK_MS: 180_000, JOBS_HEARTBEAT_INTERVAL_MS: 60_000 })),
    ).not.toThrow();
  });

  it('rejects a job lock heartbeat above JOBS_STALE_LOCK_MS / 3 (WI-CORE-030, DEC-JOBS-002)', () => {
    expect(() =>
      validateEnv(baseConfig({ JOBS_STALE_LOCK_MS: 120_000, JOBS_HEARTBEAT_INTERVAL_MS: 60_000 })),
    ).toThrow(/JOBS_HEARTBEAT_INTERVAL_MS debe ser ≤ JOBS_STALE_LOCK_MS \/ 3/);
    expect(() => validateEnv(baseConfig({ JOBS_HEARTBEAT_INTERVAL_MS: 200_000 }))).not.toThrow(); // 3 × 200 000 = 600 000 (default)
    expect(() => validateEnv(baseConfig({ JOBS_HEARTBEAT_INTERVAL_MS: 200_001 }))).toThrow(/JOBS_HEARTBEAT_INTERVAL_MS/);
  });

  it('rejects a job lock heartbeat below the 1 s minimum', () => {
    expect(() => validateEnv(baseConfig({ JOBS_HEARTBEAT_INTERVAL_MS: 500 }))).toThrow(/inválida/);
  });

  it('turns the reconciliation off only with an explicit "false"', () => {
    expect(validateEnv(baseConfig({ ACCESS_RECONCILIATION_ENABLED: 'false' })).ACCESS_RECONCILIATION_ENABLED).toBe(false);
    expect(validateEnv(baseConfig({ ACCESS_RECONCILIATION_ENABLED: 'true' })).ACCESS_RECONCILIATION_ENABLED).toBe(true);
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

  describe('LLM_REASONING_EFFORT y configuración única del LLM (WI-CORE-076)', () => {
    it('fails at startup when LLM_REASONING_EFFORT is missing, empty or only spaces', () => {
      for (const value of [undefined, '', '   ']) {
        expect(() => validateEnv(baseConfig({ LLM_REASONING_EFFORT: value }))).toThrow(
          'Configuración de entorno inválida: LLM_REASONING_EFFORT es obligatorio y no tiene valor por defecto. Defínalo con uno de: none, minimal, low, medium, high, xhigh, max (low en pruebas, medium en evidencia oficial).',
        );
      }
    });

    it('fails at startup with an effort outside the reasoning scale and truncates the echoed value to 40 characters', () => {
      expect(() => validateEnv(baseConfig({ LLM_REASONING_EFFORT: 'ultra' }))).toThrow(
        'Configuración de entorno inválida: LLM_REASONING_EFFORT="ultra" no es un esfuerzo válido; valores válidos: none, minimal, low, medium, high, xhigh, max.',
      );
      expect(() => validateEnv(baseConfig({ LLM_REASONING_EFFORT: 'HIGH' }))).toThrow(/"HIGH" no es un esfuerzo válido/);
      expect(() => validateEnv(baseConfig({ LLM_REASONING_EFFORT: 'x'.repeat(60) }))).toThrow(
        `LLM_REASONING_EFFORT="${'x'.repeat(40)}" no es`,
      );
    });

    it('accepts every value of the reasoning scale and stores it without surrounding spaces', () => {
      for (const value of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
        expect(validateEnv(baseConfig({ LLM_REASONING_EFFORT: value })).LLM_REASONING_EFFORT).toBe(value);
      }
      expect(validateEnv(baseConfig({ LLM_REASONING_EFFORT: ' medium ' })).LLM_REASONING_EFFORT).toBe('medium');
    });

    it('defaults LLM_MODEL to gpt-6-luna', () => {
      expect(validateEnv(baseConfig({ LLM_REASONING_EFFORT: 'low' })).LLM_MODEL).toBe('gpt-6-luna');
    });

    it('keeps validating EXPERIMENT_LLM_TEMPERATURE and EXPERIMENT_LLM_MAX_OUTPUT_TOKENS', () => {
      expect(() =>
        validateEnv(baseConfig({ LLM_REASONING_EFFORT: 'low', EXPERIMENT_LLM_TEMPERATURE: '3' })),
      ).toThrow(/EXPERIMENT_LLM_TEMPERATURE debe estar entre 0 y 2/);
      expect(() =>
        validateEnv(baseConfig({ LLM_REASONING_EFFORT: 'low', EXPERIMENT_LLM_MAX_OUTPUT_TOKENS: '0' })),
      ).toThrow(/EXPERIMENT_LLM_MAX_OUTPUT_TOKENS/);
    });

    it('warns once with the names of retired variables, never their values, and does not block startup', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      expect(() =>
        validateEnv(
          baseConfig({
            LLM_REASONING_EFFORT: 'low',
            EXPERIMENT_LLM_MODEL: 'secret-model-name',
            EXPERIMENT_LLM_REASONING_EFFORT: '',
            LLM_SUPPORTED_COMBINATIONS: '[{"model":"x","efforts":["low"],"toolEfforts":["low"]}]',
          }),
        ),
      ).not.toThrow();

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain(
        'EXPERIMENT_LLM_MODEL, EXPERIMENT_LLM_REASONING_EFFORT, LLM_SUPPORTED_COMBINATIONS siguen definidas y se IGNORAN',
      );
      expect(message).not.toContain('secret-model-name');
      expect(message).not.toContain('"model":"x"');
      warn.mockRestore();
    });

    it('does not warn when no retired variable is defined', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      validateEnv(baseConfig({ LLM_REASONING_EFFORT: 'low' }));

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('retiredLlmVariablesIn', () => {
    it('returns only the retired names present in the config, including empty values', () => {
      expect(retiredLlmVariablesIn({ LLM_MODEL: 'x' })).toEqual([]);
      expect(retiredLlmVariablesIn({ EXPERIMENT_LLM_REASONING_EFFORT: '' })).toEqual([
        'EXPERIMENT_LLM_REASONING_EFFORT',
      ]);
      expect(retiredLlmVariablesIn({ LLM_SUPPORTED_COMBINATIONS: undefined })).toEqual([]);
    });
  });

  describe('SANDBOX_URL (isAllowedSandboxUrl)', () => {
    const sandboxSecret = { SANDBOX_SERVICE_TOKEN: 'token' };
    const sandboxMessage = /SANDBOX_URL debe usar HTTPS; HTTP solo se permite en loopback fuera de producción, y no admite credenciales, ruta ni parámetros\./;

    it('accepts an HTTPS Sandbox URL in production with a token', () => {
      expect(() =>
        validateEnv(baseConfig({
          NODE_ENV: 'production',
          SANDBOX_URL: 'https://203-0-113-10.sslip.io',
          ...sandboxSecret,
        })),
      ).not.toThrow();
    });

    it('rejects a non-loopback HTTP Sandbox URL in production and outside production', () => {
      expect(() => validateEnv(baseConfig({
        NODE_ENV: 'production', SANDBOX_URL: 'http://sandbox.local', ...sandboxSecret,
      }))).toThrow(sandboxMessage);
      expect(() => validateEnv(baseConfig({
        NODE_ENV: 'development', SANDBOX_URL: 'http://sandbox.local', ...sandboxSecret,
      }))).toThrow(sandboxMessage);
    });

    it('accepts loopback HTTP Sandbox URLs outside production and rejects them in production', () => {
      for (const url of ['http://localhost:3001', 'http://127.0.0.1:3101', 'http://[::1]:3001']) {
        expect(() => validateEnv(baseConfig({ NODE_ENV: 'development', SANDBOX_URL: url, ...sandboxSecret }))).not.toThrow();
        expect(() => validateEnv(baseConfig({ NODE_ENV: 'production', SANDBOX_URL: url, ...sandboxSecret }))).toThrow(sandboxMessage);
      }
    });

    it('rejects Sandbox URLs with credentials, path or query', () => {
      for (const url of ['https://u:p@host.example', 'https://host.example/x', 'https://host.example/?a=1']) {
        expect(() => validateEnv(baseConfig({ NODE_ENV: 'production', SANDBOX_URL: url, ...sandboxSecret }))).toThrow(sandboxMessage);
      }
    });

    it('rejects an unparseable Sandbox URL', () => {
      expect(() => validateEnv(baseConfig({ SANDBOX_URL: 'no-es-url', ...sandboxSecret }))).toThrow(sandboxMessage);
    });

    it('keeps an unset SANDBOX_URL allowed', () => {
      expect(() => validateEnv(baseConfig({ NODE_ENV: 'production' }))).not.toThrow();
    });

    it('does not print the Sandbox URL value in the error', () => {
      const secretHost = 'https://secreto-host.example/ruta-secreta';
      try {
        validateEnv(baseConfig({ NODE_ENV: 'production', SANDBOX_URL: secretHost, ...sandboxSecret }));
        throw new Error('se esperaba un error');
      } catch (error) {
        expect((error as Error).message).not.toContain('secreto-host');
        expect((error as Error).message).not.toContain('ruta-secreta');
      }
    });
  });
});
