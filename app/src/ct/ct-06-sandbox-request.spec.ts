import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SandboxAcceptedExecutionError,
  SandboxExecutionService,
  SandboxUnavailableError,
} from '../sandbox/sandbox-execution.service.js';
import type { SandboxExecutionRequest } from '../sandbox/sandbox.types.js';

/**
 * CT-06 (petición Core → Sandbox, INTEROP-2.17):
 *  - CT-06-A3: el request no contiene token, credenciales Git ni secretos.
 *  - CT-06-A4: la respuesta aceptada trae `executionId` y queda ligada a la petición de Core (la asociación
 *    persistente al Run, `upsertExecution`, la cubre `analysis-run-validation-job.handler.spec.ts`:
 *    «upserts the proposal by symbol and records the accepted execution with the attempt of the run»).
 *  - CT-06-A5: perfil no soportado/job inválido → 400 del Sandbox sin reintento; fallo transitorio del sondeo →
 *    reintento; fallo del POST → `SandboxUnavailableError` sin reintento (el resto de la resiliencia está en
 *    `sandbox-execution.resilience.spec.ts`).
 */

const examples = resolve(__dirname, '../../../spec/contracts/schemas/examples');
const load = <T = Record<string, unknown>>(name: string): T =>
  JSON.parse(readFileSync(resolve(examples, name), 'utf8')) as T;

const SERVICE_TOKEN = 'SBX-CANARY-service-token-9f3a7c1e';

function configService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    SANDBOX_URL: 'http://sandbox.local',
    SANDBOX_SERVICE_TOKEN: SERVICE_TOKEN,
    SANDBOX_DOWNLOAD_TTL_SECONDS: 300,
    SANDBOX_REQUEST_TIMEOUT_MS: 5000,
    SANDBOX_MAX_POLL_ATTEMPTS: 5,
    SANDBOX_POLL_RETRIES: 2,
    SANDBOX_POLL_RETRY_DELAY_MS: 1,
    ...overrides,
  };
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as never;
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const httpError = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response;

const objectStorage = () => ({
  put: vi.fn().mockResolvedValue(undefined),
  presignGet: vi.fn().mockResolvedValue('https://signed.example/download?sig=opaque-signature'),
});

const baseRequest = (overrides: Partial<SandboxExecutionRequest> = {}): SandboxExecutionRequest => ({
  requestId: 'request-1',
  testRunId: 'run-1',
  projectVersionId: 'version-1',
  snapshotKey: 'snapshot-key',
  snapshotBuffer: Buffer.from('zip-bytes'),
  artifacts: [
    { artifactId: 'artifact-1', relativePath: 'src/foo.spec.ts', artifactType: 'CREATED', content: Buffer.from('it()') },
  ],
  scope: 'TARGET',
  targetIds: ['target-1'],
  runnerHint: 'VITEST',
  ...overrides,
});

/** Claves que delatan una credencial; el contrato del request no tiene ninguna. */
const SECRET_KEY = /token|secret|passw(or)?d|credential|authorization|api[-_]?key|private[-_]?key|bearer|cookie|x-access/i;
/** Valores que delatan una credencial o un token de Git/proveedor. */
const SECRET_VALUES: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /x-access-token/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+\S+/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /:\/\/[^/\s:@]+:[^/\s@]+@/,
  /SBX-CANARY/,
];

/** Hallazgos de secretos en un JSON ya parseado: claves sospechosas, valores sospechosos o URLs con userinfo. */
function findSecrets(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') {
    const hits = SECRET_VALUES.filter((pattern) => pattern.test(value)).map((pattern) => `${path} ~ ${pattern}`);
    if (/^https?:\/\//.test(value)) {
      const parsed = new URL(value);
      if (parsed.username !== '' || parsed.password !== '') hits.push(`${path} contiene userinfo en la URL`);
    }
    return hits;
  }
  if (Array.isArray(value)) return value.flatMap((entry, index) => findSecrets(entry, `${path}[${index}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => [
      ...(SECRET_KEY.test(key) ? [`${path}.${key} (clave sospechosa)`] : []),
      ...findSecrets(entry, `${path}.${key}`),
    ]);
  }
  return [];
}

describe('CT-06 request al Sandbox', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('CT-06-A3: el detector de secretos de esta prueba reconoce claves y valores de credenciales (control negativo)', () => {
    expect(findSecrets({ token: 'x' })).not.toEqual([]);
    expect(findSecrets({ repo: 'https://user:pw@github.com/org/repo.git' })).not.toEqual([]);
    expect(findSecrets({ note: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' })).not.toEqual([]);
    expect(findSecrets({ note: `Bearer ${SERVICE_TOKEN}` })).not.toEqual([]);
    expect(findSecrets({ snapshot: { url: 'https://signed.example/download?sig=opaque', sizeBytes: 1 } })).toEqual([]);
  });

  it.each([
    ['NODE_TYPESCRIPT (VITEST)', baseRequest()],
    [
      'PHP_LARAVEL_PHPUNIT (PHPUNIT con projectRoot)',
      baseRequest({ runnerHint: 'PHPUNIT', projectRoot: 'apps/api', executionProfile: 'PHP_LARAVEL_PHPUNIT' }),
    ],
  ])(
    'CT-06-A3: el POST /executions real (%s) no lleva token, credenciales Git ni secretos en su cuerpo',
    async (_label, request) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(ok({ executionId: 'exec-1', pollAfterMs: 1 }))
        .mockResolvedValueOnce(ok({ status: 'COMPLETED' }))
        .mockResolvedValueOnce(ok({ status: 'COMPLETED', facts: null, failure: null, stageDurations: [] }));
      vi.stubGlobal('fetch', fetchMock);

      await new SandboxExecutionService(configService(), objectStorage() as never).execute(request);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const serializedBody = init.body as string;
      const body = JSON.parse(serializedBody) as Record<string, unknown>;

      expect(url).toBe('http://sandbox.local/executions');
      expect(findSecrets(body)).toEqual([]);
      expect(serializedBody).not.toContain(SERVICE_TOKEN);
      // El cuerpo es exactamente el contrato de creación: ningún campo extra por donde colar secretos.
      expect(Object.keys(body).sort()).toEqual(
        [
          'artifacts',
          'executionProfile',
          'projectVersionId',
          'requestId',
          'runnerHint',
          'scope',
          'snapshot',
          'targetIds',
          'testRunId',
          ...(request.projectRoot === undefined ? [] : ['projectRoot']),
        ].sort(),
      );
      // Las únicas referencias de descarga son temporales y no llevan datos de acceso a Git.
      const snapshot = body.snapshot as Record<string, unknown>;
      expect(Object.keys(snapshot).sort()).toEqual(['expiresAt', 'role', 'sha256', 'sizeBytes', 'url']);
      // La autenticación servicio a servicio viaja solo en la cabecera Authorization (DEC-AUTH-001), nunca en el cuerpo.
      const headers = init.headers as Record<string, string>;
      expect(Object.keys(headers).sort()).toEqual(['authorization', 'content-type', 'idempotency-key', 'x-correlation-id']);
      expect(headers.authorization).toBe(`Bearer ${SERVICE_TOKEN}`);
      expect(headers['idempotency-key']).toBe(request.requestId);
    },
  );

  it('CT-06-A3: el ejemplo canónico del contrato (CreateSandboxExecutionRequest) tampoco contiene secretos', () => {
    for (const name of ['sandbox-create-request.node.json', 'sandbox-create-request.php.json']) {
      expect(findSecrets(load(name)), name).toEqual([]);
    }
  });

  it('CT-06-A4: la respuesta aceptada trae el executionId del contrato y Core lo usa para consultar esa ejecución y devolverlo ligado a su requestId', async () => {
    const accepted = { ...load<{ executionId: string }>('sandbox-accepted.json'), pollAfterMs: 1 };
    const result = load('sandbox-result.completed.json');
    expect(accepted.executionId).toEqual(expect.any(String));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(accepted))
      .mockResolvedValueOnce(ok({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(ok(result));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await new SandboxExecutionService(configService(), objectStorage() as never).execute(
      baseRequest({ requestId: 'request-A4' }),
    );

    expect(outcome.executionId).toBe(accepted.executionId);
    expect(outcome.requestId).toBe('request-A4');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'idempotency-key': 'request-A4' });
    expect(fetchMock.mock.calls[1][0]).toBe(`http://sandbox.local/executions/${accepted.executionId}`);
    expect(fetchMock.mock.calls[2][0]).toBe(`http://sandbox.local/executions/${accepted.executionId}/result`);
  });

  it.each([400, 422])(
    'CT-06-A5: un %s del Sandbox al crear (perfil no soportado o job inválido) es un SandboxUnavailableError no transitorio y no se reintenta',
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(httpError(status));
      vi.stubGlobal('fetch', fetchMock);

      const error = await new SandboxExecutionService(configService(), objectStorage() as never)
        .execute(baseRequest({ executionProfile: 'UNSUPPORTED_PROFILE' as never }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SandboxUnavailableError);
      expect(error).not.toBeInstanceOf(SandboxAcceptedExecutionError);
      expect((error as SandboxUnavailableError).transient).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Core no repara el perfil en silencio: lo que rechaza el Sandbox es lo que Core envió.
      expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
        executionProfile: 'UNSUPPORTED_PROFILE',
      });
    },
  );

  it.each([
    ['503 transitorio', () => httpError(503)],
    ['fallo de red', () => Promise.reject(new Error('ECONNRESET'))],
  ])('CT-06-A5: un %s en el POST de creación falla con SandboxUnavailableError sin reintentar', async (_label, failure) => {
    const fetchMock = vi.fn().mockImplementation(async () => failure());
    vi.stubGlobal('fetch', fetchMock);

    const error = await new SandboxExecutionService(configService(), objectStorage() as never)
      .execute(baseRequest())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SandboxUnavailableError);
    expect(error).not.toBeInstanceOf(SandboxAcceptedExecutionError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('CT-06-A5: un 429 transitorio al sondear el estado se reintenta y la ejecución termina; un 400 al sondear no se reintenta', async () => {
    const retried = vi
      .fn()
      .mockResolvedValueOnce(ok({ executionId: 'exec-1', pollAfterMs: 1 }))
      .mockResolvedValueOnce(httpError(429))
      .mockResolvedValueOnce(ok({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(ok({ status: 'COMPLETED', facts: null, failure: null, stageDurations: [] }));
    vi.stubGlobal('fetch', retried);
    const service = new SandboxExecutionService(configService(), objectStorage() as never);

    await expect(service.execute(baseRequest())).resolves.toMatchObject({ status: 'COMPLETED', executionId: 'exec-1' });
    expect(retried).toHaveBeenCalledTimes(4);
    expect(service.transientRetriesByOperation).toEqual({ status: 1, result: 0 });

    const notRetried = vi
      .fn()
      .mockResolvedValueOnce(ok({ executionId: 'exec-2', pollAfterMs: 1 }))
      .mockResolvedValueOnce(httpError(400));
    vi.stubGlobal('fetch', notRetried);

    const error = await service.execute(baseRequest()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SandboxAcceptedExecutionError);
    expect((error as SandboxAcceptedExecutionError).executionId).toBe('exec-2');
    expect(notRetried).toHaveBeenCalledTimes(2);
  });
});
