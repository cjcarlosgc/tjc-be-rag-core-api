import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { echoEnvValue, retiredLlmVariablesIn, validateEnv } from './env.validation.js';

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

    it('fails at startup when LLM_MODEL is empty or only spaces, with a clear message (F1, WI-CORE-076)', () => {
      for (const value of ['', '   ']) {
        expect(() => validateEnv(baseConfig({ LLM_MODEL: value }))).toThrow(
          'Configuración de entorno inválida: LLM_MODEL no puede estar vacío; si no lo define se usa el valor por defecto gpt-6-luna.',
        );
      }
    });

    it('uses the default gpt-6-luna when LLM_MODEL is not defined (F1, WI-CORE-076)', () => {
      expect(validateEnv(baseConfig()).LLM_MODEL).toBe('gpt-6-luna');
    });

    it('accepts a valid LLM_MODEL and stores it without surrounding spaces (F1, WI-CORE-076)', () => {
      expect(validateEnv(baseConfig({ LLM_MODEL: 'gpt-6-luna-mini' })).LLM_MODEL).toBe('gpt-6-luna-mini');
      expect(validateEnv(baseConfig({ LLM_MODEL: ' gpt-6-luna ' })).LLM_MODEL).toBe('gpt-6-luna');
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

describe('SANDBOX_POLL_* al arrancar (WI-CORE-077)', () => {
  const POLL_RETRIES_ERROR = /SANDBOX_POLL_RETRIES/;
  const POLL_DELAY_ERROR = /SANDBOX_POLL_RETRY_DELAY_MS/;

  it('uses the defaults 3 and 500 when the variables are absent', () => {
    const result = validateEnv(baseConfig());
    expect(result.SANDBOX_POLL_RETRIES).toBe(3);
    expect(result.SANDBOX_POLL_RETRY_DELAY_MS).toBe(500);
  });

  it('accepts the valid bounds and stores them as numbers', () => {
    const low = validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: '0', SANDBOX_POLL_RETRY_DELAY_MS: '1' }));
    expect(low.SANDBOX_POLL_RETRIES).toBe(0);
    expect(low.SANDBOX_POLL_RETRY_DELAY_MS).toBe(1);
    const high = validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: '10', SANDBOX_POLL_RETRY_DELAY_MS: '30000' }));
    expect(high.SANDBOX_POLL_RETRIES).toBe(10);
    expect(high.SANDBOX_POLL_RETRY_DELAY_MS).toBe(30_000);
  });

  it('trims surrounding spaces of valid values', () => {
    const result = validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: ' 5 ', SANDBOX_POLL_RETRY_DELAY_MS: ' 1000 ' }));
    expect(result.SANDBOX_POLL_RETRIES).toBe(5);
    expect(result.SANDBOX_POLL_RETRY_DELAY_MS).toBe(1000);
  });

  it('fails when a value is not numeric', () => {
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: 'abc' }))).toThrow(
      'Configuración de entorno inválida: SANDBOX_POLL_RETRIES="abc" no es válido; debe ser un entero entre 0 y 10.',
    );
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRY_DELAY_MS: 'abc' }))).toThrow(
      'Configuración de entorno inválida: SANDBOX_POLL_RETRY_DELAY_MS="abc" no es válido; debe ser un entero entre 1 y 30000 (ms).',
    );
  });

  it('fails when a value is empty or only spaces, and does not treat it as absent', () => {
    for (const value of ['', '   ']) {
      expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: value }))).toThrow(
        'Configuración de entorno inválida: SANDBOX_POLL_RETRIES no puede estar vacío; si no la define se usa el valor por defecto 3.',
      );
      expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRY_DELAY_MS: value }))).toThrow(
        'Configuración de entorno inválida: SANDBOX_POLL_RETRY_DELAY_MS no puede estar vacío; si no la define se usa el valor por defecto 500.',
      );
    }
  });

  it('fails for negative, decimal, signed and scientific or hexadecimal notation', () => {
    for (const value of ['-1', '2.5', '+3', '1e3', '0x10']) {
      expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: value }))).toThrow(POLL_RETRIES_ERROR);
      expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRY_DELAY_MS: value }))).toThrow(POLL_DELAY_ERROR);
    }
  });

  it('fails for absurd values out of range (retries 11, delay 0 and 30001, and huge numbers)', () => {
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: '11' }))).toThrow(
      'SANDBOX_POLL_RETRIES="11" no es válido; debe ser un entero entre 0 y 10.',
    );
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: '999999' }))).toThrow(POLL_RETRIES_ERROR);
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: '99999999999999999999999' }))).toThrow(POLL_RETRIES_ERROR);
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRY_DELAY_MS: '0' }))).toThrow(
      'SANDBOX_POLL_RETRY_DELAY_MS="0" no es válido; debe ser un entero entre 1 y 30000 (ms).',
    );
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRY_DELAY_MS: '30001' }))).toThrow(POLL_DELAY_ERROR);
  });

  it('truncates the echoed value to 40 characters', () => {
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: 'x'.repeat(60) }))).toThrow(
      `SANDBOX_POLL_RETRIES="${'x'.repeat(40)}" no es`,
    );
  });

  it('does not expose secrets in the error message', () => {
    try {
      validateEnv(baseConfig({ SUPABASE_SECRET_KEY: 'sb-secreto-123', SANDBOX_POLL_RETRIES: 'abc' }));
      throw new Error('se esperaba un error');
    } catch (error) {
      expect((error as Error).message).toContain('SANDBOX_POLL_RETRIES="abc"');
      expect((error as Error).message).not.toContain('sb-secreto-123');
    }
  });

  it('exposes the normalized numeric value through ConfigService.get', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validate: () => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: ' 5 ', SANDBOX_POLL_RETRY_DELAY_MS: '1000' })),
        }),
      ],
    }).compile();
    const config = moduleRef.get(ConfigService);
    expect(config.get<number>('SANDBOX_POLL_RETRIES')).toBe(5);
    expect(config.get<number>('SANDBOX_POLL_RETRY_DELAY_MS')).toBe(1000);
    await moduleRef.close();
  });
});

describe('echoEnvValue (WI-CORE-078)', () => {
  it('returns normal values unchanged between quotes', () => {
    expect(echoEnvValue('abc')).toBe('"abc"');
    expect(echoEnvValue('x'.repeat(40))).toBe(`"${'x'.repeat(40)}"`);
  });

  it('escapes quotes and backslashes', () => {
    expect(echoEnvValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it('escapes line breaks, tabs and C0 control characters', () => {
    expect(echoEnvValue('a\nb\r\tc')).toBe('"a\\nb\\r\\tc"');
    expect(echoEnvValue('\u0001')).toBe('"\\u0001"');
  });

  it('escapes C1 controls, DEL, U+2028 and U+2029 that JSON.stringify leaves raw', () => {
    expect(echoEnvValue('\u007f')).toBe('"\\u007f"');
    expect(echoEnvValue('\u0085')).toBe('"\\u0085"');
    expect(echoEnvValue('\u009f')).toBe('"\\u009f"');
    expect(echoEnvValue('\u2028')).toBe('"\\u2028"');
    expect(echoEnvValue('\u2029')).toBe('"\\u2029"');
  });

  it('keeps printable Unicode such as accents and emoji intact', () => {
    expect(echoEnvValue('año 🚀')).toBe('"año 🚀"');
  });

  it('escapes a lone surrogate', () => {
    expect(echoEnvValue('\ud800')).toBe('"\\ud800"');
  });

  it('truncates to 40 code points (not code units) before escaping', () => {
    expect(echoEnvValue('😀'.repeat(41))).toBe(`"${'😀'.repeat(40)}"`);
  });

  it('never cuts an escape sequence in half at the 40-character boundary', () => {
    expect(echoEnvValue(`${'x'.repeat(39)}\ny`)).toBe(`"${'x'.repeat(39)}\\n"`);
    expect(echoEnvValue(`${'x'.repeat(38)}\nzz`)).toBe(`"${'x'.repeat(38)}\\nz"`);
  });
});

describe('mensajes de eco en validateEnv (WI-CORE-078)', () => {
  it('escapes the echoed LLM_REASONING_EFFORT so the message stays on one line', () => {
    let message = '';
    try {
      validateEnv(baseConfig({ LLM_REASONING_EFFORT: 'ul\ntra"' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('LLM_REASONING_EFFORT="ul\\ntra\\"" no es un esfuerzo válido');
    expect(message).not.toMatch(/[\n\r\u0085\u2028\u2029]/);
  });

  it('escapes the echoed SANDBOX_POLL_RETRIES value', () => {
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: 'a"b\\c' }))).toThrow(
      `SANDBOX_POLL_RETRIES=${echoEnvValue('a"b\\c')} no es válido`,
    );
    expect(() => validateEnv(baseConfig({ SANDBOX_POLL_RETRIES: 'a"b' }))).toThrow(
      'SANDBOX_POLL_RETRIES="a\\"b" no es válido',
    );
  });
});

describe('SANDBOX_MAX_POLL_ATTEMPTS y SANDBOX_REQUEST_TIMEOUT_MS (WI-CORE-078)', () => {
  const ATTEMPTS_RANGE = 'debe ser un entero entre 1 y 600.';
  const TIMEOUT_RANGE = 'debe ser un entero entre 100 y 60000 (ms).';

  it('uses the defaults when the variables are absent', () => {
    const result = validateEnv(baseConfig());
    expect(result.SANDBOX_MAX_POLL_ATTEMPTS).toBe(120);
    expect(result.SANDBOX_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('accepts the bounds and stores them as numbers', () => {
    const low = validateEnv(baseConfig({ SANDBOX_MAX_POLL_ATTEMPTS: '1', SANDBOX_REQUEST_TIMEOUT_MS: '100' }));
    expect(low.SANDBOX_MAX_POLL_ATTEMPTS).toBe(1);
    expect(low.SANDBOX_REQUEST_TIMEOUT_MS).toBe(100);
    const high = validateEnv(baseConfig({ SANDBOX_MAX_POLL_ATTEMPTS: '600', SANDBOX_REQUEST_TIMEOUT_MS: '60000' }));
    expect(high.SANDBOX_MAX_POLL_ATTEMPTS).toBe(600);
    expect(high.SANDBOX_REQUEST_TIMEOUT_MS).toBe(60_000);
  });

  it('trims surrounding spaces of valid values', () => {
    const result = validateEnv(baseConfig({ SANDBOX_MAX_POLL_ATTEMPTS: ' 120 ', SANDBOX_REQUEST_TIMEOUT_MS: ' 10000 ' }));
    expect(result.SANDBOX_MAX_POLL_ATTEMPTS).toBe(120);
    expect(result.SANDBOX_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('fails with the exact message when a value is out of range or not a plain integer', () => {
    for (const value of ['0', '601', '-1', '2.5', '+3', '1e3', '0x10', '10s', '10_000', 'abc', '99999999999999999999999']) {
      expect(() => validateEnv(baseConfig({ SANDBOX_MAX_POLL_ATTEMPTS: value }))).toThrow(
        `Configuración de entorno inválida: SANDBOX_MAX_POLL_ATTEMPTS=${echoEnvValue(value)} no es válido; ${ATTEMPTS_RANGE}`,
      );
    }
    for (const value of ['99', '60001', '0', '100.5', '1e3', '0x10', '+3', 'abc', '99999999999999999999999']) {
      expect(() => validateEnv(baseConfig({ SANDBOX_REQUEST_TIMEOUT_MS: value }))).toThrow(
        `Configuración de entorno inválida: SANDBOX_REQUEST_TIMEOUT_MS=${echoEnvValue(value)} no es válido; ${TIMEOUT_RANGE}`,
      );
    }
  });

  it('fails when a value is empty or only spaces, and does not treat it as absent', () => {
    for (const value of ['', '   ']) {
      expect(() => validateEnv(baseConfig({ SANDBOX_MAX_POLL_ATTEMPTS: value }))).toThrow(
        'Configuración de entorno inválida: SANDBOX_MAX_POLL_ATTEMPTS no puede estar vacío; si no la define se usa el valor por defecto 120.',
      );
      expect(() => validateEnv(baseConfig({ SANDBOX_REQUEST_TIMEOUT_MS: value }))).toThrow(
        'Configuración de entorno inválida: SANDBOX_REQUEST_TIMEOUT_MS no puede estar vacío; si no la define se usa el valor por defecto 10000.',
      );
    }
  });

  it('truncates the echoed value to 40 characters', () => {
    expect(() => validateEnv(baseConfig({ SANDBOX_MAX_POLL_ATTEMPTS: 'x'.repeat(60) }))).toThrow(
      `SANDBOX_MAX_POLL_ATTEMPTS="${'x'.repeat(40)}" no es`,
    );
    expect(() => validateEnv(baseConfig({ SANDBOX_REQUEST_TIMEOUT_MS: 'x'.repeat(60) }))).toThrow(
      `SANDBOX_REQUEST_TIMEOUT_MS="${'x'.repeat(40)}" no es`,
    );
  });

  it('does not expose secrets in the error messages', () => {
    try {
      validateEnv(baseConfig({ SUPABASE_SECRET_KEY: 'sb-secreto-456', SANDBOX_REQUEST_TIMEOUT_MS: 'abc' }));
      throw new Error('se esperaba un error');
    } catch (error) {
      expect((error as Error).message).toContain('SANDBOX_REQUEST_TIMEOUT_MS="abc"');
      expect((error as Error).message).not.toContain('sb-secreto-456');
    }
  });

  it('exposes the normalized numeric values through ConfigService.get', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validate: () => validateEnv(baseConfig({ SANDBOX_MAX_POLL_ATTEMPTS: ' 600 ', SANDBOX_REQUEST_TIMEOUT_MS: '60000' })),
        }),
      ],
    }).compile();
    const config = moduleRef.get(ConfigService);
    expect(config.get<number>('SANDBOX_MAX_POLL_ATTEMPTS')).toBe(600);
    expect(config.get<number>('SANDBOX_REQUEST_TIMEOUT_MS')).toBe(60_000);
    await moduleRef.close();
  });
});

describe('RETRIEVAL_* por capas (WI-CORE-103)', () => {
  it('uses the defaults LAYERED, 0.6, 4000 and 2000 when the variables are absent', () => {
    const result = validateEnv(baseConfig());

    expect(result.RETRIEVAL_CONTEXT_STRATEGY).toBe('LAYERED');
    expect(result.RETRIEVAL_RELEVANCE_THRESHOLD).toBe(0.6);
    expect(result.RETRIEVAL_DECLARING_CLASS_MAX_TOKENS).toBe(4000);
    expect(result.RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS).toBe(2000);
  });

  it('accepts valid values and converts the numeric ones', () => {
    const result = validateEnv(
      baseConfig({
        RETRIEVAL_CONTEXT_STRATEGY: 'RANKED',
        RETRIEVAL_RELEVANCE_THRESHOLD: '0.75',
        RETRIEVAL_DECLARING_CLASS_MAX_TOKENS: '0',
        RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS: '1500',
      }),
    );

    expect(result.RETRIEVAL_CONTEXT_STRATEGY).toBe('RANKED');
    expect(result.RETRIEVAL_RELEVANCE_THRESHOLD).toBe(0.75);
    expect(result.RETRIEVAL_DECLARING_CLASS_MAX_TOKENS).toBe(0);
    expect(result.RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS).toBe(1500);
  });

  it('accepts the threshold bounds 0 and 1', () => {
    expect(() => validateEnv(baseConfig({ RETRIEVAL_RELEVANCE_THRESHOLD: 0 }))).not.toThrow();
    expect(() => validateEnv(baseConfig({ RETRIEVAL_RELEVANCE_THRESHOLD: 1 }))).not.toThrow();
  });

  it('rejects an unknown strategy', () => {
    expect(() => validateEnv(baseConfig({ RETRIEVAL_CONTEXT_STRATEGY: 'layered' }))).toThrow(/inválida/);
    expect(() => validateEnv(baseConfig({ RETRIEVAL_CONTEXT_STRATEGY: 'OTHER' }))).toThrow(/inválida/);
  });

  it('rejects a threshold outside 0..1 or not numeric', () => {
    expect(() => validateEnv(baseConfig({ RETRIEVAL_RELEVANCE_THRESHOLD: 1.1 }))).toThrow(/inválida/);
    expect(() => validateEnv(baseConfig({ RETRIEVAL_RELEVANCE_THRESHOLD: -0.1 }))).toThrow(/inválida/);
    expect(() => validateEnv(baseConfig({ RETRIEVAL_RELEVANCE_THRESHOLD: 'abc' }))).toThrow(/inválida/);
  });

  it('rejects negative or non-integer layer caps', () => {
    for (const name of ['RETRIEVAL_DECLARING_CLASS_MAX_TOKENS', 'RETRIEVAL_TARGET_EVIDENCE_MAX_TOKENS']) {
      expect(() => validateEnv(baseConfig({ [name]: -1 }))).toThrow(/inválida/);
      expect(() => validateEnv(baseConfig({ [name]: 1.5 }))).toThrow(/inválida/);
      expect(() => validateEnv(baseConfig({ [name]: 'abc' }))).toThrow(/inválida/);
    }
  });
});
