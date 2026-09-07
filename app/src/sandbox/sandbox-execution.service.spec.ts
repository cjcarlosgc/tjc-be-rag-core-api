import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { SandboxExecutionService, SandboxUnavailableError } from './sandbox-execution.service.js';

function makeConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    SANDBOX_URL: 'http://sandbox.local',
    SANDBOX_SERVICE_TOKEN: 'test-service-token',
    SANDBOX_DOWNLOAD_TTL_SECONDS: 300,
    SANDBOX_REQUEST_TIMEOUT_MS: 5000,
    SANDBOX_MAX_POLL_ATTEMPTS: 5,
    ...overrides,
  };
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as never;
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
      .mockResolvedValueOnce(jsonResponse({ executionId: 'exec-1', pollAfterMs: 1 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'RUNNING_TESTS', pollAfterMs: 1 }))
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

    const service = new SandboxExecutionService(makeConfigService(), objectStorageService as never);

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
    expect(postedBody.artifacts[0].download.role).toBe('GENERATED_ARTIFACT');
    expect(postedBody.artifacts[0].download.sha256).toHaveLength(64);
    expect(postCall[1].headers['idempotency-key']).toBe('request-1');
    expect(postCall[1].headers['x-correlation-id']).toBeTruthy();
    expect(postCall[1].headers.authorization).toBe('Bearer test-service-token');
    const statusPollCall = fetchMock.mock.calls[1];
    expect(statusPollCall[1].headers['x-correlation-id']).toBe(postCall[1].headers['x-correlation-id']);
    expect(statusPollCall[1].headers.authorization).toBe('Bearer test-service-token');

    expect(result.status).toBe('COMPLETED');
    expect(result.facts?.passed).toBe(true);
    expect(result.stageDurations).toEqual([
      { stage: 'COMPILING', durationMs: 120 },
      { stage: 'RUNNING_TESTS', durationMs: 340 },
    ]);
  });

  it('never leaks the signed download URL into a thrown error message (redaction)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    const service = new SandboxExecutionService(makeConfigService(), objectStorageService as never);

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
    ).rejects.toMatchObject({ message: expect.not.stringContaining('signed.example') });
  });

  it('throws SandboxUnavailableError when the HTTP call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    const service = new SandboxExecutionService(makeConfigService(), objectStorageService as never);

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

  it('logs the detailed sandbox failure reason when the result includes one', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ executionId: 'exec-1', pollAfterMs: 1 }))
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

    const service = new SandboxExecutionService(makeConfigService(), objectStorageService as never);

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
      expect.stringContaining("No matching version found for 'left-pad@^99.0.0'."),
    );

    warnSpy.mockRestore();
  });

  it('throws SandboxUnavailableError after exceeding the max poll attempts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ executionId: 'exec-1', pollAfterMs: 1 }));
    fetchMock.mockResolvedValue(jsonResponse({ status: 'RUNNING_TESTS', pollAfterMs: 1 }));

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
});
