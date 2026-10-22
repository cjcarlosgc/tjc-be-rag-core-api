import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { AUTH_TOKEN_VERIFIER } from '../src/common/auth/auth.constants.js';
import { InvalidTokenError, type TokenVerifierPort } from '../src/common/auth/token-verifier.port.js';
import { AnalysisRunsRepository } from '../src/analysis-runs/analysis-runs.repository.js';
import { AnalysisRunsService } from '../src/analysis-runs/analysis-runs.service.js';
import { ExperimentRealtimeEvents } from '../src/experiments/experiment-realtime.events.js';
import { ExperimentRunsRepository } from '../src/experiments/persistence/experiment-runs.repository.js';
import { GITHUB_ACCESS_PORT } from '../src/github-app/github-access.port.js';
import { GithubAppAuthService } from '../src/github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../src/github-app/github-repository-content.service.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeGithubAccessPort } from './support/fake-github-access.port.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import { InMemoryPrisma } from './support/in-memory-prisma.js';
import { authedRequest, e2eGithubUserId, overrideAuthTokenVerifier } from './support/auth-test-support.js';

/**
 * WI-CORE-074 (INTEROP-2.18 §6.6, DEC-RT-001): cliente real de socket.io-client contra la app Nest levantada en un
 * puerto efímero. Verifica el handshake con sesión obligatoria, las suscripciones por id con Reader sobre el Project,
 * la denegación sin fuga y el corte de avisos al desuscribirse. Los cambios de estado se provocan con los servicios
 * reales de dominio sobre Prisma en memoria; ningún test llama a GitHub, Supabase ni al Sandbox.
 */
const ORG_ID = '42';
const ORG = 'acme';
const REPO = 'acme/widgets';
const OWNER = 'rt-owner';
const READER = 'rt-reader';
const STRANGER = 'rt-stranger';
/** Token que el verificador de pruebas rechaza como inválido o expirado. */
const EXPIRED_TOKEN = 'rt-token-expired';
const gh = e2eGithubUserId;

interface SubscribeAck {
  subscribed: boolean;
  code: string | null;
  retryable: boolean;
}

interface Recorded {
  name: string;
  payload: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Tiempo agotado esperando ${label}`);
    }
    await sleep(10);
  }
}

describe('Tiempo real por socket.io-client (INTEROP-2.18 §6.6, DEC-RT-001, e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let github: FakeGithubAccessPort;
  const prisma = new InMemoryPrisma();
  const sockets: ClientSocket[] = [];
  let ids: { projectId: string; runId: string; experimentId: string };

  beforeAll(async () => {
    github = new FakeGithubAccessPort();

    const builder: TestingModuleBuilder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ObjectStorageService)
      .useClass(FakeObjectStorageService)
      .overrideProvider(GITHUB_ACCESS_PORT)
      .useValue(github)
      .overrideProvider(GithubAppAuthService)
      .useValue({
        findInstallationForRepository: (owner: string, repo: string) =>
          Promise.resolve(`${owner}/${repo}` === REPO ? 'inst-42' : null),
        getAppInfo: () => Promise.resolve({ slug: 'tjc-core', name: 'TJC Core' }),
      })
      .overrideProvider(GithubRepositoryContentService)
      .useValue({ listBranches: () => Promise.resolve([{ name: 'main', protected: false }]) });

    // Token -> userId como en el resto de e2e, salvo `EXPIRED_TOKEN`, que se rechaza como token caducado.
    const verifier: TokenVerifierPort = {
      verify: (token: string) =>
        token === EXPIRED_TOKEN ? Promise.reject(new InvalidTokenError('expired')) : Promise.resolve({ userId: token }),
    };
    const moduleFixture = await overrideAuthTokenVerifier(builder)
      .overrideProvider(AUTH_TOKEN_VERIFIER)
      .useValue(verifier)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    github.reset();
    github
      .addOrganization({ installationId: 'inst-42', organizationId: ORG_ID, organizationLogin: ORG, avatarUrl: null, suspended: false })
      .setMembership(ORG, gh(OWNER), { role: 'admin', state: 'active' })
      .setMembership(ORG, gh(READER), { role: 'member', state: 'active' })
      .addRepository(REPO, { repositoryId: '100', ownerId: ORG_ID, ownerLogin: ORG, ownerType: 'Organization' })
      .setPermission(REPO, gh(OWNER), 'admin')
      .setPermission(REPO, gh(READER), 'read');
    ids = seedProject();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    vi.restoreAllMocks();
  });

  /** Proyecto de organización con binding activo, un Reader con registro de acceso, un Run en QUEUED y un experimento PENDING. */
  function seedProject(): { projectId: string; runId: string; experimentId: string } {
    const project = prisma.insert('project', {
      name: 'realtime-project',
      ownerUserId: OWNER,
      githubOrgId: ORG_ID,
      githubOrgLogin: ORG,
    });
    prisma.insert('repositoryBinding', {
      projectId: project.id,
      installationId: 'inst-42',
      repositoryId: '100',
      repositoryName: REPO,
      integrationBranch: 'main',
      status: 'ENABLED',
      disabledReason: null,
    });
    prisma.insert('projectAccess', { projectId: project.id, userId: OWNER, role: 'ADMIN', verifiedAt: new Date() });
    prisma.insert('projectAccess', { projectId: project.id, userId: READER, role: 'READER', verifiedAt: new Date() });
    const run = prisma.insert('analysisRun', {
      projectId: project.id,
      repositoryId: '100',
      repositoryName: REPO,
      prNumber: 1,
      pullRequestCreatedAt: new Date(Date.now() + 60_000),
      repositoryBindingEligible: true,
      prTitle: 'Cambio de prueba',
      baseRef: 'main',
      headRef: 'feature/rt',
      baseSha: 'a1',
      headSha: 'b2',
      draft: false,
      prState: 'OPEN',
      actorLogin: null,
      status: 'QUEUED',
      current: true,
      attemptCount: 1,
      indexMode: 'BOOTSTRAP',
      changesetBaseSha: 'a1',
      changesetHeadSha: 'b2',
      indexDeltaBaseSha: null,
      functionalBehaviorValidated: false,
      resultSummary: null,
      actionRequiredCount: 0,
      generatedTestsCount: 0,
      completedAt: null,
    });
    const experiment = prisma.insert('experimentRun', {
      projectId: project.id,
      projectVersionId: 'version-rt',
      targetId: 'target-rt',
      status: 'PENDING',
      completedRepetitions: 0,
      totalRepetitions: 6,
      failureCode: null,
      failureMessage: null,
      startedAt: null,
      completedAt: null,
      modelConfig: null,
      randomizationSeed: null,
      budget: null,
      executionProfile: null,
      runnerHint: null,
    });

    return { projectId: project.id as string, runId: run.id as string, experimentId: experiment.id as string };
  }

  function clientFor(auth: Record<string, unknown>, headers?: Record<string, string>): ClientSocket {
    const socket = io(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      autoConnect: false,
      auth,
      extraHeaders: headers,
    });
    sockets.push(socket);
    return socket;
  }

  function connectOk(socket: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error: Error) => reject(error));
      socket.connect();
    });
  }

  function connectRejected(socket: ClientSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      socket.once('connect', () => reject(new Error('El handshake se aceptó sin una sesión válida')));
      socket.once('connect_error', (error: Error & { data?: Record<string, unknown> }) => resolve(error.data ?? {}));
      socket.connect();
    });
  }

  /** Graba los avisos de los nombres indicados: el orden de llegada se conserva. */
  function record(socket: ClientSocket, names: string[]): Recorded[] {
    const received: Recorded[] = [];
    for (const name of names) {
      socket.on(name, (payload: Record<string, unknown>) => received.push({ name, payload }));
    }
    return received;
  }

  const subscribe = (socket: ClientSocket, event: string, body: Record<string, string>): Promise<SubscribeAck> =>
    socket.timeout(3000).emitWithAck(event, body) as Promise<SubscribeAck>;

  const transitionRun = async () => {
    const runs = app.get(AnalysisRunsService);
    const run = await app.get(AnalysisRunsRepository).findById(ids.runId);
    if (!run) throw new Error('El Run de prueba no existe');
    return runs.startProcessing(run);
  };

  const transitionExperiment = async () => {
    await app.get(ExperimentRunsRepository).markStarted(ids.experimentId);
    await app.get(ExperimentRealtimeEvents).statusChanged(ids.experimentId);
  };

  describe('handshake (sesión obligatoria, mismo resolvedor que HTTP)', () => {
    it('sin token rechaza la conexión con AUTH_REQUIRED y retryable: false', async () => {
      const data = await connectRejected(clientFor({}));

      expect(data).toMatchObject({ code: 'AUTH_REQUIRED', retryable: false });
    });

    it('un token inválido o expirado rechaza la conexión con INVALID_ACCESS_TOKEN', async () => {
      const data = await connectRejected(clientFor({ token: EXPIRED_TOKEN }));

      expect(data).toMatchObject({ code: 'INVALID_ACCESS_TOKEN', retryable: false });
    });

    it('acepta el token en auth.token y en la cabecera Authorization: Bearer', async () => {
      const byAuth = clientFor({ token: READER });
      await connectOk(byAuth);
      expect(byAuth.connected).toBe(true);

      const byHeader = clientFor({}, { Authorization: `Bearer ${READER}` });
      await connectOk(byHeader);
      expect(byHeader.connected).toBe(true);
    });
  });

  describe('suscripciones y avisos', () => {
    it('un Reader recibe analysis-run:update tras el cambio de estado, con el mismo DTO que GET /analysis-runs/{id}', async () => {
      const reader = clientFor({ token: READER });
      await connectOk(reader);
      const received = record(reader, ['analysis-run:update']);

      const ack = await subscribe(reader, 'subscribe:analysis-run', { analysisRunId: ids.runId });
      expect(ack).toEqual({ subscribed: true, code: null, retryable: false });

      await transitionRun();
      await waitFor(() => received.length === 1, 'analysis-run:update');

      expect(received[0].payload).toMatchObject({ id: ids.runId, status: 'PROCESSING', current: true });
      const detail = await authedRequest(app, READER).get(`/analysis-runs/${ids.runId}`).expect(200);
      expect(received[0].payload).toEqual(detail.body);
    });

    it('un Reader recibe experiment:update tras el cambio de estado del experimento', async () => {
      const reader = clientFor({ token: READER });
      await connectOk(reader);
      const received = record(reader, ['experiment:update']);

      const ack = await subscribe(reader, 'subscribe:experiment', { experimentId: ids.experimentId });
      expect(ack).toEqual({ subscribed: true, code: null, retryable: false });

      await transitionExperiment();
      await waitFor(() => received.length === 1, 'experiment:update');

      expect(received[0].payload).toMatchObject({ id: ids.experimentId, status: 'RUNNING', completedRepetitions: 0 });
    });

    it('sin ser Reader la suscripción se deniega sin distinguir id inexistente, y no recibe ningún aviso', async () => {
      const stranger = clientFor({ token: STRANGER });
      await connectOk(stranger);
      const strangerReceived = record(stranger, ['analysis-run:update', 'experiment:update']);

      const denied = { subscribed: false, code: null, retryable: false };
      expect(await subscribe(stranger, 'subscribe:analysis-run', { analysisRunId: ids.runId })).toEqual(denied);
      expect(await subscribe(stranger, 'subscribe:experiment', { experimentId: ids.experimentId })).toEqual(denied);
      expect(await subscribe(stranger, 'subscribe:analysis-run', { analysisRunId: '00000000-0000-4000-8000-000000000099' })).toEqual(denied);

      // El Reader sigue recibiendo: así se sabe que el aviso se emitió y que el denegado no lo recibió.
      const reader = clientFor({ token: READER });
      await connectOk(reader);
      const readerReceived = record(reader, ['analysis-run:update']);
      expect(await subscribe(reader, 'subscribe:analysis-run', { analysisRunId: ids.runId })).toEqual({
        subscribed: true,
        code: null,
        retryable: false,
      });

      await transitionRun();
      await waitFor(() => readerReceived.length === 1, 'analysis-run:update del Reader');
      await sleep(200);

      expect(strangerReceived).toEqual([]);
    });

    it('unsubscribe corta los avisos de ese recurso y no afecta a los demás recursos suscritos', async () => {
      const reader = clientFor({ token: READER });
      await connectOk(reader);
      const runEvents = record(reader, ['analysis-run:update']);
      const experimentEvents = record(reader, ['experiment:update']);

      expect(await subscribe(reader, 'subscribe:analysis-run', { analysisRunId: ids.runId })).toMatchObject({ subscribed: true });
      expect(await subscribe(reader, 'subscribe:experiment', { experimentId: ids.experimentId })).toMatchObject({ subscribed: true });

      reader.emit('unsubscribe:analysis-run', { analysisRunId: ids.runId });
      // Barrera: el servidor procesa los mensajes de una conexión en orden, así que este ack llega después del unsubscribe.
      expect(await subscribe(reader, 'subscribe:experiment', { experimentId: ids.experimentId })).toMatchObject({ subscribed: true });

      const run = await app.get(AnalysisRunsRepository).findById(ids.runId);
      if (!run) throw new Error('El Run de prueba no existe');
      await app.get(AnalysisRunsService).closeRun(run, 'CLOSED');
      await sleep(300);
      expect(runEvents).toEqual([]);

      await transitionExperiment();
      await waitFor(() => experimentEvents.length === 1, 'experiment:update tras desuscribir el Run');
    });
  });
});
