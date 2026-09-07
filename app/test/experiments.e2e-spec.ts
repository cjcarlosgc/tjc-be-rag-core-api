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
import { GeneralistAgentService } from '../src/generation/agent/generalist-agent.service.js';
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
      content: "test('rag generated', () => { expect(1).toBe(1); });",
      inputTokens: 80,
      outputTokens: 20,
    };
  }
}

const fakeGeneralistAgentService = {
  generate: vi.fn().mockResolvedValue({
    content: "test('agent generated', () => { expect(1).toBe(1); });",
    trajectory: [{ toolName: 'list_files', arguments: {}, result: 'src/calculator.ts' }],
    toolCallCount: 1,
    filesInspected: 1,
    inputTokens: 60,
    outputTokens: 25,
  }),
};

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
      testCases: [],
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
      ['export function add(a: number, b: number): number {', '  return a + b;', '}'].join('\n'),
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

describe('Experimental comparison (e2e)', () => {
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
      .overrideProvider(GeneralistAgentService)
      .useValue(fakeGeneralistAgentService)
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

  it('runs 3 repetitions per strategy and returns aggregated results', async () => {
    const indexResponse = await request(app.getHttpServer())
      .post('/projects/index')
      .field('name', 'Experiment E2E Project')
      .attach('file', buildProjectZip(), 'project.zip')
      .expect(202);

    const { projectId, projectVersionId } = indexResponse.body as {
      projectId: string;
      projectVersionId: string;
    };

    await waitForTerminal(app, `/project-versions/${projectVersionId}`, ['COMPLETED', 'FAILED'], 15000);

    const inventory = await request(app.getHttpServer())
      .get(`/project-versions/${projectVersionId}/test-inventory`)
      .expect(200);

    const target = inventory.body.targets.find((t: { targetType: string }) => t.targetType === 'FUNCTION');
    expect(target).toBeDefined();

    const experimentResponse = await request(app.getHttpServer())
      .post('/experiments')
      .set('Idempotency-Key', randomUUID())
      .send({ projectId, targetId: target.id })
      .expect(202);

    expect(experimentResponse.body).toMatchObject({ projectVersionId, status: 'PENDING' });
    const { experimentId } = experimentResponse.body as { experimentId: string };

    const finalStatus = await waitForTerminal(
      app,
      `/experiments/${experimentId}`,
      ['COMPLETED', 'FAILED'],
      15000,
    );
    expect(finalStatus.status).toBe('COMPLETED');

    const results = await request(app.getHttpServer())
      .get(`/experiments/${experimentId}/results`)
      .expect(200);

    expect(results.body.repetitionsPerStrategy).toBe(3);
    expect(results.body.repetitions).toHaveLength(6);

    const ragRepetitions = results.body.repetitions.filter((r: { strategy: string }) => r.strategy === 'RAG');
    const agentRepetitions = results.body.repetitions.filter(
      (r: { strategy: string }) => r.strategy === 'GENERALIST_AGENT',
    );
    expect(ragRepetitions).toHaveLength(3);
    expect(agentRepetitions).toHaveLength(3);
    expect(ragRepetitions.every((r: { valid: boolean }) => r.valid)).toBe(true);
    expect(agentRepetitions.every((r: { valid: boolean }) => r.valid)).toBe(true);

    const ragMetrics = results.body.strategies.find((s: { strategy: string }) => s.strategy === 'RAG');
    const agentMetrics = results.body.strategies.find(
      (s: { strategy: string }) => s.strategy === 'GENERALIST_AGENT',
    );
    expect(ragMetrics).toMatchObject({ validRate: 1, passedRate: 1 });
    expect(ragMetrics.toolCalls).toBeNull();
    expect(agentMetrics).toMatchObject({ validRate: 1, passedRate: 1, toolCalls: 1, filesInspected: 1 });
    expect(agentMetrics.retrievedChunks).toBeNull();

    expect(fakeGeneralistAgentService.generate).toHaveBeenCalledTimes(3);
    expect(fakeSandboxExecutionService.execute).toHaveBeenCalledTimes(6);
  }, 30000);

  it('rejects an experiment for a CLASS-type target with 400 INVALID_GENERATION_TARGET', async () => {
    const indexResponse = await request(app.getHttpServer())
      .post('/projects/index')
      .field('name', 'Experiment Class Rejection Project')
      .attach(
        'file',
        (() => {
          const zip = new AdmZip();
          zip.addFile('package.json', Buffer.from(JSON.stringify({ name: 'demo', version: '1.0.0' })));
          zip.addFile('vitest.config.ts', Buffer.from('export default {};'));
          zip.addFile(
            'src/greeter.ts',
            Buffer.from(['export class Greeter {', '  greet(): string {', '    return "hi";', '  }', '}'].join('\n')),
          );
          return zip.toBuffer();
        })(),
        'project.zip',
      )
      .expect(202);

    await waitForTerminal(
      app,
      `/project-versions/${indexResponse.body.projectVersionId}`,
      ['COMPLETED', 'FAILED'],
      15000,
    );

    const inventory = await request(app.getHttpServer())
      .get(`/project-versions/${indexResponse.body.projectVersionId}/test-inventory`)
      .expect(200);

    const classTarget = inventory.body.targets.find((t: { targetType: string }) => t.targetType === 'CLASS');
    expect(classTarget).toBeDefined();

    const response = await request(app.getHttpServer())
      .post('/experiments')
      .set('Idempotency-Key', randomUUID())
      .send({ projectId: indexResponse.body.projectId, targetId: classTarget.id })
      .expect(400);

    expect(response.body.code).toBe('INVALID_GENERATION_TARGET');
  }, 20000);
});
