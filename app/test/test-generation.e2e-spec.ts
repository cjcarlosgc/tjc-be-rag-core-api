import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import AdmZip from 'adm-zip';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from '../src/providers/providers.constants.js';
import type { EmbeddingProvider } from '../src/providers/embedding-provider.interface.js';
import type { LLMProvider } from '../src/providers/llm-provider.interface.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { SandboxExecutionService } from '../src/sandbox/sandbox-execution.service.js';
import { authedRequest, overrideAuthTokenVerifier } from './support/auth-test-support.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';

const OTHER_USER_ID = 'e2e-other-user-generation';

class FakeEmbeddingProvider implements EmbeddingProvider {
  async embedMany(texts: string[]): Promise<number[][]> {
    return texts.map((_, index) =>
      Array.from({ length: 1536 }, (_, dimension) => ((dimension + index) % 7) / 7),
    );
  }
}

class FakeLLMProvider implements LLMProvider {
  async generate(): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    return {
      content: [
        "import { Calculator } from './calculator.js';",
        '',
        "test('subtract works', () => {",
        '  const calculator = new Calculator();',
        '  expect(calculator.subtract(3, 1)).toBe(2);',
        '});',
      ].join('\n'),
      inputTokens: 50,
      outputTokens: 20,
    };
  }
}

const fakeSandboxExecutionService = {
  execute: vi.fn().mockResolvedValue({
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
      testCases: [{ suitePath: null, name: 'subtract works', status: 'PASSED', durationMs: 5, errorMessage: null }],
      testCasesTruncated: false,
    },
    failure: null,
  }),
};

function buildProjectZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile('package.json', Buffer.from(JSON.stringify({ name: 'demo', version: '1.0.0' })));
  zip.addFile('vitest.config.ts', Buffer.from('export default {};'));
  zip.addFile(
    'src/calculator.ts',
    Buffer.from(
      [
        'export class Calculator {',
        '  add(a: number, b: number): number {',
        '    return a + b;',
        '  }',
        '  subtract(a: number, b: number): number {',
        '    return a - b;',
        '  }',
        '}',
      ].join('\n'),
    ),
  );
  zip.addFile(
    'src/calculator.spec.ts',
    Buffer.from(
      [
        "import { Calculator } from './calculator';",
        '',
        "test('adds', () => {",
        '  const calculator = new Calculator();',
        '  calculator.add(1, 2);',
        '});',
      ].join('\n'),
    ),
  );
  return zip.toBuffer();
}

async function waitForTerminal(
  app: INestApplication,
  path: string,
  terminalStatuses: string[],
  timeoutMs: number,
): Promise<{ status: string }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await authedRequest(app).get(path);

    if (terminalStatuses.includes(response.body.status)) {
      return response.body;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Timed out waiting for status in [${terminalStatuses.join(', ')}] at ${path}`);
}

/**
 * A diferencia de `waitForTerminal`, no asume que "cualquier estado
 * terminal" implica que terminó lo que se está esperando: útil para HU24,
 * donde el run ya estaba en un estado terminal (`PARTIAL`) antes de
 * disparar el reintento, así que hay que esperar una condición concreta
 * (no solo "es terminal") para no leer el estado viejo por una carrera.
 */
async function waitForCondition<T>(
  app: INestApplication,
  path: string,
  predicate: (body: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await authedRequest(app).get(path);

    if (predicate(response.body as T)) {
      return response.body as T;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Timed out waiting for condition at ${path}`);
}

describe('Test generation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await overrideAuthTokenVerifier(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(EMBEDDING_PROVIDER)
        .useClass(FakeEmbeddingProvider)
        .overrideProvider(ObjectStorageService)
        .useClass(FakeObjectStorageService)
        .overrideProvider(LLM_PROVIDER)
        .useClass(FakeLLMProvider)
        .overrideProvider(SandboxExecutionService)
        .useValue(fakeSandboxExecutionService),
    ).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request without an Authorization header with 401 AUTH_REQUIRED (HU29)', async () => {
    const response = await request(app.getHttpServer())
      .post('/test-runs')
      .set('Idempotency-Key', randomUUID())
      .send({ projectId: 'irrelevant', mode: 'PROJECT_MISSING' })
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('generates, validates and persists an artifact for the missing target end-to-end', async () => {
    const indexResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Generation E2E Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    const { projectId, projectVersionId } = indexResponse.body as {
      projectId: string;
      projectVersionId: string;
    };

    await waitForTerminal(app, `/project-versions/${projectVersionId}`, ['COMPLETED', 'FAILED'], 15000);

    const runResponse = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', randomUUID())
      .send({ projectId, mode: 'PROJECT_MISSING' })
      .expect(202);

    expect(runResponse.body).toMatchObject({ projectId, projectVersionId, status: 'PENDING' });
    const { runId } = runResponse.body as { runId: string };

    const finalRun = await waitForTerminal(app, `/test-runs/${runId}`, ['COMPLETED', 'PARTIAL', 'FAILED'], 15000);
    expect(finalRun.status).toBe('COMPLETED');

    const results = await authedRequest(app).get(`/test-runs/${runId}/results`).expect(200);

    expect(results.body).toMatchObject({
      status: 'COMPLETED',
      totalTargets: 1,
      validTargets: 1,
      invalidTargets: 0,
      failedTargets: 0,
    });
    expect(results.body.targets).toHaveLength(1);
    expect(results.body.targets[0]).toMatchObject({
      methodName: 'subtract',
      status: 'VALID',
      validation: expect.objectContaining({ valid: true, failureType: 'NONE' }),
    });

    expect(fakeSandboxExecutionService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'TARGET', runnerHint: 'VITEST' }),
    );

    const artifactsList = await authedRequest(app)
      .get(`/test-runs/${runId}/artifacts`)
      .expect(200);

    expect(artifactsList.body.items).toHaveLength(1);
    const artifact = artifactsList.body.items[0];
    // "subtract" no tenía test propio, pero el archivo co-localizado
    // src/calculator.spec.ts ya existía (cubría "add"): se espera un MERGE,
    // no un archivo nuevo.
    expect(artifact.artifactType).toBe('MODIFIED');
    expect(artifact.valid).toBe(true);

    const download = await authedRequest(app)
      .get(`/artifacts/${artifact.id}/download`)
      .expect(200);

    expect(download.text).toContain('subtract works');
    // el MERGE preserva el test original, no lo reemplaza
    expect(download.text).toContain("test('adds'");

    // MODIFIED sí tiene diff disponible contra el original
    const diffResponse = await authedRequest(app)
      .get(`/artifacts/${artifact.id}/diff`)
      .expect(200);
    expect(diffResponse.body.lines.some((line: { type: string }) => line.type === 'ADDED')).toBe(true);

    const zipDownload = await authedRequest(app)
      .get(`/test-runs/${runId}/artifacts/download`)
      .expect(200);
    expect(zipDownload.headers['content-type']).toBe('application/zip');
  }, 20000);

  it('paginates the test-run history of a ProjectVersion, most recent first', async () => {
    const indexResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'History E2E Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    const { projectId, projectVersionId } = indexResponse.body as {
      projectId: string;
      projectVersionId: string;
    };

    await waitForTerminal(app, `/project-versions/${projectVersionId}`, ['COMPLETED', 'FAILED'], 15000);

    const firstRun = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', randomUUID())
      .send({ projectId, mode: 'PROJECT_MISSING' })
      .expect(202);
    await waitForTerminal(app, `/test-runs/${firstRun.body.runId}`, ['COMPLETED', 'PARTIAL', 'FAILED'], 15000);

    const secondRun = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', randomUUID())
      .send({ projectId, mode: 'PROJECT_ALL' })
      .expect(202);
    await waitForTerminal(app, `/test-runs/${secondRun.body.runId}`, ['COMPLETED', 'PARTIAL', 'FAILED'], 15000);

    const firstPage = await authedRequest(app)
      .get(`/project-versions/${projectVersionId}/test-runs`)
      .query({ limit: 1 })
      .expect(200);

    expect(firstPage.body.items).toHaveLength(1);
    // el más reciente primero
    expect(firstPage.body.items[0].id).toBe(secondRun.body.runId);
    expect(firstPage.body.nextCursor).toBe(secondRun.body.runId);

    const secondPage = await authedRequest(app)
      .get(`/project-versions/${projectVersionId}/test-runs`)
      .query({ limit: 1, cursor: firstPage.body.nextCursor })
      .expect(200);

    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].id).toBe(firstRun.body.runId);
    expect(secondPage.body.nextCursor).toBeNull();
  }, 30000);

  it('retries a manually a failed target (HU24), updating the same artifact in place instead of duplicating it', async () => {
    const indexResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Retry E2E Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    const { projectId, projectVersionId } = indexResponse.body as {
      projectId: string;
      projectVersionId: string;
    };

    await waitForTerminal(app, `/project-versions/${projectVersionId}`, ['COMPLETED', 'FAILED'], 15000);

    // El primer intento falla (assertion fallida); el reintento (mock por
    // defecto del módulo) pasa.
    fakeSandboxExecutionService.execute.mockResolvedValueOnce({
      status: 'COMPLETED',
      facts: {
        runner: 'VITEST',
        compiled: true,
        executed: true,
        passed: false,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          { suitePath: null, name: 'subtract works', status: 'FAILED', durationMs: 4, errorMessage: 'expected 2 to be 3' },
        ],
        testCasesTruncated: false,
      },
      failure: null,
    });

    const runResponse = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', randomUUID())
      .send({ projectId, mode: 'PROJECT_MISSING' })
      .expect(202);
    const { runId } = runResponse.body as { runId: string };

    const failedRun = await waitForTerminal(app, `/test-runs/${runId}`, ['COMPLETED', 'PARTIAL', 'FAILED'], 15000);
    expect(failedRun.status).toBe('PARTIAL');

    const firstResults = await authedRequest(app).get(`/test-runs/${runId}/results`).expect(200);
    expect(firstResults.body).toMatchObject({ status: 'PARTIAL', validTargets: 0, invalidTargets: 1 });
    const target = firstResults.body.targets[0];
    expect(target.status).toBe('INVALID');

    const firstArtifacts = await authedRequest(app).get(`/test-runs/${runId}/artifacts`).expect(200);
    expect(firstArtifacts.body.items).toHaveLength(1);
    expect(firstArtifacts.body.items[0].valid).toBe(false);

    const retryResponse = await authedRequest(app)
      .post(`/test-runs/${runId}/targets/${target.targetId}/retry`)
      .set('Idempotency-Key', randomUUID())
      .expect(202);
    expect(retryResponse.body).toMatchObject({ testRunId: runId, targetId: target.targetId, status: 'PENDING' });

    const retriedRun = await waitForCondition<{ status: string }>(
      app,
      `/test-runs/${runId}`,
      (body) => body.status === 'COMPLETED',
      15000,
    );
    expect(retriedRun.status).toBe('COMPLETED');

    const secondResults = await authedRequest(app).get(`/test-runs/${runId}/results`).expect(200);
    expect(secondResults.body).toMatchObject({ status: 'COMPLETED', validTargets: 1, invalidTargets: 0 });
    expect(secondResults.body.targets[0].status).toBe('VALID');

    // el reintento actualiza el mismo artefacto, no agrega uno nuevo
    const secondArtifacts = await authedRequest(app).get(`/test-runs/${runId}/artifacts`).expect(200);
    expect(secondArtifacts.body.items).toHaveLength(1);
    expect(secondArtifacts.body.items[0].id).toBe(firstArtifacts.body.items[0].id);
    expect(secondArtifacts.body.items[0].valid).toBe(true);

    // ya no se puede reintentar un target VALID
    const retryAgain = await authedRequest(app)
      .post(`/test-runs/${runId}/targets/${target.targetId}/retry`)
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    expect(retryAgain.body.code).toBe('TARGET_RETRY_NOT_ALLOWED');
  }, 30000);

  it('rejects a retry on a run that does not exist with 404 TEST_RUN_NOT_FOUND', async () => {
    const response = await authedRequest(app)
      .post('/test-runs/00000000-0000-0000-0000-000000000000/targets/00000000-0000-0000-0000-000000000000/retry')
      .expect(404);

    expect(response.body.code).toBe('TEST_RUN_NOT_FOUND');
  });

  it('rejects TARGET mode without targetId with 400 INVALID_GENERATION_TARGET', async () => {
    const indexResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Validation Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    await waitForTerminal(
      app,
      `/project-versions/${indexResponse.body.projectVersionId}`,
      ['COMPLETED', 'FAILED'],
      15000,
    );

    const response = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', randomUUID())
      .send({ projectId: indexResponse.body.projectId, mode: 'TARGET' })
      .expect(400);

    expect(response.body.code).toBe('INVALID_GENERATION_TARGET');
  }, 20000);

  it('rejects POST /test-runs without an Idempotency-Key with 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const indexResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Idempotency Missing Key Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    await waitForTerminal(
      app,
      `/project-versions/${indexResponse.body.projectVersionId}`,
      ['COMPLETED', 'FAILED'],
      15000,
    );

    const response = await authedRequest(app)
      .post('/test-runs')
      .send({ projectId: indexResponse.body.projectId, mode: 'PROJECT_MISSING' })
      .expect(400);

    expect(response.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  }, 20000);

  it('rejects POST /test-runs with a malformed Idempotency-Key with 400 INVALID_IDEMPOTENCY_KEY', async () => {
    const indexResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Idempotency Bad Key Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    await waitForTerminal(
      app,
      `/project-versions/${indexResponse.body.projectVersionId}`,
      ['COMPLETED', 'FAILED'],
      15000,
    );

    const response = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ projectId: indexResponse.body.projectId, mode: 'PROJECT_MISSING' })
      .expect(400);

    expect(response.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
  }, 20000);

  it('replays the original 202 when POST /test-runs is repeated with the same Idempotency-Key and body (DEC-IDEMP-001)', async () => {
    const indexResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Idempotency Replay Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    await waitForTerminal(
      app,
      `/project-versions/${indexResponse.body.projectVersionId}`,
      ['COMPLETED', 'FAILED'],
      15000,
    );

    const idempotencyKey = randomUUID();
    const body = { projectId: indexResponse.body.projectId, mode: 'PROJECT_MISSING' };

    const first = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', idempotencyKey)
      .send(body)
      .expect(202);

    const second = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', idempotencyKey)
      .send(body)
      .expect(202);

    expect(second.body).toEqual(first.body);

    const history = await authedRequest(app)
      .get(`/project-versions/${indexResponse.body.projectVersionId}/test-runs`)
      .query({ limit: 10 })
      .expect(200);

    expect(history.body.items.filter((item: { id: string }) => item.id === first.body.runId)).toHaveLength(1);
  }, 20000);

  it('returns 409 IDEMPOTENCY_CONFLICT when the same key is reused with a different body (DEC-IDEMP-001)', async () => {
    const indexResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Idempotency Conflict Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    await waitForTerminal(
      app,
      `/project-versions/${indexResponse.body.projectVersionId}`,
      ['COMPLETED', 'FAILED'],
      15000,
    );

    const idempotencyKey = randomUUID();

    await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', idempotencyKey)
      .send({ projectId: indexResponse.body.projectId, mode: 'PROJECT_MISSING' })
      .expect(202);

    const conflict = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', idempotencyKey)
      .send({ projectId: indexResponse.body.projectId, mode: 'PROJECT_ALL' })
      .expect(409);

    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  }, 20000);

  it('isolates runs, history, retries and artifacts by project owner (HU29)', async () => {
    const indexResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Generation Owner Isolation Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    const { projectId, projectVersionId } = indexResponse.body as {
      projectId: string;
      projectVersionId: string;
    };

    await waitForTerminal(app, `/project-versions/${projectVersionId}`, ['COMPLETED', 'FAILED'], 15000);

    const runResponse = await authedRequest(app)
      .post('/test-runs')
      .set('Idempotency-Key', randomUUID())
      .send({ projectId, mode: 'PROJECT_MISSING' })
      .expect(202);
    const { runId } = runResponse.body as { runId: string };

    await waitForTerminal(app, `/test-runs/${runId}`, ['COMPLETED', 'PARTIAL', 'FAILED'], 15000);

    const results = await authedRequest(app).get(`/test-runs/${runId}/results`).expect(200);
    const artifacts = await authedRequest(app).get(`/test-runs/${runId}/artifacts`).expect(200);
    const targetId = results.body.targets[0].targetId as string;
    const artifactId = artifacts.body.items[0].id as string;
    const other = authedRequest(app, OTHER_USER_ID);

    await other.get(`/test-runs/${runId}`).expect(404);
    await other.get(`/test-runs/${runId}/results`).expect(404);
    await other.get(`/test-runs/${runId}/artifacts`).expect(404);
    await other.get(`/test-runs/${runId}/artifacts/download`).expect(404);
    await other.get(`/project-versions/${projectVersionId}/test-runs`).expect(404);
    await other
      .post(`/test-runs/${runId}/targets/${targetId}/retry`)
      .set('Idempotency-Key', randomUUID())
      .expect(404);
    await other.get(`/artifacts/${artifactId}/download`).expect(404);
    await other.get(`/artifacts/${artifactId}/diff`).expect(404);
  }, 20000);
});
