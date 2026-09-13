import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import AdmZip from 'adm-zip';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { EMBEDDING_PROVIDER } from '../src/providers/providers.constants.js';
import type { EmbeddingProvider } from '../src/providers/embedding-provider.interface.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import { authedRequest, overrideAuthTokenVerifier } from './support/auth-test-support.js';

const OTHER_USER_ID = 'e2e-other-user-versions';

class FakeEmbeddingProvider implements EmbeddingProvider {
  async embedMany(texts: string[]): Promise<number[][]> {
    return texts.map((_, index) =>
      Array.from({ length: 1536 }, (_, dimension) => ((dimension + index) % 7) / 7),
    );
  }
}

function buildValidProjectZip(): Buffer {
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

async function waitForStatus(
  app: INestApplication,
  projectVersionId: string,
  terminalStatuses: string[],
  timeoutMs: number,
): Promise<{ status: string }> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await authedRequest(app).get(`/project-versions/${projectVersionId}`);

    if (terminalStatuses.includes(response.body.status)) {
      return response.body;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`Timed out waiting for status in [${terminalStatuses.join(', ')}]`);
}

describe('Project version indexing (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await overrideAuthTokenVerifier(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(EMBEDDING_PROVIDER)
        .useClass(FakeEmbeddingProvider)
        .overrideProvider(ObjectStorageService)
        .useClass(FakeObjectStorageService),
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

  it('indexes a compatible ZIP end-to-end and exposes the results', async () => {
    const zipBuffer = buildValidProjectZip();

    const acceptedResponse = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Demo E2E Project')
      .attach('file', zipBuffer, 'project.zip')
      .expect(202);

    expect(acceptedResponse.body).toMatchObject({ status: 'PENDING' });
    const { projectId, projectVersionId } = acceptedResponse.body as {
      projectId: string;
      projectVersionId: string;
    };

    const finalStatus = await waitForStatus(app, projectVersionId, ['COMPLETED', 'FAILED'], 15000);
    expect(finalStatus.status).toBe('COMPLETED');

    const results = await authedRequest(app)
      .get(`/project-versions/${projectVersionId}/results`)
      .expect(200);

    expect(results.body).toMatchObject({
      projectId,
      status: 'COMPLETED',
      detectedFramework: 'VITEST',
    });
    expect(results.body.filesProcessed).toBeGreaterThan(0);
    expect(results.body.chunksCount).toBeGreaterThan(0);
    expect(results.body.targetsTotal).toBe(3);
    expect(results.body.targetsWithTest).toBe(2);
    expect(results.body.targetsMissingTest).toBe(1);

    const inventory = await authedRequest(app)
      .get(`/project-versions/${projectVersionId}/test-inventory`)
      .expect(200);

    expect(inventory.body).toMatchObject({
      detectedFramework: 'VITEST',
      targetsTotal: 3,
      targetsWithTest: 2,
      targetsMissingTest: 1,
    });
    expect(inventory.body.targets).toContainEqual(
      expect.objectContaining({
        targetType: 'CLASS',
        symbolName: 'Calculator',
        hasTest: true,
        testFilePaths: ['src/calculator.spec.ts'],
      }),
    );
    expect(inventory.body.targets).toContainEqual(
      expect.objectContaining({ targetType: 'METHOD', methodName: 'add', hasTest: true }),
    );
    expect(inventory.body.targets).toContainEqual(
      expect.objectContaining({ targetType: 'METHOD', methodName: 'subtract', hasTest: false }),
    );
  }, 20000);

  it('rejects an incompatible ZIP synchronously with 422 UNSUPPORTED_PROJECT', async () => {
    const zip = new AdmZip();
    zip.addFile('README.md', Buffer.from('no code here'));

    const response = await authedRequest(app)
      .post('/projects/index')
      .attach('file', zip.toBuffer(), 'project.zip')
      .expect(422);

    expect(response.body.code).toBe('UNSUPPORTED_PROJECT');
  });

  it('lists the versions of a project, most recent first, marking only the latest as current (HU25)', async () => {
    const zipBuffer = buildValidProjectZip();

    const first = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'History Versions E2E Project')
      .attach('file', zipBuffer, 'project.zip')
      .expect(202);
    await waitForStatus(app, first.body.projectVersionId, ['COMPLETED', 'FAILED'], 15000);

    const second = await authedRequest(app)
      .post('/projects/index')
      .field('projectId', first.body.projectId)
      .attach('file', zipBuffer, 'project.zip')
      .expect(202);
    await waitForStatus(app, second.body.projectVersionId, ['COMPLETED', 'FAILED'], 15000);

    const page = await authedRequest(app)
      .get(`/projects/${first.body.projectId}/versions`)
      .query({ limit: 10 })
      .expect(200);

    expect(page.body.items.map((item: { id: string }) => item.id)).toEqual([
      second.body.projectVersionId,
      first.body.projectVersionId,
    ]);
    expect(page.body.items[0]).toMatchObject({ current: true, detectedFramework: 'VITEST' });
    expect(page.body.items[1]).toMatchObject({ current: false, detectedFramework: 'VITEST' });
    expect(page.body.nextCursor).toBeNull();
  }, 30000);

  it('returns a 404 PROJECT_NOT_FOUND when listing versions of an unknown project', async () => {
    const response = await authedRequest(app)
      .get('/projects/00000000-0000-0000-0000-000000000000/versions')
      .expect(404);

    expect(response.body.code).toBe('PROJECT_NOT_FOUND');
  });

  it('blocks a second concurrent indexing for the same project with 409', async () => {
    const zipBuffer = buildValidProjectZip();

    const first = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Concurrent Project')
      .attach('file', zipBuffer, 'project.zip')
      .expect(202);

    const second = await authedRequest(app)
      .post('/projects/index')
      .field('projectId', first.body.projectId)
      .attach('file', zipBuffer, 'project.zip')
      .expect(409);

    expect(second.body.code).toBe('PROJECT_INDEXING_IN_PROGRESS');

    await waitForStatus(app, first.body.projectVersionId, ['COMPLETED', 'FAILED'], 15000);
  }, 20000);

  it('rejects a request without an Authorization header with 401 AUTH_REQUIRED (HU29)', async () => {
    const response = await request(app.getHttpServer())
      .get('/projects/00000000-0000-0000-0000-000000000000/versions')
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('isolates a project and its version by owner: another user gets 404 everywhere (HU29)', async () => {
    const zipBuffer = buildValidProjectZip();

    const created = await authedRequest(app)
      .post('/projects/index')
      .field('name', 'Owner Isolation Project')
      .attach('file', zipBuffer, 'project.zip')
      .expect(202);
    const { projectId, projectVersionId } = created.body as {
      projectId: string;
      projectVersionId: string;
    };
    await waitForStatus(app, projectVersionId, ['COMPLETED', 'FAILED'], 15000);

    const other = authedRequest(app, OTHER_USER_ID);

    await other.get(`/projects/${projectId}/versions`).expect(404);
    await other.get(`/project-versions/${projectVersionId}`).expect(404);
    await other.get(`/project-versions/${projectVersionId}/results`).expect(404);
    await other.get(`/project-versions/${projectVersionId}/test-inventory`).expect(404);
  }, 20000);
});
