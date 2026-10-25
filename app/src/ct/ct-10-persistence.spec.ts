/**
 * CT-10 (WI-CORE-099): adapters de almacenamiento, embeddings y persistencia.
 *
 *  - CT-10-A1: el almacenamiento de artefactos se consume vía el puerto `ObjectStorageService` y el adapter Supabase
 *    cumple su contrato (put/get/delete/presignGet y errores).
 *  - CT-10-A2: los embeddings se consumen vía el puerto `EmbeddingProvider` (token `EMBEDDING_PROVIDER`) y el adapter
 *    de OpenAI cumple su contrato (orden, lotes, errores).
 *  - CT-10-A4 (reformulada, declaración G-06): un error de persistencia sale por el envelope como
 *    `500 INTERNAL_ERROR` con mensaje fijo y sin fuga de internals, y los conflictos que traducen los repositorios
 *    son errores tipados (FK, idempotencia, jobs).
 *
 * Ya cubierto en otros specs (se referencia, no se duplica): adapter Supabase (bucket, put/get/delete/presignGet en
 * `supabase-object-storage.adapter.spec.ts`), embeddings (orden y lotes en `openai-embedding.provider.spec.ts`),
 * consumidores con el puerto inyectado (`snapshot-analysis-job.handler.spec.ts`, `context-traces.service.spec.ts`).
 * Aquí se completan los errores del adapter, el consumo vía el puerto y la cadena de errores de persistencia.
 */
import { HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateContract } from '../contracts/contract-validator.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { CORRELATION_ID_HEADER } from '../common/middleware/correlation-id.middleware.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { FunctionalKnowledgeRepository } from '../functional-knowledge/functional-knowledge.repository.js';
import { FunctionalKnowledgeService } from '../functional-knowledge/functional-knowledge.service.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { ObjectStorageModule } from '../object-storage/object-storage.module.js';
import { EMBEDDING_PROVIDER } from '../providers/providers.constants.js';
import { ProvidersModule } from '../providers/providers.module.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FunctionalKnowledge, Job } from '../generated/prisma/client.js';

// ---------------------------------------------------------------------------------------------------------------
// Dobles de los SDK (solo `vi.mock`, que la regla de arquitectura de CT-10-A5 no cuenta como importación)
// ---------------------------------------------------------------------------------------------------------------

const uploadMock = vi.fn();
const downloadMock = vi.fn();
const removeMock = vi.fn();
const createSignedUrlMock = vi.fn();
const getBucketMock = vi.fn();
const createBucketMock = vi.fn();
const createClientMock = vi.fn();
const embeddingsCreateMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock('openai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: class FakeOpenAI {
    embeddings = { create: embeddingsCreateMock };
  },
}));

const { SupabaseObjectStorageAdapter } = await import('../object-storage/supabase-object-storage.adapter.js');
const { OpenAiEmbeddingProvider } = await import('../providers/openai-embedding.provider.js');

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET_KEY = 'sb-secret-DO-NOT-LEAK';
const CONFIG: Record<string, string> = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SECRET_KEY: SECRET_KEY,
  SUPABASE_STORAGE_BUCKET: 'repository-zips',
};

function makeStorageConfig() {
  return { getOrThrow: (key: string) => CONFIG[key] } as never;
}

function productionSources(): Array<{ file: string; content: string }> {
  const files: Array<{ file: string; content: string }> = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.ts') && !/\.(spec|e2e-spec)\.ts$/.test(entry)) {
        files.push({ file: relative(APP_ROOT, path).split(sep).join('/'), content: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(join(APP_ROOT, 'src'));
  return files.filter(({ file }) => !file.startsWith('src/generated/'));
}

// ---------------------------------------------------------------------------------------------------------------
// CT-10-A1: ObjectStorageService
// ---------------------------------------------------------------------------------------------------------------

describe('CT-10-A1: almacenamiento de artefactos vía ObjectStorageService', () => {
  beforeEach(() => {
    uploadMock.mockReset().mockResolvedValue({ error: null });
    downloadMock.mockReset();
    removeMock.mockReset().mockResolvedValue({ error: null });
    createSignedUrlMock.mockReset();
    getBucketMock.mockReset().mockResolvedValue({ data: { name: 'repository-zips' }, error: null });
    createBucketMock.mockReset();
    createClientMock.mockReset().mockImplementation(() => ({
      storage: {
        from: () => ({
          upload: uploadMock,
          download: downloadMock,
          remove: removeMock,
          createSignedUrl: createSignedUrlMock,
        }),
        getBucket: getBucketMock,
        createBucket: createBucketMock,
      },
    }));
  });

  it('CT-10-A1: el adapter Supabase implementa el puerto abstracto con las cuatro operaciones del contrato', () => {
    const adapter = new SupabaseObjectStorageAdapter(makeStorageConfig());

    expect(adapter).toBeInstanceOf(ObjectStorageService);
    for (const operation of ['put', 'get', 'delete', 'presignGet'] as const) {
      expect(typeof adapter[operation]).toBe('function');
    }
  });

  it('CT-10-A1: el adapter se crea con la URL y la clave de servicio de la configuración, sin sesión persistente', () => {
    new SupabaseObjectStorageAdapter(makeStorageConfig());

    expect(createClientMock).toHaveBeenCalledWith(CONFIG.SUPABASE_URL, SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it('CT-10-A1: put, get, delete y presignGet cumplen el contrato del puerto sobre un mismo objeto', async () => {
    const storage: ObjectStorageService = new SupabaseObjectStorageAdapter(makeStorageConfig());
    downloadMock.mockResolvedValue({
      data: { arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer },
      error: null,
    });
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/obj' }, error: null });

    await expect(storage.put('runs/1/artifact.zip', Buffer.from('zip'), 'application/zip')).resolves.toBeUndefined();
    await expect(storage.get('runs/1/artifact.zip')).resolves.toEqual(Buffer.from([7, 8, 9]));
    await expect(storage.presignGet('runs/1/artifact.zip', 120)).resolves.toBe('https://signed.example/obj');
    await expect(storage.delete('runs/1/artifact.zip')).resolves.toBeUndefined();

    expect(uploadMock).toHaveBeenCalledWith(
      'runs/1/artifact.zip',
      Buffer.from('zip'),
      expect.objectContaining({ contentType: 'application/zip', upsert: false }),
    );
    expect(createSignedUrlMock).toHaveBeenCalledWith('runs/1/artifact.zip', 120);
    expect(removeMock).toHaveBeenCalledWith(['runs/1/artifact.zip']);
  });

  it.each([
    ['put', (s: ObjectStorageService) => s.put('k.zip', Buffer.from('x')), () => uploadMock.mockResolvedValue({ error: { message: 'boom' } }), 'subir'],
    ['get (error)', (s: ObjectStorageService) => s.get('k.zip'), () => downloadMock.mockResolvedValue({ data: null, error: { message: 'boom' } }), 'descargar'],
    ['get (sin datos)', (s: ObjectStorageService) => s.get('k.zip'), () => downloadMock.mockResolvedValue({ data: null, error: null }), 'descargar'],
    ['delete', (s: ObjectStorageService) => s.delete('k.zip'), () => removeMock.mockResolvedValue({ error: { message: 'boom' } }), 'eliminar'],
    ['presignGet (error)', (s: ObjectStorageService) => s.presignGet('k.zip', 60), () => createSignedUrlMock.mockResolvedValue({ data: null, error: { message: 'boom' } }), 'URL firmada'],
    ['presignGet (sin datos)', (s: ObjectStorageService) => s.presignGet('k.zip', 60), () => createSignedUrlMock.mockResolvedValue({ data: null, error: null }), 'URL firmada'],
  ])('CT-10-A1: %s traduce el fallo del proveedor a un Error que nombra la clave y no filtra la clave de servicio', async (_name, call, arrange, verb) => {
    const storage: ObjectStorageService = new SupabaseObjectStorageAdapter(makeStorageConfig());
    arrange();

    const error = await call(storage).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('"k.zip"');
    expect((error as Error).message).toContain(verb);
    expect((error as Error).message).not.toContain(SECRET_KEY);
    expect((error as Error).message).not.toContain(CONFIG.SUPABASE_URL);
  });

  it('CT-10-A1: un fallo al asegurar el bucket impide cualquier operación sobre objetos', async () => {
    getBucketMock.mockResolvedValue({ data: null, error: { message: 'not found' } });
    createBucketMock.mockResolvedValue({ error: { message: 'permission denied' } });
    const storage: ObjectStorageService = new SupabaseObjectStorageAdapter(makeStorageConfig());

    await expect(storage.get('k.zip')).rejects.toThrow('No se pudo crear el bucket "repository-zips"');
    await expect(storage.presignGet('k.zip', 60)).rejects.toThrow('permission denied');
    expect(downloadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it('CT-10-A1: ObjectStorageModule vincula el puerto al adapter Supabase y lo exporta', () => {
    const providers = Reflect.getMetadata('providers', ObjectStorageModule) as Array<{
      provide: unknown;
      useClass: unknown;
    }>;

    expect(providers).toEqual([{ provide: ObjectStorageService, useClass: SupabaseObjectStorageAdapter }]);
    expect(Reflect.getMetadata('exports', ObjectStorageModule)).toEqual([ObjectStorageService]);
  });

  it('CT-10-A1: ningún consumidor de producción importa el adapter ni el SDK; todos reciben el puerto ObjectStorageService', () => {
    const sources = productionSources();
    const consumers = sources
      .filter(({ file, content }) => file !== 'src/object-storage/object-storage.module.ts' && /object-storage\.service\.js'/.test(content))
      .filter(({ file }) => !file.startsWith('src/object-storage/'));

    expect(consumers.map(({ file }) => file)).toEqual(
      expect.arrayContaining([
        'src/context-traces/context-traces.service.ts',
        'src/experiments/experiment-job.handler.ts',
        'src/publications/test-publication-job.handler.ts',
        'src/sandbox/sandbox-execution.service.ts',
        'src/snapshot-intelligence/snapshot-analysis-job.handler.ts',
        'src/validation/analysis-run-validation-job.handler.ts',
      ]),
    );
    for (const { file, content } of consumers) {
      expect(content, file).not.toMatch(/supabase-object-storage\.adapter/);
      expect(content, file).not.toMatch(/@supabase\//);
      expect(content, file).toMatch(/:\s*ObjectStorageService\b/);
    }
    // El adapter solo lo conoce el módulo que lo vincula.
    expect(
      sources.filter(({ content }) => /supabase-object-storage\.adapter\.js'/.test(content)).map(({ file }) => file),
    ).toEqual(['src/object-storage/object-storage.module.ts']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CT-10-A2: EmbeddingProvider
// ---------------------------------------------------------------------------------------------------------------

describe('CT-10-A2: embeddings vía EmbeddingProvider', () => {
  function makeEmbeddingConfig(overrides: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      OPENAI_API_KEY: 'sk-test',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      EMBEDDING_DIMENSIONS: 1536,
      ...overrides,
    };
    return { get: (key: string, defaultValue?: unknown) => values[key] ?? defaultValue } as never;
  }

  beforeEach(() => {
    embeddingsCreateMock.mockReset();
  });

  it('CT-10-A2: el puerto devuelve un vector por texto, en el orden de entrada aunque el proveedor responda desordenado', async () => {
    embeddingsCreateMock.mockResolvedValue({
      data: [
        { index: 2, embedding: [0.3] },
        { index: 0, embedding: [0.1] },
        { index: 1, embedding: [0.2] },
      ],
    });
    const provider = new OpenAiEmbeddingProvider(makeEmbeddingConfig());

    await expect(provider.embedMany(['a', 'b', 'c'])).resolves.toEqual([[0.1], [0.2], [0.3]]);
  });

  it('CT-10-A2: los textos se envían en lotes de 96 y el orden global se conserva entre lotes', async () => {
    embeddingsCreateMock.mockImplementation(async ({ input }: { input: string[] }) => ({
      // Respuesta desordenada dentro de cada lote.
      data: input.map((text, index) => ({ index, embedding: [Number(text.slice(2))] })).reverse(),
    }));
    const provider = new OpenAiEmbeddingProvider(makeEmbeddingConfig());
    const texts = Array.from({ length: 200 }, (_, i) => `t-${i}`);

    const result = await provider.embedMany(texts);

    expect(embeddingsCreateMock.mock.calls.map(([request]) => (request as { input: string[] }).input.length)).toEqual([
      96, 96, 8,
    ]);
    expect(result).toHaveLength(200);
    expect(result.map(([value]) => value)).toEqual(texts.map((_, i) => i));
  });

  it('CT-10-A2: una entrada vacía devuelve una lista vacía sin llamar al proveedor', async () => {
    const provider = new OpenAiEmbeddingProvider(makeEmbeddingConfig());

    await expect(provider.embedMany([])).resolves.toEqual([]);
    expect(embeddingsCreateMock).not.toHaveBeenCalled();
  });

  it('CT-10-A2: usa el modelo y las dimensiones configurados', async () => {
    embeddingsCreateMock.mockResolvedValue({ data: [{ index: 0, embedding: [1] }] });
    const provider = new OpenAiEmbeddingProvider(
      makeEmbeddingConfig({ EMBEDDING_MODEL: 'text-embedding-3-large', EMBEDDING_DIMENSIONS: 256 }),
    );

    await provider.embedMany(['x']);

    expect(embeddingsCreateMock).toHaveBeenCalledWith({
      model: 'text-embedding-3-large',
      input: ['x'],
      dimensions: 256,
    });
  });

  it('CT-10-A2: un error del proveedor se propaga (sin resultado parcial) y el segundo lote no se solicita', async () => {
    const providerError = Object.assign(new Error('rate limited'), { status: 429 });
    embeddingsCreateMock
      .mockImplementationOnce(async ({ input }: { input: string[] }) => ({
        data: input.map((_, index) => ({ index, embedding: [index] })),
      }))
      .mockRejectedValueOnce(providerError);
    const provider = new OpenAiEmbeddingProvider(makeEmbeddingConfig());

    await expect(provider.embedMany(Array.from({ length: 150 }, (_, i) => `t-${i}`))).rejects.toBe(providerError);
    expect(embeddingsCreateMock).toHaveBeenCalledTimes(2);
  });

  it('CT-10-A2: el adapter de OpenAI cumple la forma del puerto y ProvidersModule lo vincula al token EMBEDDING_PROVIDER', () => {
    const provider = new OpenAiEmbeddingProvider(makeEmbeddingConfig());
    const port: { embedMany(texts: string[]): Promise<number[][]> } = provider;

    expect(typeof port.embedMany).toBe('function');
    const providers = Reflect.getMetadata('providers', ProvidersModule) as Array<{ provide: unknown; useClass: unknown }>;
    expect(providers).toContainEqual({ provide: EMBEDDING_PROVIDER, useClass: OpenAiEmbeddingProvider });
    expect(Reflect.getMetadata('exports', ProvidersModule)).toContain(EMBEDDING_PROVIDER);
  });

  it('CT-10-A2: el consumidor de embeddings recibe el puerto por el token EMBEDDING_PROVIDER y no importa el adapter ni el SDK', () => {
    const consumers = productionSources().filter(
      ({ file, content }) => !file.startsWith('src/providers/') && /\.embedMany\(/.test(content),
    );

    expect(consumers.map(({ file }) => file)).toEqual(['src/snapshot-intelligence/snapshot-analysis-job.handler.ts']);
    for (const { file, content } of consumers) {
      expect(content, file).toMatch(/@Inject\(EMBEDDING_PROVIDER\)\s+private readonly \w+: EmbeddingProvider/);
      expect(content, file).toMatch(/import type \{ EmbeddingProvider \} from '\.\.\/providers\/embedding-provider\.interface\.js'/);
      expect(content, file).not.toMatch(/openai-embedding\.provider/);
      expect(content, file).not.toMatch(/from\s+['"]openai['"]/);
    }
    // El adapter concreto solo lo conoce el módulo de proveedores.
    expect(
      productionSources()
        .filter(({ content }) => /openai-embedding\.provider\.js'/.test(content))
        .map(({ file }) => file),
    ).toEqual(['src/providers/providers.module.ts']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// CT-10-A4 (reformulada, G-06): errores de persistencia
// ---------------------------------------------------------------------------------------------------------------

interface CapturedEnvelope {
  statusCode: number;
  code: string;
  message: string;
  details: unknown;
  correlationId: string;
  path: string;
}

function catchEnvelope(exception: unknown): CapturedEnvelope {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/ruta?x=1', headers: { [CORRELATION_ID_HEADER]: 'corr-ct-10' } }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  const statusCode = status.mock.calls[0][0] as number;
  const body = json.mock.calls[0][0] as CapturedEnvelope;
  expect(body.statusCode).toBe(statusCode);
  return body;
}

const LEAKS = [
  's3cr3t',
  'postgresql://',
  'pooler.supabase.com',
  'prisma.job',
  'INSERT INTO',
  'jobs_dedupeKey_key',
  'P2002',
  'P1001',
  'duplicate key',
  'Unique constraint',
];

describe('CT-10-A4: los errores de persistencia son tipados y no filtran internals', () => {
  beforeEach(() => {
    // El filtro registra los 5xx con su stack; el test no necesita ese ruido.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const persistenceFailures: Array<[string, () => unknown]> = [
    [
      'violación de unicidad de Prisma (P2002)',
      () =>
        new Prisma.PrismaClientKnownRequestError(
          'Invalid `prisma.job.create()` invocation: Unique constraint failed on the constraint: `jobs_dedupeKey_key`',
          { code: 'P2002', clientVersion: 'test', meta: { target: 'jobs_dedupeKey_key' } },
        ),
    ],
    [
      'base inalcanzable (PrismaClientInitializationError P1001)',
      () =>
        new Prisma.PrismaClientInitializationError(
          "Can't reach database server at `aws-0.pooler.supabase.com:6543` (postgresql://postgres:s3cr3t@aws-0.pooler.supabase.com/postgres)",
          'test',
          'P1001',
        ),
    ],
    [
      'error desconocido de Prisma con SQL',
      () => new Prisma.PrismaClientUnknownRequestError('INSERT INTO "jobs" failed for postgresql://u:s3cr3t@h/db', { clientVersion: 'test' }),
    ],
    [
      'error de PostgreSQL 23505 sin envolver',
      () => Object.assign(new Error('duplicate key value violates unique constraint "jobs_dedupeKey_key"'), { code: '23505' }),
    ],
  ];

  it.each(persistenceFailures)('CT-10-A4: %s sale por el envelope como 500 INTERNAL_ERROR con mensaje fijo y sin internals', (_name, build) => {
    const body = catchEnvelope(build());

    expect(body).toMatchObject({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Error interno del servidor.',
      details: null,
      correlationId: 'corr-ct-10',
      path: '/ruta?x=1',
    });
    const serialized = JSON.stringify(body);
    for (const leak of LEAKS) expect(serialized).not.toContain(leak);
    expect(Object.keys(body).sort()).toEqual(
      ['code', 'correlationId', 'details', 'message', 'path', 'statusCode', 'timestamp'].sort(),
    );
    expect(validateContract('error-envelope.schema.json', null, body).valid).toBe(true);
  });

  describe('conflicto FK: ActiveKnowledgeConflictError -> 409 FUNCTIONAL_KNOWLEDGE_CONFLICT', () => {
    const winner = {
      id: 'knowledge-winner',
      projectId: 'project-1',
      scope: 'METHOD',
      targetRef: 'src/thing.ts::Thing.doIt',
      originalQuestion: '¿...?',
      originalAnswer: 'sí',
      normalizedRule: 'sí',
      source: 'HUMAN_ANSWER',
      status: 'ACTIVE',
      supersedesId: null,
      confirmedByUserId: 'user-2',
      confirmedRole: 'ADMIN',
      originHeadSha: 'head-sha',
      sourceRef: null,
      scenarioKind: 'EXPECTED_RESULT',
      scenarioKey: 'LEGACY',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    } as FunctionalKnowledge;

    it('CT-10-A4: la violación del índice ACTIVE (P2002) la traduce el repositorio y el servicio la responde como 409 con la regla ganadora', async () => {
      const prisma = {
        functionalKnowledge: {
          create: vi.fn().mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the constraint: functional_knowledge_active_scenario_key', {
              code: 'P2002',
              clientVersion: 'test',
            }),
          ),
          // 1.ª lectura (findActive del servicio): no hay regla; 2.ª (traducción del conflicto): la ganadora.
          findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner),
        },
      };
      const repository = new FunctionalKnowledgeRepository(prisma as unknown as PrismaService);
      const service = new FunctionalKnowledgeService(
        {
          findById: vi.fn().mockResolvedValue({
            id: 'question-1',
            analysisRunId: 'run-1',
            projectId: 'project-1',
            symbolKind: 'METHOD',
            qualifiedName: 'Thing.doIt',
            filePath: 'src/thing.ts',
            question: '¿...?',
            status: 'PENDING',
            scenarioKind: null,
            scenarioKey: null,
            abstentions: [],
          }),
          answer: vi.fn(),
        } as never,
        repository,
        { evaluate: vi.fn() } as never,
        {
          findByIdForOwner: vi.fn().mockResolvedValue({
            id: 'run-1',
            projectId: 'project-1',
            headSha: 'head-sha',
            status: 'ACTION_REQUIRED',
            current: true,
          }),
        } as never,
        {} as never,
        { require: vi.fn().mockResolvedValue({ project: { id: 'project-1' }, role: 'MAINTAINER' }) } as never,
        {} as never,
        { get: vi.fn().mockReturnValue(1500) } as never,
      );

      const error = await service
        .submitAnswer('run-1', 'question-1', { choice: 'NO', answer: 'no' }, 'user-1')
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );

      expect(error).toBeInstanceOf(AppException);
      const body = catchEnvelope(error);
      expect(body).toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.FUNCTIONAL_KNOWLEDGE_CONFLICT,
        details: expect.objectContaining({
          questionId: 'question-1',
          conflictingKnowledge: expect.objectContaining({ id: 'knowledge-winner' }),
          proposedNormalizedRule: 'no',
        }),
      });
      expect(JSON.stringify(body)).not.toContain('P2002');
      expect(JSON.stringify(body)).not.toContain('functional_knowledge_active_scenario_key');
      expect(validateContract('error-envelope.schema.json', null, body).valid).toBe(true);
    });
  });

  describe('idempotencia: IdempotencyService', () => {
    const KEY = '11111111-1111-4111-8111-111111111111';

    function makeIdempotency() {
      const idempotencyRecord = {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      };
      const prisma = {
        idempotencyRecord,
        $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback({ idempotencyRecord })),
      };
      return { service: new IdempotencyService(prisma as never), idempotencyRecord };
    }

    it('CT-10-A4: la misma Idempotency-Key con otra huella responde 409 IDEMPOTENCY_CONFLICT sin crear nada', async () => {
      const { service, idempotencyRecord } = makeIdempotency();
      idempotencyRecord.findUnique.mockResolvedValue({ requestFingerprint: 'otra-huella', operationId: 'run-1' });
      const create = vi.fn();

      const error = await service
        .run({ scope: 'TEST_RUN_CREATE', key: KEY, fingerprintInput: { projectId: 'p2' }, create, rebuildResponse: vi.fn() })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );

      expect(error).toBeInstanceOf(AppException);
      expect(catchEnvelope(error)).toMatchObject({
        statusCode: HttpStatus.CONFLICT,
        code: ErrorCode.IDEMPOTENCY_CONFLICT,
      });
      expect(create).not.toHaveBeenCalled();
    });

    it('CT-10-A4: una carrera por la restricción única (P2002) se resuelve contra el registro ganador sin error al cliente', async () => {
      const { service, idempotencyRecord } = makeIdempotency();
      let fingerprint = '';
      idempotencyRecord.create.mockImplementationOnce(async (args: { data: { requestFingerprint: string } }) => {
        fingerprint = args.data.requestFingerprint;
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
      });
      idempotencyRecord.findUnique.mockImplementation(async () =>
        fingerprint ? { requestFingerprint: fingerprint, operationId: 'run-1' } : null,
      );
      const rebuildResponse = vi.fn().mockResolvedValue({ runId: 'run-1' });

      await expect(
        service.run({
          scope: 'TEST_RUN_CREATE',
          key: KEY,
          fingerprintInput: { projectId: 'p1' },
          create: vi.fn().mockResolvedValue({ operationId: 'run-1', response: { runId: 'run-1' } }),
          rebuildResponse,
        }),
      ).resolves.toEqual({ runId: 'run-1' });
      expect(rebuildResponse).toHaveBeenCalledWith('run-1');
    });

    it('CT-10-A4: una indisponibilidad de la base durante la creación no se enmascara y sale como 500 INTERNAL_ERROR sin internals', async () => {
      const { service, idempotencyRecord } = makeIdempotency();
      const outage = new Prisma.PrismaClientInitializationError(
        "Can't reach database server at `aws-0.pooler.supabase.com:6543` (postgresql://postgres:s3cr3t@h/db)",
        'test',
        'P1001',
      );
      idempotencyRecord.findUnique.mockRejectedValue(outage);

      const error = await service
        .run({ scope: 'TEST_RUN_CREATE', key: KEY, fingerprintInput: {}, create: vi.fn(), rebuildResponse: vi.fn() })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );

      expect(error).toBe(outage);
      const body = catchEnvelope(error);
      expect(body).toMatchObject({ statusCode: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Error interno del servidor.' });
      for (const leak of LEAKS) expect(JSON.stringify(body)).not.toContain(leak);
    });
  });

  describe('jobs: JobsRepository', () => {
    const baseJob: Job = {
      id: 'job-1',
      type: 'access-reverify',
      payload: {},
      status: 'RUNNING',
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      availableAt: new Date('2026-01-01T00:00:00.000Z'),
      lockedAt: new Date('2026-01-01T00:00:00.000Z'),
      lockedBy: 'worker-1',
      dedupeKey: 'access:project-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    beforeEach(() => {
      // El repositorio avisa por Logger.warn cuando pierde el lock; no es parte de lo que se comprueba.
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    it('CT-10-A4: el reintento que choca con el índice único parcial del PENDING se resuelve con el resultado tipado "discarded"', async () => {
      const updateMany = vi
        .fn()
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`dedupeKey`)', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        )
        .mockResolvedValueOnce({ count: 1 });
      const repository = new JobsRepository({ job: { updateMany } } as unknown as PrismaService);

      await expect(repository.fail(baseJob, 'boom')).resolves.toBe('discarded');

      expect(updateMany).toHaveBeenCalledTimes(2);
      expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(updateMany.mock.calls[1][0].data).toMatchObject({
        status: 'COMPLETED',
        lastError: expect.stringContaining('Descartado: ya existe un PENDING con la misma dedupeKey'),
      });
    });

    it('CT-10-A4: un error de persistencia que no es una violación de unicidad no se traga: se propaga sin descartar el job', async () => {
      const outage = new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
        code: 'P1001',
        clientVersion: 'test',
      });
      const updateMany = vi.fn().mockRejectedValue(outage);
      const repository = new JobsRepository({ job: { updateMany } } as unknown as PrismaService);

      await expect(repository.fail(baseJob, 'boom')).rejects.toBe(outage);
      expect(updateMany).toHaveBeenCalledTimes(1);
    });

    it('CT-10-A4: sin dedupeKey ni colisión el reintento y el fallo terminal devuelven resultados tipados distintos', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const repository = new JobsRepository({ job: { updateMany } } as unknown as PrismaService);

      await expect(repository.fail({ ...baseJob, dedupeKey: null }, 'boom')).resolves.toBe('retry');
      await expect(repository.fail({ ...baseJob, dedupeKey: null, attempts: 2 }, 'boom')).resolves.toBe('terminal');
      updateMany.mockResolvedValue({ count: 0 });
      await expect(repository.fail({ ...baseJob, dedupeKey: null }, 'boom')).resolves.toBe('lost');
    });
  });
});
