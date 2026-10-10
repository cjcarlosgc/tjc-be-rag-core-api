import { describe, expect, it, vi } from 'vitest';
import { ExperimentsService } from './experiments.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { LLMConfigurationError } from '../providers/llm-configuration.error.js';
import type { LLMEffectiveConfig } from '../providers/llm-provider.interface.js';
import { EXECUTION_PROFILE_BY_RUNNER } from '../sandbox/sandbox-execution.service.js';

const OWNER_USER_ID = 'user-1';

const EFFECTIVE_CONFIG: LLMEffectiveConfig = {
  provider: 'openai',
  model: 'gpt-6-luna',
  modelVersion: 'gpt-6-luna-2026',
  reasoningEffort: 'xhigh',
  temperature: null,
  maxOutputTokens: null,
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    projectAccess: {
      require: vi.fn().mockResolvedValue({ project: { id: 'project-1', currentVersionId: 'version-1' }, role: 'WRITER' }),
    },
    projectVersionsRepository: {
      hasActiveVersion: vi.fn().mockResolvedValue(false),
      findById: vi.fn().mockResolvedValue({ id: 'version-1', status: 'COMPLETED', detectedFramework: 'VITEST' }),
    },
    testTargetsRepository: {
      findByIdForOwner: vi.fn().mockResolvedValue({ id: 'target-1', targetType: 'FUNCTION' }),
    },
    experimentRunsRepository: {
      create: vi.fn().mockResolvedValue({ id: 'exp-1' }),
      findByIdForOwner: vi.fn(),
      findRepetitions: vi.fn(),
    },
    jobsService: { enqueue: vi.fn().mockResolvedValue('job-1') },
    configService: { get: (key: string, fallback?: unknown) => fallback },
    llmProvider: {
      resolveEffectiveConfig: vi.fn().mockResolvedValue(EFFECTIVE_CONFIG),
    },
    idempotencyService: {
      run: vi.fn(
        async ({
          prepare,
          create,
        }: {
          prepare?: () => Promise<unknown>;
          create: (tx: never, prepared: unknown) => Promise<{ operationId: string; response: unknown }>;
        }) => {
          const prepared = prepare ? await prepare() : undefined;
          return (await create(undefined as never, prepared)).response;
        },
      ),
    },
    ...overrides,
  };
}

function makeService(deps: ReturnType<typeof makeDeps>): ExperimentsService {
  return new ExperimentsService(
    deps.projectAccess as never,
    deps.projectVersionsRepository as never,
    deps.testTargetsRepository as never,
    deps.experimentRunsRepository as never,
    deps.jobsService as never,
    deps.configService as never,
    deps.idempotencyService as never,
    deps.llmProvider as never,
  );
}

describe('ExperimentsService', () => {
  describe('createRun', () => {
    it('propagates PROJECT_NOT_FOUND when the project is not visible, requiring the Writer role (HU60, INTEROP-2.7 §6.13)', async () => {
      const deps = makeDeps({
        projectAccess: {
          require: vi.fn().mockRejectedValue(new AppException(ErrorCode.PROJECT_NOT_FOUND, 'nope', 404)),
        },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'missing', targetId: 'target-1' }, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NOT_FOUND });
      expect(deps.projectAccess.require).toHaveBeenCalledWith(OWNER_USER_ID, 'missing', 'WRITER');
    });

    it('propagates 403 PROJECT_ROLE_INSUFFICIENT for a Reader before any other validation', async () => {
      const deps = makeDeps({
        projectAccess: {
          require: vi
            .fn()
            .mockRejectedValue(new AppException(ErrorCode.PROJECT_ROLE_INSUFFICIENT, 'no', 403)),
        },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-1' }, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_ROLE_INSUFFICIENT });
      expect(deps.projectVersionsRepository.hasActiveVersion).not.toHaveBeenCalled();
    });

    it('throws PROJECT_INDEXING_IN_PROGRESS when the project has an active version', async () => {
      const deps = makeDeps({
        projectVersionsRepository: {
          hasActiveVersion: vi.fn().mockResolvedValue(true),
          findById: vi.fn(),
        },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-1' }, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_INDEXING_IN_PROGRESS });
    });

    it('throws PROJECT_NOT_READY when there is no current version', async () => {
      const deps = makeDeps({
        projectAccess: {
          require: vi.fn().mockResolvedValue({ project: { id: 'project-1', currentVersionId: null }, role: 'WRITER' }),
        },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-1' }, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NOT_READY });
    });

    it('throws ANALYSIS_NOT_FINISHED when the current version is not COMPLETED', async () => {
      const deps = makeDeps({
        projectVersionsRepository: {
          hasActiveVersion: vi.fn().mockResolvedValue(false),
          findById: vi.fn().mockResolvedValue({ id: 'version-1', status: 'FAILED' }),
        },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-1' }, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.ANALYSIS_NOT_FINISHED });
    });

    it('throws UNRESOLVABLE_TARGET when the target does not exist or belongs to another owner', async () => {
      const deps = makeDeps({
        testTargetsRepository: { findByIdForOwner: vi.fn().mockResolvedValue(null) },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'missing' }, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.UNRESOLVABLE_TARGET });
    });

    it('looks the target up scoped to the requested project, so a target of another project is UNRESOLVABLE_TARGET', async () => {
      const deps = makeDeps({
        testTargetsRepository: { findByIdForOwner: vi.fn().mockResolvedValue(null) },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-of-project-2' }, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.UNRESOLVABLE_TARGET });
      expect(deps.testTargetsRepository.findByIdForOwner).toHaveBeenCalledWith('target-of-project-2', OWNER_USER_ID, 'project-1');
      expect(deps.experimentRunsRepository.create).not.toHaveBeenCalled();
      expect(deps.jobsService.enqueue).not.toHaveBeenCalled();
    });

    it('throws INVALID_GENERATION_TARGET when the target is a CLASS', async () => {
      const deps = makeDeps({
        testTargetsRepository: {
          findByIdForOwner: vi.fn().mockResolvedValue({ id: 'target-1', targetType: 'CLASS' }),
        },
      });
      const service = makeService(deps);

      await expect(
        service.createRun({ projectId: 'project-1', targetId: 'target-1' }, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_GENERATION_TARGET });
    });

    it('creates the run and enqueues the job on the happy path', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      const result = await service.createRun(
        { projectId: 'project-1', targetId: 'target-1' },
        undefined,
        OWNER_USER_ID,
      );

      expect(deps.experimentRunsRepository.create).toHaveBeenCalledWith(
        {
          projectId: 'project-1',
          projectVersionId: 'version-1',
          targetId: 'target-1',
          totalRepetitions: 6,
          modelConfig: EFFECTIVE_CONFIG,
          randomizationSeed: expect.stringMatching(/^[0-9a-f]{64}$/),
          budget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 120_000 },
          executionProfile: 'NODE_TYPESCRIPT',
          runnerHint: 'VITEST',
        },
        undefined,
      );
      expect(deps.jobsService.enqueue).toHaveBeenCalledWith(
        'experiment-run',
        expect.objectContaining({ experimentId: 'exp-1', targetId: 'target-1' }),
        undefined,
      );
      expect(result).toMatchObject({ experimentId: 'exp-1', projectVersionId: 'version-1', status: 'PENDING' });
    });

    it('resolves the effective LLM config exactly once through prepare and persists that same config in create', async () => {
      const deps = makeDeps();
      const service = makeService(deps);

      await service.createRun({ projectId: 'project-1', targetId: 'target-1' }, 'key-1', OWNER_USER_ID);

      expect(deps.llmProvider.resolveEffectiveConfig).toHaveBeenCalledTimes(1);
      expect(deps.idempotencyService.run).toHaveBeenCalledWith(
        expect.objectContaining({ prepare: expect.any(Function) }),
      );
      expect(deps.experimentRunsRepository.create).toHaveBeenCalledTimes(1);
      expect(deps.experimentRunsRepository.create.mock.calls[0][0]).toMatchObject({
        modelConfig: EFFECTIVE_CONFIG,
      });
    });

    it('answers 422 REASONING_EFFORT_UNSUPPORTED with supportedEfforts without creating the run or enqueuing the job', async () => {
      const deps = makeDeps({
        llmProvider: {
          resolveEffectiveConfig: vi.fn().mockRejectedValue(
            new LLMConfigurationError({
              code: 'REASONING_EFFORT_UNSUPPORTED',
              model: 'gpt-6-luna',
              requestedEffort: 'high',
              supportedEfforts: ['low'],
            }),
          ),
        },
      });
      const service = makeService(deps);

      const error = await service
        .createRun({ projectId: 'project-1', targetId: 'target-1' }, 'key-1', OWNER_USER_ID)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppException);
      expect(error).toMatchObject({
        code: ErrorCode.REASONING_EFFORT_UNSUPPORTED,
        details: { model: 'gpt-6-luna', requestedEffort: 'high', supportedEfforts: ['low'] },
      });
      expect((error as AppException).getStatus()).toBe(422);
      expect(deps.experimentRunsRepository.create).not.toHaveBeenCalled();
      expect(deps.jobsService.enqueue).not.toHaveBeenCalled();
    });

    it('answers 422 REASONING_EFFORT_UNSUPPORTED when temperature conflicts with active reasoning, without creating the run or enqueuing the job', async () => {
      const deps = makeDeps({
        llmProvider: {
          resolveEffectiveConfig: vi.fn().mockRejectedValue(
            new LLMConfigurationError({
              code: 'TEMPERATURE_UNSUPPORTED_WITH_REASONING',
              model: 'gpt-6-luna',
              requestedEffort: 'high',
              supportedEfforts: ['none'],
              temperature: 0.2,
            }),
          ),
        },
      });
      const service = makeService(deps);

      const error = await service
        .createRun({ projectId: 'project-1', targetId: 'target-1' }, 'key-1', OWNER_USER_ID)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppException);
      expect(error).toMatchObject({
        code: ErrorCode.REASONING_EFFORT_UNSUPPORTED,
        details: { model: 'gpt-6-luna', requestedEffort: 'high', supportedEfforts: ['none'] },
      });
      expect((error as AppException).message).toContain('temperatura');
      expect((error as AppException).message).toContain('"none"');
      expect((error as AppException).getStatus()).toBe(422);
      expect(deps.experimentRunsRepository.create).not.toHaveBeenCalled();
      expect(deps.jobsService.enqueue).not.toHaveBeenCalled();
    });

    it('answers 503 LLM_PROVIDER_UNAVAILABLE when the experiment model is unavailable, without creating the run', async () => {
      const deps = makeDeps({
        llmProvider: {
          resolveEffectiveConfig: vi.fn().mockRejectedValue(
            new LLMConfigurationError({
              code: 'MODEL_UNAVAILABLE',
              model: 'gpt-6-luna',
              requestedEffort: null,
              supportedEfforts: [],
            }),
          ),
        },
      });
      const service = makeService(deps);

      const error = await service
        .createRun({ projectId: 'project-1', targetId: 'target-1' }, undefined, OWNER_USER_ID)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppException);
      expect(error).toMatchObject({ code: ErrorCode.LLM_PROVIDER_UNAVAILABLE });
      expect((error as AppException).getStatus()).toBe(503);
      expect(deps.experimentRunsRepository.create).not.toHaveBeenCalled();
      expect(deps.jobsService.enqueue).not.toHaveBeenCalled();
    });

    it.each([
      ['PHPUNIT', 'PHPUNIT'],
      ['no framework', null],
    ])('answers 422 UNSUPPORTED_PROJECT for a %s version without creating the run or the job', async (_label, framework) => {
      const deps = makeDeps({
        projectVersionsRepository: {
          hasActiveVersion: vi.fn().mockResolvedValue(false),
          findById: vi.fn().mockResolvedValue({ id: 'version-1', status: 'COMPLETED', detectedFramework: framework }),
        },
      });
      const service = makeService(deps);

      const error = await service
        .createRun({ projectId: 'project-1', targetId: 'target-1' }, undefined, OWNER_USER_ID)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppException);
      expect(error).toMatchObject({ code: ErrorCode.UNSUPPORTED_PROJECT });
      expect((error as AppException).getStatus()).toBe(422);
      expect(deps.experimentRunsRepository.create).not.toHaveBeenCalled();
      expect(deps.jobsService.enqueue).not.toHaveBeenCalled();
    });

    it('persists the runner, its execution profile and the budget from config in the same insert as the seed', async () => {
      const deps = makeDeps({
        configService: {
          get: (key: string, fallback?: unknown) =>
            ({ AGENT_MAX_TOOL_CALLS: 7, RETRIEVAL_MAX_CONTEXT_TOKENS: 4096, GENERATION_TIMEOUT_MS: 90_000 })[key] ?? fallback,
        },
        projectVersionsRepository: {
          hasActiveVersion: vi.fn().mockResolvedValue(false),
          findById: vi.fn().mockResolvedValue({ id: 'version-1', status: 'COMPLETED', detectedFramework: 'JEST' }),
        },
      });
      const service = makeService(deps);

      await service.createRun({ projectId: 'project-1', targetId: 'target-1' }, undefined, OWNER_USER_ID);

      expect(deps.experimentRunsRepository.create).toHaveBeenCalledTimes(1);
      expect(deps.experimentRunsRepository.create.mock.calls[0][0]).toMatchObject({
        budget: { toolCallCap: 7, contextTokenBudget: 4096, maxDurationMs: 90_000 },
        executionProfile: EXECUTION_PROFILE_BY_RUNNER.JEST,
        runnerHint: 'JEST',
      });
    });

    it('generates the seed inside create, so a replay that never reaches create keeps the stored seed', async () => {
      const deps = makeDeps();
      const storedSeed = 'a'.repeat(64);
      deps.experimentRunsRepository.findByIdForOwner = vi
        .fn()
        .mockResolvedValue({ id: 'exp-1', status: 'PENDING', randomizationSeed: storedSeed, modelConfig: null });
      (deps.experimentRunsRepository as Record<string, unknown>).findById = vi
        .fn()
        .mockResolvedValue({ id: 'exp-1', projectVersionId: 'version-1', randomizationSeed: storedSeed });
      (deps.idempotencyService as { run: unknown }).run = vi.fn(async ({ rebuildResponse }: { rebuildResponse: (id: string) => Promise<unknown> }) =>
        rebuildResponse('exp-1'),
      );
      const service = makeService(deps);

      await service.createRun({ projectId: 'project-1', targetId: 'target-1' }, 'key-1', OWNER_USER_ID);

      expect(deps.experimentRunsRepository.create).not.toHaveBeenCalled();
      expect(deps.llmProvider.resolveEffectiveConfig).not.toHaveBeenCalled();
      const status = await service.getStatus('exp-1', OWNER_USER_ID);
      expect(status.randomizationSeed).toBe(storedSeed);
    });

    it('delegates to IdempotencyService with the idempotency key, the EXPERIMENT_CREATE scope and the dto as fingerprint (DEC-IDEMP-001)', async () => {
      const deps = makeDeps();
      const service = makeService(deps);
      const dto = { projectId: 'project-1', targetId: 'target-1' };

      await service.createRun(dto, 'client-key-1', OWNER_USER_ID);

      expect(deps.idempotencyService.run).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'client-key-1',
          scope: 'EXPERIMENT_CREATE',
          fingerprintInput: dto,
        }),
      );
    });
  });

  describe('getStatus', () => {
    it('exposes model, budget, profile, runner and seed persisted at creation', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1',
        projectId: 'project-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'PENDING',
        completedRepetitions: 0,
        totalRepetitions: 6,
        failureCode: null,
        failureMessage: null,
        startedAt: null,
        completedAt: null,
        modelConfig: { provider: 'openai', model: 'gpt-6-luna', modelVersion: 'gpt-6-luna-2026', reasoningEffort: 'xhigh', temperature: null, maxOutputTokens: 4000 },
        budget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 120000 },
        executionProfile: 'NODE_TYPESCRIPT',
        runnerHint: 'VITEST',
        randomizationSeed: 'b'.repeat(64),
      });
      const service = makeService(deps);

      await expect(service.getStatus('exp-1', OWNER_USER_ID)).resolves.toMatchObject({
        model: {
          provider: 'openai',
          model: 'gpt-6-luna',
          modelVersion: 'gpt-6-luna-2026',
          reasoningEffort: 'xhigh',
          temperature: null,
          maxOutputTokens: 4000,
        },
        budget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 120000 },
        executionProfile: 'NODE_TYPESCRIPT',
        runnerHint: 'VITEST',
        randomizationSeed: 'b'.repeat(64),
      });
    });

    it('never exposes the internal endpoint of modelConfig in the API response (WI-CORE-031)', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1',
        projectId: 'project-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'PENDING',
        completedRepetitions: 0,
        totalRepetitions: 6,
        failureCode: null,
        failureMessage: null,
        startedAt: null,
        completedAt: null,
        modelConfig: {
          provider: 'openai',
          model: 'gpt-6-luna',
          modelVersion: 'gpt-6-luna-2026',
          reasoningEffort: 'xhigh',
          temperature: null,
          maxOutputTokens: null,
          endpoint: 'responses',
        },
        budget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 120000 },
        executionProfile: 'NODE_TYPESCRIPT',
        runnerHint: 'VITEST',
        randomizationSeed: 'b'.repeat(64),
      });
      const service = makeService(deps);

      const status = await service.getStatus('exp-1', OWNER_USER_ID);

      expect(status.model).not.toHaveProperty('endpoint');
      expect(JSON.stringify(status)).not.toContain('responses');
    });

    it('answers null (never zero or invented values) for runs created before WI-CORE-023/025', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-old',
        projectId: 'project-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'COMPLETED',
        completedRepetitions: 6,
        totalRepetitions: 6,
        failureCode: null,
        failureMessage: null,
        startedAt: null,
        completedAt: null,
        modelConfig: null,
        budget: null,
        executionProfile: null,
        runnerHint: null,
        randomizationSeed: null,
      });
      const service = makeService(deps);

      await expect(service.getStatus('exp-old', OWNER_USER_ID)).resolves.toMatchObject({
        model: null,
        budget: null,
        executionProfile: null,
        runnerHint: null,
        randomizationSeed: null,
      });
    });
  });

  describe('getResults', () => {
    it('sanitizes errorSummary idempotently when mapping, without changing the repetition keys (WI-CORE-027, IDEA-015)', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
        modelConfig: { provider: 'openai', model: 'gpt-6-luna', modelVersion: 'v-2026', reasoningEffort: 'xhigh', temperature: 0.2, maxOutputTokens: null },
      });
      const base = {
        attempt: 1, valid: false, failureType: 'DEPENDENCY', generationDurationMs: 10, executionDurationMs: null,
        totalDurationMs: 10, inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
        compiled: null, executed: null, passed: null, retrievedChunks: null, selectedChunks: null,
        contextTokens: null, toolCalls: null, filesInspected: null, pairId: null, pairPosition: null,
        technicallyEvaluable: true,
      };
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([
        {
          ...base, repetition: 1, strategy: 'RAG',
          errorSummary: 'npm ERR https://u:p@r.example/x?sig=1 password hunter2',
        },
        { ...base, repetition: 1, strategy: 'GENERALIST_AGENT', errorSummary: null },
      ]);
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);

      expect(results.repetitions[0].errorSummary).toBe(
        'npm ERR https://[REDACTED]@r.example/x password [REDACTED]',
      );
      expect(results.repetitions[1].errorSummary).toBeNull();
      expect(Object.keys(results.repetitions[0]).sort()).toEqual(
        Object.keys(results.repetitions[1]).sort(),
      );
      // Idempotente: una fila ya saneada por una escritura anterior no cambia al mapear otra vez.
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([
        { ...base, repetition: 1, strategy: 'RAG', errorSummary: results.repetitions[0].errorSummary },
      ]);
      const again = await makeService(deps).getResults('exp-1', OWNER_USER_ID);
      expect(again.repetitions[0].errorSummary).toBe(results.repetitions[0].errorSummary);
    });

    it('maps pairing fields, nullable execution duration and model fields per repetition and strategy', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
        modelConfig: { provider: 'openai', model: 'gpt-6-luna', modelVersion: 'v-2026', reasoningEffort: 'xhigh', temperature: 0.2, maxOutputTokens: null },
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([
        {
          repetition: 1, strategy: 'RAG', attempt: 2, valid: false, failureType: 'INFRASTRUCTURE', errorSummary: null,
          generationDurationMs: 10, executionDurationMs: null, totalDurationMs: 10,
          inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
          compiled: null, executed: null, passed: null, retrievedChunks: null, selectedChunks: null,
          contextTokens: null, toolCalls: null, filesInspected: null,
          pairId: 'pair-1', pairPosition: 2, technicallyEvaluable: false,
        },
        {
          repetition: 1, strategy: 'GENERALIST_AGENT', attempt: 1, valid: true, failureType: 'NONE', errorSummary: null,
          generationDurationMs: 20, executionDurationMs: 300, totalDurationMs: 320,
          inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0.1,
          compiled: true, executed: true, passed: true, retrievedChunks: null, selectedChunks: null,
          contextTokens: null, toolCalls: 3, filesInspected: 2,
          pairId: null, pairPosition: null, technicallyEvaluable: true,
        },
      ]);
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);
      const [first] = results.repetitions;

      expect(first).toMatchObject({
        executionDurationMs: null,
        pairId: 'pair-1',
        pairPosition: 2,
        attempt: 2,
        technicallyEvaluable: false,
      });
      expect(results.repetitions[1]).toMatchObject({
        executionDurationMs: 300,
        pairId: null,
        pairPosition: null,
        attempt: 1,
        technicallyEvaluable: true,
      });
      expect(results.strategies.find((s) => s.strategy === 'RAG')).toMatchObject({
        modelVersion: 'v-2026',
        reasoningEffort: 'xhigh',
        temperature: 0.2,
        maxOutputTokens: null,
      });
    });

    it('never exposes the internal failure fact of a repetition in the API response (WI-CORE-007)', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
        modelConfig: { provider: 'openai', model: 'gpt-6-luna', modelVersion: 'v-2026', reasoningEffort: 'xhigh', temperature: null, maxOutputTokens: null },
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([
        {
          repetition: 1, strategy: 'RAG', attempt: 1, valid: false, failureType: 'COMPILATION', errorSummary: 'Cannot find name',
          generationDurationMs: 10, executionDurationMs: 5, totalDurationMs: 15,
          inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
          compiled: false, executed: null, passed: null, retrievedChunks: null, selectedChunks: null,
          contextTokens: null, toolCalls: null, filesInspected: null,
          pairId: null, pairPosition: null, technicallyEvaluable: true,
          failure: { stage: 'COMPILING', category: 'COMPILATION', code: 'TS2304', message: 'Cannot find name' },
        },
      ]);
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);

      expect(results.repetitions[0]).not.toHaveProperty('failure');
      expect(JSON.stringify(results)).not.toContain('"failure"');
    });

    it('throws EXPERIMENT_NOT_FINISHED when the run is still RUNNING', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi
        .fn()
        .mockResolvedValue({ id: 'exp-1', status: 'RUNNING' });
      const service = makeService(deps);

      await expect(service.getResults('exp-1', OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.EXPERIMENT_NOT_FINISHED,
      });
    });

    it('aggregates rates, means and failure distribution per strategy', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([
        {
          repetition: 1, strategy: 'RAG', compiled: true, executed: true, passed: true, valid: true,
          failureType: 'NONE', generationDurationMs: 100, executionDurationMs: 200, totalDurationMs: 300,
          inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0.01,
          retrievedChunks: 4, selectedChunks: 2, contextTokens: 500, toolCalls: null, filesInspected: null,
        },
        {
          repetition: 2, strategy: 'RAG', compiled: true, executed: true, passed: false, valid: false,
          failureType: 'TEST_ASSERTION', generationDurationMs: 120, executionDurationMs: 220, totalDurationMs: 340,
          inputTokens: 110, outputTokens: 55, totalTokens: 165, estimatedCost: 0.011,
          retrievedChunks: 6, selectedChunks: 3, contextTokens: 600, toolCalls: null, filesInspected: null,
        },
        {
          repetition: 3, strategy: 'RAG', compiled: false, executed: false, passed: false, valid: false,
          failureType: 'COMPILATION', generationDurationMs: 90, executionDurationMs: null, totalDurationMs: 90,
          inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
          retrievedChunks: 5, selectedChunks: 2, contextTokens: 550, toolCalls: null, filesInspected: null,
        },
      ]);
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);
      const ragMetrics = results.strategies.find((s) => s.strategy === 'RAG')!;

      expect(ragMetrics.validRate).toBeCloseTo(1 / 3, 6);
      expect(ragMetrics.compilationRate).toBeCloseTo(2 / 3, 6);
      expect(ragMetrics.passedRate).toBeCloseTo(1 / 3, 6);
      expect(ragMetrics.generationDurationMs).toBe(Math.round((100 + 120 + 90) / 3));
      // el promedio de tokens ignora los null, no los trata como 0
      expect(ragMetrics.inputTokens).toBe(Math.round((100 + 110) / 2));
      expect(ragMetrics.failures).toEqual({ NONE: 1, TEST_ASSERTION: 1, COMPILATION: 1 });
      expect(results.repetitionsPerStrategy).toBe(3);
      expect(results.completedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('excludes technically non-evaluable repetitions from rates, means and failures, keeping the response shape (WI-CORE-025 (5))', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([
        {
          repetition: 1, strategy: 'RAG', compiled: true, executed: true, passed: true, valid: true,
          failureType: 'NONE', generationDurationMs: 100, executionDurationMs: 200, totalDurationMs: 300,
          inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0.01,
          retrievedChunks: 4, selectedChunks: 2, contextTokens: 500, toolCalls: null, filesInspected: null,
          technicallyEvaluable: true,
        },
        {
          repetition: 2, strategy: 'RAG', compiled: true, executed: true, passed: false, valid: false,
          failureType: 'TEST_ASSERTION', generationDurationMs: 120, executionDurationMs: 220, totalDurationMs: 340,
          inputTokens: 110, outputTokens: 55, totalTokens: 165, estimatedCost: 0.011,
          retrievedChunks: 6, selectedChunks: 3, contextTokens: 600, toolCalls: null, filesInspected: null,
          technicallyEvaluable: true,
        },
        {
          repetition: 3, strategy: 'RAG', compiled: null, executed: null, passed: null, valid: false,
          failureType: 'INFRASTRUCTURE', generationDurationMs: 999_999, executionDurationMs: null, totalDurationMs: 999_999,
          inputTokens: 9_999, outputTokens: 9_999, totalTokens: 19_998, estimatedCost: 9.9,
          retrievedChunks: null, selectedChunks: null, contextTokens: null, toolCalls: null, filesInspected: null,
          technicallyEvaluable: false,
        },
      ]);
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);
      const rag = results.strategies.find((s) => s.strategy === 'RAG')!;

      expect(rag.validRate).toBeCloseTo(1 / 2, 6);
      expect(rag.compilationRate).toBe(1);
      expect(rag.passedRate).toBeCloseTo(1 / 2, 6);
      expect(rag.generationDurationMs).toBe(Math.round((100 + 120) / 2));
      expect(rag.inputTokens).toBe(Math.round((100 + 110) / 2));
      expect(rag.failures).toEqual({ NONE: 1, TEST_ASSERTION: 1 });
      expect(Object.keys(rag).sort()).toEqual(
        Object.keys(results.strategies.find((s) => s.strategy === 'GENERALIST_AGENT')!).sort(),
      );
      // La lista de repeticiones sigue mostrando todos los slots, con su bandera.
      expect(results.repetitions.filter((r) => r.technicallyEvaluable === false)).toHaveLength(1);
    });

    it('answers null rates and means, never NaN nor 0, with counters 0/3 when every repetition of a strategy is non-evaluable (WI-CORE-025 (5), WI-CORE-027 DEC-EVID-001)', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1',
        projectVersionId: 'version-1',
        targetId: 'target-1',
        status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const nonEvaluable = (repetition: number) => ({
        repetition, strategy: 'GENERALIST_AGENT', compiled: null, executed: null, passed: null, valid: false,
        failureType: 'INFRASTRUCTURE', generationDurationMs: 50, executionDurationMs: null, totalDurationMs: 50,
        inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
        retrievedChunks: null, selectedChunks: null, contextTokens: null, toolCalls: 1, filesInspected: 0,
        technicallyEvaluable: false,
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([1, 2, 3].map(nonEvaluable));
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);
      const agent = results.strategies.find((s) => s.strategy === 'GENERALIST_AGENT')!;

      expect(agent).toMatchObject({
        evaluableRepetitions: 0,
        nonEvaluableRepetitions: 3,
        validRate: null,
        compilationRate: null,
        executionRate: null,
        passedRate: null,
        generationDurationMs: null,
        executionDurationMs: null,
        totalDurationMs: null,
        inputTokens: null,
        estimatedCost: null,
        failures: {},
      });
      expect(JSON.stringify(agent)).not.toContain('NaN');
    });

    it('counts evaluable and non-evaluable repetitions with a mixed 2/1 split and ignores the non-evaluable slot in every metric (WI-CORE-027)', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1', projectVersionId: 'version-1', targetId: 'target-1', status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const row = (overrides: Record<string, unknown>) => ({
        strategy: 'RAG', attempt: 1, compiled: true, executed: true, passed: true, valid: true, failureType: 'NONE',
        generationDurationMs: 100, executionDurationMs: 200, totalDurationMs: 300,
        inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
        retrievedChunks: null, selectedChunks: null, contextTokens: null, toolCalls: null, filesInspected: null,
        technicallyEvaluable: true, ...overrides,
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([
        row({ repetition: 1 }),
        row({ repetition: 2, passed: false, valid: false, failureType: 'TEST_ASSERTION', generationDurationMs: 101, executionDurationMs: null, totalDurationMs: 101 }),
        row({ repetition: 3, compiled: false, executed: false, passed: false, valid: false, failureType: 'INFRASTRUCTURE',
          generationDurationMs: 9_999, executionDurationMs: 9_999, totalDurationMs: 9_999, technicallyEvaluable: false }),
      ]);
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);
      const rag = results.strategies.find((s) => s.strategy === 'RAG')!;

      expect(rag.evaluableRepetitions).toBe(2);
      expect(rag.nonEvaluableRepetitions).toBe(1);
      expect(rag.validRate).toBe(1 / 2);
      expect(rag.compilationRate).toBe(1);
      expect(rag.passedRate).toBe(1 / 2);
      expect(rag.generationDurationMs).toBe(Math.round((100 + 101) / 2));
      // executionDurationMs: media de los no nulos de las evaluables (la no evaluable no cuenta)
      expect(rag.executionDurationMs).toBe(200);
      expect(rag.totalDurationMs).toBe(Math.round((300 + 101) / 2));
      expect(rag.failures).toEqual({ NONE: 1, TEST_ASSERTION: 1 });
      // Estrategia sin filas: contadores 0/0 y métricas null
      const agent = results.strategies.find((s) => s.strategy === 'GENERALIST_AGENT')!;
      expect(agent).toMatchObject({ evaluableRepetitions: 0, nonEvaluableRepetitions: 0, validRate: null, executionDurationMs: null });
    });

    it('keeps a real zero when there are evaluable repetitions and none passed: passedRate 0, not null (WI-CORE-027)', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1', projectVersionId: 'version-1', targetId: 'target-1', status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const failing = (repetition: number) => ({
        repetition, strategy: 'RAG', attempt: 1, compiled: true, executed: true, passed: false, valid: false,
        failureType: 'TEST_ASSERTION', generationDurationMs: 40, executionDurationMs: 60, totalDurationMs: 100,
        inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
        retrievedChunks: null, selectedChunks: null, contextTokens: null, toolCalls: null, filesInspected: null,
        technicallyEvaluable: true,
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([1, 2].map(failing));
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);
      const rag = results.strategies.find((s) => s.strategy === 'RAG')!;

      expect(rag).toMatchObject({ evaluableRepetitions: 2, nonEvaluableRepetitions: 0, passedRate: 0, validRate: 0, executionRate: 1 });
    });

    it('counts pre-OE5 repetitions without technicallyEvaluable as evaluable: n evaluable and 0 non-evaluable (WI-CORE-027)', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1', projectVersionId: 'version-1', targetId: 'target-1', status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([1, 2, 3].map((repetition) => ({
        repetition, strategy: 'RAG', attempt: 1, compiled: true, executed: true, passed: true, valid: true,
        failureType: 'NONE', generationDurationMs: 100, executionDurationMs: 200, totalDurationMs: 300,
        inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
        retrievedChunks: null, selectedChunks: null, contextTokens: null, toolCalls: null, filesInspected: null,
      })));
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);
      const rag = results.strategies.find((s) => s.strategy === 'RAG')!;

      expect(rag).toMatchObject({ evaluableRepetitions: 3, nonEvaluableRepetitions: 0, validRate: 1, passedRate: 1 });
    });

    it('answers executionDurationMs null, not 0, when evaluable repetitions exist but none invoked the Sandbox (WI-CORE-027, DEC-EVID-001)', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1', projectVersionId: 'version-1', targetId: 'target-1', status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const invalidGeneration = (repetition: number) => ({
        repetition, strategy: 'RAG', attempt: 1, compiled: false, executed: false, passed: false, valid: false,
        failureType: 'COMPILATION', generationDurationMs: 70, executionDurationMs: null, totalDurationMs: 70,
        inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
        retrievedChunks: null, selectedChunks: null, contextTokens: null, toolCalls: null, filesInspected: null,
        technicallyEvaluable: true,
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([1, 2, 3].map(invalidGeneration));
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);
      const rag = results.strategies.find((s) => s.strategy === 'RAG')!;

      expect(rag).toMatchObject({
        evaluableRepetitions: 3,
        nonEvaluableRepetitions: 0,
        executionDurationMs: null,
        executionRate: 0,
        generationDurationMs: 70,
        totalDurationMs: 70,
      });
    });

    it('keeps the repetition shape unchanged: ExperimentRepetitionResponse does not gain the strategy counters (WI-CORE-027)', async () => {
      const deps = makeDeps();
      deps.experimentRunsRepository.findByIdForOwner = vi.fn().mockResolvedValue({
        id: 'exp-1', projectVersionId: 'version-1', targetId: 'target-1', status: 'COMPLETED',
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      deps.experimentRunsRepository.findRepetitions = vi.fn().mockResolvedValue([
        {
          repetition: 1, strategy: 'RAG', attempt: 1, compiled: true, executed: true, passed: true, valid: true,
          failureType: 'NONE', errorSummary: null, generationDurationMs: 10, executionDurationMs: 20, totalDurationMs: 30,
          inputTokens: null, outputTokens: null, totalTokens: null, estimatedCost: null,
          retrievedChunks: null, selectedChunks: null, contextTokens: null, toolCalls: null, filesInspected: null,
          pairId: null, pairPosition: null, technicallyEvaluable: true,
        },
      ]);
      const service = makeService(deps);

      const results = await service.getResults('exp-1', OWNER_USER_ID);

      expect(Object.keys(results.repetitions[0]).sort()).toEqual([
        'attempt', 'errorSummary', 'estimatedCost', 'executionDurationMs', 'failureType', 'generationDurationMs',
        'inputTokens', 'outputTokens', 'pairId', 'pairPosition', 'repetition', 'strategy', 'technicallyEvaluable',
        'totalDurationMs', 'totalTokens', 'valid',
      ]);
    });
  });
});
