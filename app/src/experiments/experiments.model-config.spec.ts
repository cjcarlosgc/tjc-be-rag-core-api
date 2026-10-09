import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperimentsService } from './experiments.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { OpenAiLLMProvider } from '../providers/openai-llm.provider.js';
import { AppException } from '../common/errors/app.exception.js';

// WI-CORE-023 (Desviación 1): la configuración del experimento se resuelve y valida al crearlo, usando el
// OpenAiLLMProvider real con un ConfigService falso. La API de OpenAI nunca se llama: se mockea el cliente.
const createMock = vi.fn();
const retrieveMock = vi.fn();

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
    models = { retrieve: retrieveMock };
  },
}));

const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111';
const OWNER_USER_ID = 'user-1';
const DTO = { projectId: 'project-1', targetId: 'target-1' };

const GPT_6_LUNA_COMBINATIONS = JSON.stringify([
  { model: 'gpt-6-luna', efforts: ['low', 'xhigh'], toolEfforts: ['low', 'xhigh'] },
]);

/** ConfigService falso con entorno mutable: simula cambios de variables tras crear un experimento. */
function makeEnv(initial: Record<string, string | undefined>) {
  const env: Record<string, string | undefined> = { OPENAI_API_KEY: 'sk-test', ...initial };
  const configService = {
    get: (key: string, fallback?: unknown) => env[key] ?? fallback,
  };
  return { env, configService };
}

/** Prisma en memoria mínimo para IdempotencyService: la unicidad (scope, key) se simula con un Map. */
function makeFakePrisma() {
  const records = new Map<string, { requestFingerprint: string; operationId: string }>();
  const slot = (scope: string, key: string) => `${scope}|${key}`;
  const idempotencyRecord = {
    findUnique: vi.fn(async ({ where }: { where: { scope_idempotencyKey: { scope: string; idempotencyKey: string } } }) => {
      const { scope, idempotencyKey } = where.scope_idempotencyKey;
      return records.get(slot(scope, idempotencyKey)) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: { scope: string; idempotencyKey: string; requestFingerprint: string; operationId: string } }) => {
      records.set(slot(data.scope, data.idempotencyKey), {
        requestFingerprint: data.requestFingerprint,
        operationId: data.operationId,
      });
      return data;
    }),
  };
  return {
    idempotencyRecord,
    $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback({ idempotencyRecord })),
  };
}

function makeService(env: ReturnType<typeof makeEnv>) {
  const llmProvider = new OpenAiLLMProvider(env.configService as never);
  const prisma = makeFakePrisma();
  const experimentRunsRepository = {
    create: vi.fn().mockResolvedValue({ id: 'exp-1' }),
    findById: vi.fn().mockResolvedValue({ id: 'exp-1', projectVersionId: 'version-1' }),
  };
  const jobsService = { enqueue: vi.fn().mockResolvedValue('job-1') };
  const service = new ExperimentsService(
    {
      require: vi.fn().mockResolvedValue({ project: { id: 'project-1', currentVersionId: 'version-1' }, role: 'WRITER' }),
    } as never,
    {
      hasActiveVersion: vi.fn().mockResolvedValue(false),
      findById: vi.fn().mockResolvedValue({ id: 'version-1', status: 'COMPLETED', detectedFramework: 'VITEST' }),
    } as never,
    { findByIdForOwner: vi.fn().mockResolvedValue({ id: 'target-1', targetType: 'FUNCTION' }) } as never,
    experimentRunsRepository as never,
    jobsService as never,
    env.configService as never,
    new IdempotencyService(prisma as never),
    llmProvider,
  );
  return { service, llmProvider, experimentRunsRepository, jobsService, prisma };
}

describe('ExperimentsService model configuration (WI-CORE-023, Desviación 1)', () => {
  beforeEach(() => {
    createMock.mockReset();
    retrieveMock.mockReset();
  });

  it('rejects an effort the model does not support before creating the run or enqueuing the job', async () => {
    const env = makeEnv({
      LLM_SUPPORTED_COMBINATIONS: GPT_6_LUNA_COMBINATIONS,
      EXPERIMENT_LLM_MODEL: 'gpt-6-luna',
      EXPERIMENT_LLM_REASONING_EFFORT: 'high',
    });
    const { service, experimentRunsRepository, jobsService, prisma } = makeService(env);

    const error = await service.createRun(DTO, IDEMPOTENCY_KEY, OWNER_USER_ID).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(422);
    expect(error).toMatchObject({
      code: 'REASONING_EFFORT_UNSUPPORTED',
      details: { model: 'gpt-6-luna', requestedEffort: 'high', supportedEfforts: ['low', 'xhigh'] },
    });
    expect(experimentRunsRepository.create).not.toHaveBeenCalled();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
    expect(prisma.idempotencyRecord.create).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('fails with REASONING_EFFORT_UNSUPPORTED for the default model when no combinations are configured (no effort is assumed)', async () => {
    const env = makeEnv({});
    const { service, experimentRunsRepository, jobsService } = makeService(env);

    const error = await service.createRun(DTO, IDEMPOTENCY_KEY, OWNER_USER_ID).catch((caught: unknown) => caught);

    expect((error as AppException).getStatus()).toBe(422);
    expect(error).toMatchObject({
      code: 'REASONING_EFFORT_UNSUPPORTED',
      details: { model: 'gpt-6-luna', supportedEfforts: [] },
    });
    expect(experimentRunsRepository.create).not.toHaveBeenCalled();
    expect(jobsService.enqueue).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('persists the single resolved config and replays the same Idempotency-Key without resolving, validating or re-persisting again', async () => {
    retrieveMock.mockResolvedValue({ id: 'gpt-6-luna-2026' });
    const env = makeEnv({
      LLM_SUPPORTED_COMBINATIONS: GPT_6_LUNA_COMBINATIONS,
      EXPERIMENT_LLM_MODEL: 'gpt-6-luna',
    });
    const { service, llmProvider, experimentRunsRepository, jobsService } = makeService(env);
    const resolveSpy = vi.spyOn(llmProvider, 'resolveEffectiveConfig');

    const first = await service.createRun(DTO, IDEMPOTENCY_KEY, OWNER_USER_ID);

    expect(first.experimentId).toBe('exp-1');
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(retrieveMock).toHaveBeenCalledTimes(1);
    expect(experimentRunsRepository.create).toHaveBeenCalledTimes(1);
    expect(experimentRunsRepository.create.mock.calls[0][0].modelConfig).toEqual({
      provider: 'openai',
      model: 'gpt-6-luna',
      modelVersion: 'gpt-6-luna-2026',
      reasoningEffort: 'xhigh',
      temperature: null,
      maxOutputTokens: null,
    });

    // El entorno cambia después de crear el experimento: el combo desaparece y el modelo se reemplaza.
    env.env.LLM_SUPPORTED_COMBINATIONS = undefined;
    env.env.EXPERIMENT_LLM_MODEL = 'other-model';

    const replay = await service.createRun(DTO, IDEMPOTENCY_KEY, OWNER_USER_ID);

    expect(replay).toMatchObject({ experimentId: 'exp-1', projectVersionId: 'version-1', status: 'PENDING' });
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(retrieveMock).toHaveBeenCalledTimes(1);
    expect(experimentRunsRepository.create).toHaveBeenCalledTimes(1);
    expect(jobsService.enqueue).toHaveBeenCalledTimes(1);
  });
});
