import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  SandboxAcceptedExecutionError,
  SandboxExecutionService,
  SandboxUnavailableError,
} from './sandbox-execution.service.js';

function makeConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    SANDBOX_URL: 'http://sandbox.local',
    SANDBOX_SERVICE_TOKEN: 'test-service-token',
    SANDBOX_DOWNLOAD_TTL_SECONDS: 300,
    SANDBOX_REQUEST_TIMEOUT_MS: 5000,
    SANDBOX_MAX_POLL_ATTEMPTS: 5,
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as never;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe('SandboxExecutionService', () => {
  const objectStorageService = {
    put: vi.fn().mockResolvedValue(undefined),
    presignGet: vi.fn().mockResolvedValue('https://signed.example/download'),
  };

  beforeEach(() => {
    objectStorageService.put.mockClear();
    objectStorageService.presignGet.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws SandboxUnavailableError when SANDBOX_URL is not configured', async () => {
    const service = new SandboxExecutionService(
      makeConfigService({ SANDBOX_URL: undefined }),
      objectStorageService as never,
    );

    await expect(
      service.execute({
        requestId: 'request-1',
        testRunId: 'run-1',
        projectVersionId: 'version-1',
        snapshotKey: 'key',
        snapshotBuffer: Buffer.from('zip'),
        artifacts: [],
        scope: 'TARGET',
        targetIds: ['target-1'],
        runnerHint: 'VITEST',
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  it('throws SandboxUnavailableError when SANDBOX_SERVICE_TOKEN is not configured (DEC-AUTH-001)', async () => {
    const service = new SandboxExecutionService(
      makeConfigService({ SANDBOX_SERVICE_TOKEN: undefined }),
      objectStorageService as never,
    );

    await expect(
      service.execute({
        requestId: 'request-1',
        testRunId: 'run-1',
        projectVersionId: 'version-1',
        snapshotKey: 'key',
        snapshotBuffer: Buffer.from('zip'),
        artifacts: [],
        scope: 'TARGET',
        targetIds: ['target-1'],
        runnerHint: 'VITEST',
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  it('uploads each artifact, posts the execution and polls until a terminal status, then fetches the result', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-1', pollAfterMs: 1 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: 'RUNNING_TESTS', pollAfterMs: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'COMPLETED',
          facts: {
            runner: 'VITEST',
            compiled: true,
            executed: true,
            passed: true,
            totalTests: 1,
            passedTests: 1,
            failedTests: 0,
            skippedTests: 0,
            testCases: [],
            testCasesTruncated: false,
          },
          failure: null,
          stageDurations: [
            { stage: 'COMPILING', durationMs: 120 },
            { stage: 'RUNNING_TESTS', durationMs: 340 },
          ],
        }),
      );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );

    const result = await service.execute({
      requestId: 'request-1',
      testRunId: 'run-1',
      projectVersionId: 'version-1',
      snapshotKey: 'snapshot-key',
      snapshotBuffer: Buffer.from('zip-bytes'),
      artifacts: [
        {
          artifactId: 'artifact-1',
          relativePath: 'src/foo.spec.ts',
          artifactType: 'CREATED',
          content: Buffer.from('test content'),
        },
      ],
      scope: 'TARGET',
      targetIds: ['target-1'],
      runnerHint: 'VITEST',
    });

    expect(objectStorageService.put).toHaveBeenCalledTimes(1);
    expect(objectStorageService.presignGet).toHaveBeenCalledTimes(2); // snapshot + 1 artifact
    expect(fetchMock).toHaveBeenCalledTimes(4); // POST + 2 status polls + result

    const postCall = fetchMock.mock.calls[0];
    expect(postCall[0]).toBe('http://sandbox.local/executions');
    const postedBody = JSON.parse(postCall[1].body);
    expect(postedBody.snapshot.role).toBe('PROJECT_SNAPSHOT');
    expect(postedBody.executionProfile).toBe('NODE_TYPESCRIPT');
    expect(postedBody).not.toHaveProperty('projectRoot');
    expect(postedBody.runnerHint).toBe('VITEST');
    expect(postedBody.artifacts[0].download.role).toBe('GENERATED_ARTIFACT');
    expect(postedBody.artifacts[0].download.sha256).toHaveLength(64);
    expect(postCall[1].headers['idempotency-key']).toBe('request-1');
    expect(postCall[1].headers['x-correlation-id']).toBeTruthy();
    expect(postCall[1].headers.authorization).toBe('Bearer test-service-token');
    const statusPollCall = fetchMock.mock.calls[1];
    expect(statusPollCall[1].headers['x-correlation-id']).toBe(
      postCall[1].headers['x-correlation-id'],
    );
    expect(statusPollCall[1].headers.authorization).toBe(
      'Bearer test-service-token',
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.facts?.passed).toBe(true);
    expect(result.stageDurations).toEqual([
      { stage: 'COMPILING', durationMs: 120 },
      { stage: 'RUNNING_TESTS', durationMs: 340 },
    ]);
  });

  it('sends the NODE_TYPESCRIPT profile for Jest executions', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-jest', pollAfterMs: 0 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'COMPLETED',
          facts: null,
          failure: null,
          stageDurations: [],
        }),
      );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );
    await service.execute({
      requestId: 'request-jest',
      testRunId: 'run-jest',
      projectVersionId: 'version-jest',
      snapshotKey: 'snapshot-key',
      snapshotBuffer: Buffer.from('zip-bytes'),
      artifacts: [],
      scope: 'TARGET',
      targetIds: ['target-1'],
      runnerHint: 'JEST',
    });

    const postedBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(postedBody.executionProfile).toBe('NODE_TYPESCRIPT');
    expect(postedBody.runnerHint).toBe('JEST');
  });

  it('sends the frozen PHP projectRoot without changing request identity or repo-relative artifact paths (WI-CORE-037)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-php', pollAfterMs: 0 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'COMPLETED',
          facts: null,
          failure: null,
          stageDurations: [],
        }),
      );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );
    await service.execute({
      requestId: 'stable-generation-request-id',
      testRunId: 'run-php',
      projectVersionId: 'version-php',
      snapshotKey: 'snapshot-key',
      snapshotBuffer: Buffer.from('zip-bytes'),
      artifacts: [
        {
          artifactId: 'artifact-php',
          relativePath: 'backend/tests/Unit/CalculatorTest.php',
          artifactType: 'CREATED',
          content: Buffer.from('<?php'),
        },
      ],
      scope: 'TARGET',
      targetIds: ['target-php'],
      runnerHint: 'PHPUNIT',
      projectRoot: 'backend',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const postedBody = JSON.parse(init.body as string);
    expect(url).toBe('http://sandbox.local/executions');
    expect(postedBody).toMatchObject({
      requestId: 'stable-generation-request-id',
      projectRoot: 'backend',
      runnerHint: 'PHPUNIT',
      executionProfile: 'PHP_LARAVEL_PHPUNIT',
      artifacts: [
        expect.objectContaining({
          relativePath: 'backend/tests/Unit/CalculatorTest.php',
        }),
      ],
    });
    expect(
      init.headers &&
        (init.headers as Record<string, string>)['idempotency-key'],
    ).toBe('stable-generation-request-id');
  });

  it('sends the executionProfile persisted on the experiment when the request carries it (WI-CORE-025)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-profile', pollAfterMs: 0 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'COMPLETED',
          facts: null,
          failure: null,
          stageDurations: [],
        }),
      );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );
    await service.execute({
      requestId: 'request-profile',
      testRunId: 'run-profile',
      projectVersionId: 'version-profile',
      snapshotKey: 'snapshot-key',
      snapshotBuffer: Buffer.from('zip-bytes'),
      artifacts: [],
      scope: 'TARGET',
      targetIds: ['target-1'],
      runnerHint: 'VITEST',
      executionProfile: 'NODE_TYPESCRIPT',
    });

    const postedBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(postedBody.executionProfile).toBe('NODE_TYPESCRIPT');
    expect(postedBody.runnerHint).toBe('VITEST');
  });

  it('never leaks the signed download URL into a thrown error message (redaction)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );

    await expect(
      service.execute({
        requestId: 'request-1',
        testRunId: 'run-1',
        projectVersionId: 'version-1',
        snapshotKey: 'snapshot-key',
        snapshotBuffer: Buffer.from('zip'),
        artifacts: [
          {
            artifactId: 'artifact-1',
            relativePath: 'src/foo.spec.ts',
            artifactType: 'CREATED',
            content: Buffer.from('content'),
          },
        ],
        scope: 'TARGET',
        targetIds: ['target-1'],
        runnerHint: 'VITEST',
      }),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining('signed.example'),
    });
  });

  it('throws SandboxUnavailableError when the HTTP call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );

    await expect(
      service.execute({
        requestId: 'request-1',
        testRunId: 'run-1',
        projectVersionId: 'version-1',
        snapshotKey: 'key',
        snapshotBuffer: Buffer.from('zip'),
        artifacts: [],
        scope: 'TARGET',
        targetIds: ['target-1'],
        runnerHint: 'JEST',
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  it('logs the failure message sanitized, without secrets (WI-CORE-027, IDEA-016)', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-1', pollAfterMs: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'FAILED' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'FAILED',
          facts: null,
          failure: {
            stage: 'INSTALLING_DEPENDENCIES',
            category: 'DEPENDENCY',
            code: 'NPM_INSTALL_FAILED',
            message:
              'clone https://user:hunter@git.example/r.git password hunter2 Cookie: sid=9',
          },
          stageDurations: [],
        }),
      );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );

    await service.execute({
      requestId: 'request-1',
      testRunId: 'run-1',
      projectVersionId: 'version-1',
      snapshotKey: 'key',
      snapshotBuffer: Buffer.from('zip'),
      artifacts: [],
      scope: 'TARGET',
      targetIds: ['target-1'],
      runnerHint: 'VITEST',
    });

    const logged = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain(
      'clone https://[REDACTED]@git.example/r.git password [REDACTED] Cookie: [REDACTED]',
    );
    expect(logged).not.toMatch(/hunter|sid=9|user:/);

    warnSpy.mockRestore();
  });

  it('logs the detailed sandbox failure reason when the result includes one', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-1', pollAfterMs: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'FAILED' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'FAILED',
          facts: null,
          failure: {
            stage: 'INSTALLING_DEPENDENCIES',
            category: 'DEPENDENCY',
            code: 'NPM_INSTALL_FAILED',
            message: "No matching version found for 'left-pad@^99.0.0'.",
          },
          stageDurations: [],
        }),
      );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );

    const result = await service.execute({
      requestId: 'request-1',
      testRunId: 'run-1',
      projectVersionId: 'version-1',
      snapshotKey: 'key',
      snapshotBuffer: Buffer.from('zip'),
      artifacts: [],
      scope: 'TARGET',
      targetIds: ['target-1'],
      runnerHint: 'VITEST',
    });

    expect(result.failure?.category).toBe('DEPENDENCY');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "No matching version found for 'left-pad@^99.0.0'.",
      ),
    );

    warnSpy.mockRestore();
  });

  it('throws SandboxUnavailableError after exceeding the max poll attempts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ executionId: 'exec-1', pollAfterMs: 1 }),
    );
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'RUNNING_TESTS', pollAfterMs: 1 }),
    );

    const service = new SandboxExecutionService(
      makeConfigService({ SANDBOX_MAX_POLL_ATTEMPTS: 2 }),
      objectStorageService as never,
    );

    await expect(
      service.execute({
        requestId: 'request-1',
        testRunId: 'run-1',
        projectVersionId: 'version-1',
        snapshotKey: 'key',
        snapshotBuffer: Buffer.from('zip'),
        artifacts: [],
        scope: 'TARGET',
        targetIds: ['target-1'],
        runnerHint: 'JEST',
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  it('returns the executionId accepted by the Sandbox and the effective execution profile (WI-CORE-026)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-accepted', pollAfterMs: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'COMPLETED', facts: null, failure: null }),
      );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );
    const base = {
      requestId: 'request-1',
      testRunId: 'run-1',
      projectVersionId: 'version-1',
      snapshotKey: 'key',
      snapshotBuffer: Buffer.from('zip'),
      artifacts: [],
      scope: 'TARGET' as const,
      targetIds: ['target-1'],
    };

    const derived = await service.execute({ ...base, runnerHint: 'JEST' });
    expect(derived).toMatchObject({
      executionId: 'exec-accepted',
      executionProfile: 'NODE_TYPESCRIPT',
      status: 'COMPLETED',
    });

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-persisted', pollAfterMs: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'COMPLETED', facts: null, failure: null }),
      );
    const persisted = await service.execute({
      ...base,
      runnerHint: 'VITEST',
      executionProfile: 'NODE_TYPESCRIPT',
    });
    expect(persisted).toMatchObject({
      executionId: 'exec-persisted',
      executionProfile: 'NODE_TYPESCRIPT',
    });
  });

  it('maps runnerHint PHPUNIT to PHP_LARAVEL_PHPUNIT and never sends phase in the body (WI-CORE-013, regla 4)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-php', pollAfterMs: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'COMPLETED', facts: null, failure: null }),
      );

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );
    const result = await service.execute({
      requestId: 'request-php',
      testRunId: 'run-1',
      projectVersionId: 'version-1',
      snapshotKey: 'key',
      snapshotBuffer: Buffer.from('zip'),
      artifacts: [],
      scope: 'TARGET',
      targetIds: ['target-1'],
      runnerHint: 'PHPUNIT',
    });

    expect(result).toMatchObject({
      executionId: 'exec-php',
      executionProfile: 'PHP_LARAVEL_PHPUNIT',
    });
    const postedBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(postedBody.executionProfile).toBe('PHP_LARAVEL_PHPUNIT');
    expect(postedBody.runnerHint).toBe('PHPUNIT');
    expect(postedBody).not.toHaveProperty('phase');
  });

  it('keeps the executionId in the error when the Sandbox accepted the execution but never produced a result (WI-CORE-026)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ executionId: 'exec-lost', pollAfterMs: 1 }),
    );
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'RUNNING_TESTS', pollAfterMs: 1 }),
    );

    const service = new SandboxExecutionService(
      makeConfigService({ SANDBOX_MAX_POLL_ATTEMPTS: 2 }),
      objectStorageService as never,
    );

    const failure = await service
      .execute({
        requestId: 'request-1',
        testRunId: 'run-1',
        projectVersionId: 'version-1',
        snapshotKey: 'key',
        snapshotBuffer: Buffer.from('zip'),
        artifacts: [],
        scope: 'TARGET',
        targetIds: ['target-1'],
        runnerHint: 'JEST',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SandboxAcceptedExecutionError);
    expect(failure).toBeInstanceOf(SandboxUnavailableError);
    expect(failure).toMatchObject({
      executionId: 'exec-lost',
      executionProfile: 'NODE_TYPESCRIPT',
    });
  });

  it('does not invent an executionId when the Sandbox never accepted the execution (WI-CORE-026)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
    vi.stubGlobal('fetch', fetchMock);

    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );
    const failure = await service
      .execute({
        requestId: 'request-1',
        testRunId: 'run-1',
        projectVersionId: 'version-1',
        snapshotKey: 'key',
        snapshotBuffer: Buffer.from('zip'),
        artifacts: [],
        scope: 'TARGET',
        targetIds: ['target-1'],
        runnerHint: 'JEST',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SandboxUnavailableError);
    expect(failure).not.toBeInstanceOf(SandboxAcceptedExecutionError);
  });

  it('never sends functional rules to Sandbox: the posted body has only the execution contract keys (WI-CORE-021)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-1', pollAfterMs: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'COMPLETED',
          facts: {
            runner: 'VITEST',
            compiled: true,
            executed: true,
            passed: true,
            totalTests: 1,
            passedTests: 1,
            failedTests: 0,
            skippedTests: 0,
            testCases: [],
            testCasesTruncated: false,
          },
          failure: null,
          stageDurations: [],
        }),
      );
    const objectStorageService = {
      put: vi.fn().mockResolvedValue(undefined),
      presignGet: vi.fn().mockResolvedValue('https://signed.example/download'),
    };
    const service = new SandboxExecutionService(
      makeConfigService(),
      objectStorageService as never,
    );

    await service.execute({
      requestId: 'request-1',
      testRunId: 'run-1',
      projectVersionId: 'version-1',
      snapshotKey: 'snapshot-key',
      snapshotBuffer: Buffer.from('zip-bytes'),
      artifacts: [],
      scope: 'TARGET',
      targetIds: ['target-1'],
      runnerHint: 'VITEST',
      // Simula un llamador que intentara colar reglas: el servicio no debe reenviarlas.
      functionalRules: [
        { knowledgeId: 'rule-1', normalizedRule: 'REGLA_NO_PERMITIDA' },
      ],
    } as never);

    const postedBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(postedBody).sort()).toEqual(
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
      ].sort(),
    );
    const serialized = JSON.stringify(postedBody);
    expect(serialized).not.toContain('functionalRules');
    expect(serialized).not.toContain('REGLA_NO_PERMITIDA');
  });

  describe('identidad y duración de la llamada real (WI-CORE-027)', () => {
    const request = {
      requestId: 'request-27',
      testRunId: 'run-1',
      projectVersionId: 'version-1',
      snapshotKey: 'key',
      snapshotBuffer: Buffer.from('zip'),
      artifacts: [],
      scope: 'TARGET' as const,
      targetIds: ['target-1'],
      runnerHint: 'JEST' as const,
    };

    function headerOf(call: unknown[]): string | undefined {
      const init = call[1] as { headers: Record<string, string> };
      return init.headers['x-correlation-id'];
    }

    it('returns the requestId sent, the correlation id sent on every call, and a non-negative duration', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ executionId: 'exec-ev', pollAfterMs: 1 }),
        )
        .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
        .mockResolvedValueOnce(
          jsonResponse({ status: 'COMPLETED', facts: null, failure: null }),
        );

      const service = new SandboxExecutionService(
        makeConfigService(),
        objectStorageService as never,
      );
      const result = await service.execute(request);

      expect(result.requestId).toBe('request-27');
      expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(fetchMock.mock.calls.map(headerOf)).toEqual([
        result.correlationId,
        result.correlationId,
        result.correlationId,
      ]);
      expect(Number.isInteger(result.durationMs)).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('carries the requestId, correlation id and duration in the accepted error when the execution fails afterwards', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ executionId: 'exec-lost-27', pollAfterMs: 1 }),
      );
      fetchMock.mockResolvedValue(
        jsonResponse({ status: 'RUNNING_TESTS', pollAfterMs: 1 }),
      );

      const service = new SandboxExecutionService(
        makeConfigService({ SANDBOX_MAX_POLL_ATTEMPTS: 2 }),
        objectStorageService as never,
      );
      const failure = await service
        .execute(request)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(SandboxAcceptedExecutionError);
      expect(failure).toMatchObject({
        executionId: 'exec-lost-27',
        requestId: 'request-27',
      });
      expect((failure as SandboxAcceptedExecutionError).correlationId).toBe(
        headerOf(fetchMock.mock.calls[0]),
      );
      expect(
        (failure as SandboxAcceptedExecutionError).durationMs,
      ).toBeGreaterThanOrEqual(0);
    });

    it('invents no identifiers for a failure before the Sandbox accepted the request', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 503));
      vi.stubGlobal('fetch', fetchMock);

      const service = new SandboxExecutionService(
        makeConfigService(),
        objectStorageService as never,
      );
      const failure = await service
        .execute(request)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(SandboxUnavailableError);
      expect(failure).not.toHaveProperty('requestId');
      expect(failure).not.toHaveProperty('correlationId');
      expect(failure).not.toHaveProperty('durationMs');
    });
  });

  describe('evidencia acotada y tiempos del Sandbox (WI-CORE-060)', () => {
    const baseFacts = {
      runner: 'VITEST',
      compiled: true,
      executed: true,
      passed: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      testCases: [],
      testCasesTruncated: false,
    };

    async function runWithResult(resultBody: Record<string, unknown>) {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ executionId: 'exec-ev', pollAfterMs: 1 }))
        .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
        .mockResolvedValueOnce(jsonResponse(resultBody));
      const service = new SandboxExecutionService(makeConfigService(), objectStorageService as never);
      return service.execute({
        requestId: 'request-ev',
        testRunId: 'run-ev',
        projectVersionId: 'version-ev',
        snapshotKey: 'snapshot-key',
        snapshotBuffer: Buffer.from('zip-bytes'),
        artifacts: [],
        scope: 'TARGET',
        targetIds: ['target-1'],
        runnerHint: 'VITEST',
      });
    }

    it('conserva evidence, startedAt y completedAt cuando el Sandbox los devuelve', async () => {
      const evidence = [
        { kind: 'TEST_STDERR', stage: 'RUNNING_TESTS', content: 'boom', truncated: false, originalBytes: 4 },
      ];
      const result = await runWithResult({
        status: 'COMPLETED',
        facts: baseFacts,
        failure: null,
        stageDurations: [],
        evidence,
        startedAt: '2026-10-13T10:00:00.000Z',
        completedAt: '2026-10-13T10:00:05.000Z',
      });

      expect(result.evidence).toEqual(evidence);
      expect(result.startedAt).toBe('2026-10-13T10:00:00.000Z');
      expect(result.completedAt).toBe('2026-10-13T10:00:05.000Z');
      expect(result.status).toBe('COMPLETED');
      expect(result.facts?.passed).toBe(true);
    });

    it('devuelve evidence vacio y startedAt/completedAt en null cuando el Sandbox no los envia', async () => {
      const result = await runWithResult({
        status: 'COMPLETED',
        facts: baseFacts,
        failure: null,
        stageDurations: [],
      });

      expect(result.evidence).toEqual([]);
      expect(result.startedAt).toBeNull();
      expect(result.completedAt).toBeNull();
    });

    it('descarta entradas de evidencia malformadas sin romper el resultado', async () => {
      const result = await runWithResult({
        status: 'FAILED',
        facts: null,
        failure: { stage: 'COMPILING', category: 'COMPILATION', code: 'X', message: 'm' },
        stageDurations: [],
        evidence: [
          { kind: 'COMPILER_STDERR', stage: 'COMPILING', content: 'ok', truncated: false, originalBytes: 2 },
          { kind: 'UNKNOWN_KIND', stage: null, content: 'x', truncated: false, originalBytes: 1 },
          { kind: 'TEST_STDOUT', stage: null, content: 42, truncated: false, originalBytes: 2 },
          { kind: 'TEST_STDOUT', stage: null, content: 'y', truncated: 'si', originalBytes: 1 },
          null,
          'basura',
        ],
        startedAt: 12345,
        completedAt: undefined,
      });

      expect(result.evidence).toEqual([
        { kind: 'COMPILER_STDERR', stage: 'COMPILING', content: 'ok', truncated: false, originalBytes: 2 },
      ]);
      expect(result.startedAt).toBeNull();
      expect(result.completedAt).toBeNull();
      expect(result.status).toBe('FAILED');
      expect(result.failure?.code).toBe('X');
    });

    it('trata evidence que no es arreglo como ausente', async () => {
      const result = await runWithResult({
        status: 'COMPLETED',
        facts: baseFacts,
        failure: null,
        stageDurations: [],
        evidence: { kind: 'TEST_STDOUT' },
      });

      expect(result.evidence).toEqual([]);
    });
  });
});

describe('SandboxExecutionService stage timestamps (WI-CORE-061)', () => {
  const storage = {
    put: vi.fn().mockResolvedValue(undefined),
    presignGet: vi.fn().mockResolvedValue('https://signed.example/download'),
  };

  async function runWithStages(stageDurations: unknown) {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ executionId: 'exec-ts', pollAfterMs: 0 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'COMPLETED', facts: null, failure: null, stageDurations }),
      );
    const service = new SandboxExecutionService(makeConfigService(), storage as never);
    return service.execute({
      requestId: 'request-ts',
      testRunId: 'run-ts',
      projectVersionId: 'version-ts',
      snapshotKey: 'snapshot-key',
      snapshotBuffer: Buffer.from('zip-bytes'),
      artifacts: [],
      scope: 'TARGET',
      targetIds: ['target-1'],
      runnerHint: 'VITEST',
    });
  }

  it('conserva startedAt/completedAt ISO-8601 UTC válidos por etapa', async () => {
    const result = await runWithStages([
      { stage: 'COMPILING', durationMs: 120, startedAt: '2026-10-14T06:30:33.225Z', completedAt: '2026-10-14T06:30:33.345Z' },
      { stage: 'RUNNING_TESTS', durationMs: 340, startedAt: '2026-10-14T06:30:34.000Z', completedAt: '2026-10-14T06:30:34.340Z' },
    ]);
    expect(result.stageDurations).toStrictEqual([
      { stage: 'COMPILING', durationMs: 120, startedAt: '2026-10-14T06:30:33.225Z', completedAt: '2026-10-14T06:30:33.345Z' },
      { stage: 'RUNNING_TESTS', durationMs: 340, startedAt: '2026-10-14T06:30:34.000Z', completedAt: '2026-10-14T06:30:34.340Z' },
    ]);
  });

  it('omite startedAt/completedAt inválidos conservando la etapa y durationMs', async () => {
    const result = await runWithStages([
      {
        stage: 'COMPILING',
        durationMs: 120,
        startedAt: '14/10/2026 06:30',
        completedAt: '2026-10-14T06:30:33.345',
      },
      { stage: 'RUNNING_TESTS', durationMs: 340, startedAt: 1789388400000, completedAt: '' },
      { stage: 'FINALIZING', durationMs: 5, startedAt: null, completedAt: '2026-10-14T06:30:35.000Z' },
    ]);
    expect(result.stageDurations).toStrictEqual([
      { stage: 'COMPILING', durationMs: 120 },
      { stage: 'RUNNING_TESTS', durationMs: 340 },
      { stage: 'FINALIZING', durationMs: 5, completedAt: '2026-10-14T06:30:35.000Z' },
    ]);
  });

  it('un Sandbox sin los campos devuelve las etapas exactamente como antes', async () => {
    const result = await runWithStages([
      { stage: 'COMPILING', durationMs: 120 },
      { stage: 'RUNNING_TESTS', durationMs: 340 },
    ]);
    expect(result.stageDurations).toStrictEqual([
      { stage: 'COMPILING', durationMs: 120 },
      { stage: 'RUNNING_TESTS', durationMs: 340 },
    ]);
  });

  it('stageDurations ausente sigue dando []', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ executionId: 'exec-none', pollAfterMs: 0 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'COMPLETED', facts: null, failure: null }));
    const service = new SandboxExecutionService(makeConfigService(), storage as never);
    const result = await service.execute({
      requestId: 'request-none',
      testRunId: 'run-none',
      projectVersionId: 'version-none',
      snapshotKey: 'snapshot-key',
      snapshotBuffer: Buffer.from('zip-bytes'),
      artifacts: [],
      scope: 'TARGET',
      targetIds: ['target-1'],
      runnerHint: 'VITEST',
    });
    expect(result.stageDurations).toStrictEqual([]);
  });
});
