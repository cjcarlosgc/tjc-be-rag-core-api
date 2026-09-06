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
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';

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
    const response = await request(app.getHttpServer()).get(path);

    if (terminalStatuses.includes(response.body.status)) {
      return response.body;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Timed out waiting for status in [${terminalStatuses.join(', ')}] at ${path}`);
}

describe('Test generation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useClass(FakeEmbeddingProvider)
      .overrideProvider(ObjectStorageService)
      .useClass(FakeObjectStorageService)
      .overrideProvider(LLM_PROVIDER)
      .useClass(FakeLLMProvider)
      .overrideProvider(SandboxExecutionService)
      .useValue(fakeSandboxExecutionService)
      .compile();

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

  it('generates, validates and persists an artifact for the missing target end-to-end', async () => {
    const indexResponse = await request(app.getHttpServer())
      .post('/projects/index')
      .field('name', 'Generation E2E Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    const { projectId, projectVersionId } = indexResponse.body as {
      projectId: string;
      projectVersionId: string;
    };

    await waitForTerminal(app, `/project-versions/${projectVersionId}`, ['COMPLETED', 'FAILED'], 15000);

    const runResponse = await request(app.getHttpServer())
      .post('/test-runs')
      .send({ projectId, mode: 'PROJECT_MISSING' })
      .expect(202);

    expect(runResponse.body).toMatchObject({ projectId, projectVersionId, status: 'PENDING' });
    const { runId } = runResponse.body as { runId: string };

    const finalRun = await waitForTerminal(app, `/test-runs/${runId}`, ['COMPLETED', 'PARTIAL', 'FAILED'], 15000);
    expect(finalRun.status).toBe('COMPLETED');

    const results = await request(app.getHttpServer()).get(`/test-runs/${runId}/results`).expect(200);

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

    const artifactsList = await request(app.getHttpServer())
      .get(`/test-runs/${runId}/artifacts`)
      .expect(200);

    expect(artifactsList.body.items).toHaveLength(1);
    const artifact = artifactsList.body.items[0];
    // "subtract" no tenía test propio, pero el archivo co-localizado
    // src/calculator.spec.ts ya existía (cubría "add"): se espera un MERGE,
    // no un archivo nuevo.
    expect(artifact.artifactType).toBe('MODIFIED');
    expect(artifact.valid).toBe(true);

    const download = await request(app.getHttpServer())
      .get(`/artifacts/${artifact.id}/download`)
      .expect(200);

    expect(download.text).toContain('subtract works');
    // el MERGE preserva el test original, no lo reemplaza
    expect(download.text).toContain("test('adds'");

    // MODIFIED sí tiene diff disponible contra el original
    const diffResponse = await request(app.getHttpServer())
      .get(`/artifacts/${artifact.id}/diff`)
      .expect(200);
    expect(diffResponse.body.lines.some((line: { type: string }) => line.type === 'ADDED')).toBe(true);

    const zipDownload = await request(app.getHttpServer())
      .get(`/test-runs/${runId}/artifacts/download`)
      .expect(200);
    expect(zipDownload.headers['content-type']).toBe('application/zip');
  }, 20000);

  it('paginates the test-run history of a ProjectVersion, most recent first', async () => {
    const indexResponse = await request(app.getHttpServer())
      .post('/projects/index')
      .field('name', 'History E2E Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    const { projectId, projectVersionId } = indexResponse.body as {
      projectId: string;
      projectVersionId: string;
    };

    await waitForTerminal(app, `/project-versions/${projectVersionId}`, ['COMPLETED', 'FAILED'], 15000);

    const firstRun = await request(app.getHttpServer())
      .post('/test-runs')
      .send({ projectId, mode: 'PROJECT_MISSING' })
      .expect(202);
    await waitForTerminal(app, `/test-runs/${firstRun.body.runId}`, ['COMPLETED', 'PARTIAL', 'FAILED'], 15000);

    const secondRun = await request(app.getHttpServer())
      .post('/test-runs')
      .send({ projectId, mode: 'PROJECT_ALL' })
      .expect(202);
    await waitForTerminal(app, `/test-runs/${secondRun.body.runId}`, ['COMPLETED', 'PARTIAL', 'FAILED'], 15000);

    const firstPage = await request(app.getHttpServer())
      .get(`/project-versions/${projectVersionId}/test-runs`)
      .query({ limit: 1 })
      .expect(200);

    expect(firstPage.body.items).toHaveLength(1);
    // el más reciente primero
    expect(firstPage.body.items[0].id).toBe(secondRun.body.runId);
    expect(firstPage.body.nextCursor).toBe(secondRun.body.runId);

    const secondPage = await request(app.getHttpServer())
      .get(`/project-versions/${projectVersionId}/test-runs`)
      .query({ limit: 1, cursor: firstPage.body.nextCursor })
      .expect(200);

    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].id).toBe(firstRun.body.runId);
    expect(secondPage.body.nextCursor).toBeNull();
  }, 30000);

  it('rejects TARGET mode without targetId with 400 INVALID_GENERATION_TARGET', async () => {
    const indexResponse = await request(app.getHttpServer())
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

    const response = await request(app.getHttpServer())
      .post('/test-runs')
      .send({ projectId: indexResponse.body.projectId, mode: 'TARGET' })
      .expect(400);

    expect(response.body.code).toBe('INVALID_GENERATION_TARGET');
  }, 20000);
});
