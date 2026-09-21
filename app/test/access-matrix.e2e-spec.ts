import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { ExperimentsService } from '../src/experiments/experiments.service.js';
import { GITHUB_ACCESS_PORT } from '../src/github-app/github-access.port.js';
import { GithubAppAuthService } from '../src/github-app/github-app-auth.service.js';
import { GithubRepositoryContentService } from '../src/github-app/github-repository-content.service.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { ProjectAccessService } from '../src/project-access/project-access.service.js';
import { listRouteAccess, type RouteAccessEntry } from '../src/project-access/route-access-audit.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { GithubUserRepositoriesService } from '../src/repository-bindings/github/github-user-repositories.service.js';
import { RealtimeGateway } from '../src/realtime/realtime.gateway.js';
import { ProjectSubscriptionsService } from '../src/realtime/project-subscriptions.service.js';
import { FakeGithubAccessPort } from './support/fake-github-access.port.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import { InMemoryPrisma } from './support/in-memory-prisma.js';
import { authedRequest, e2eGithubUserId, overrideAuthTokenVerifier } from './support/auth-test-support.js';
import {
  INTEROP_ROLE_MATRIX,
  SECOND_ROW_LISTINGS,
  matrixKey,
  readContractMatrixRows,
  type ContractRole,
  type ContractRow,
} from './support/interop-role-matrix.js';

/**
 * 014, corte 3 (etapa 2b): guard default-deny, matriz rol -> operación de INTEROP-2.4 §6.13,
 * alta por deep link y RealtimeGateway, con fakes de GitHub y Supabase (ningún test llama a
 * servicios reales) y Prisma en memoria.
 */
const ORG_ID = '42';
const ORG = 'acme';
const REPO = 'acme/widgets';

const OWNER = 'mx-owner';
const OWNER_NO_COLLABORATOR = 'mx-owner-2';
const WRITER = 'mx-writer';
const READER = 'mx-reader';
const EXTERNAL = 'mx-external';
const STRANGER = 'mx-stranger';
const PERSONAL_CREATOR = 'mx-personal';
const gh = e2eGithubUserId;

type Role = 'ADMIN' | 'MAINTAINER' | 'READER';
const RANK: Record<Role, number> = { READER: 1, MAINTAINER: 2, ADMIN: 3 };

interface Ids {
  projectId: string;
  runId: string;
  versionId: string;
  questionId: string;
  publicationId: string;
  experimentId: string;
}

interface RouteCase {
  url: (ids: Ids) => string;
  body?: (ids: Ids) => Record<string, unknown>;
  /** Código del `404` PROPIO del recurso cuando no es visible. */
  notFound?: string;
}

const PROJECT_404 = 'PROJECT_NOT_FOUND';
/** Cada ruta con recurso: cómo invocarla y qué `404` conserva. Los listados van aparte. */
const ROUTE_CASES: Record<string, RouteCase> = {
  'GET /projects/{}': { url: (i) => `/projects/${i.projectId}`, notFound: PROJECT_404 },
  'GET /projects/{}/versions': { url: (i) => `/projects/${i.projectId}/versions`, notFound: PROJECT_404 },
  'GET /project-versions/{}': { url: (i) => `/project-versions/${i.versionId}`, notFound: 'PROJECT_VERSION_NOT_FOUND' },
  'GET /project-versions/{}/results': { url: (i) => `/project-versions/${i.versionId}/results`, notFound: 'PROJECT_VERSION_NOT_FOUND' },
  'GET /project-versions/{}/test-inventory': { url: (i) => `/project-versions/${i.versionId}/test-inventory`, notFound: 'PROJECT_VERSION_NOT_FOUND' },
  'GET /projects/{}/integrations/github': { url: (i) => `/projects/${i.projectId}/integrations/github`, notFound: PROJECT_404 },
  'GET /projects/{}/analysis-runs': { url: (i) => `/projects/${i.projectId}/analysis-runs`, notFound: PROJECT_404 },
  'GET /analysis-runs/{}': { url: (i) => `/analysis-runs/${i.runId}`, notFound: 'ANALYSIS_RUN_NOT_FOUND' },
  'GET /analysis-runs/{}/context-questions': { url: (i) => `/analysis-runs/${i.runId}/context-questions`, notFound: 'ANALYSIS_RUN_NOT_FOUND' },
  'GET /projects/{}/functional-knowledge': { url: (i) => `/projects/${i.projectId}/functional-knowledge`, notFound: PROJECT_404 },
  'GET /analysis-runs/{}/test-proposals': { url: (i) => `/analysis-runs/${i.runId}/test-proposals`, notFound: 'ANALYSIS_RUN_NOT_FOUND' },
  'GET /test-publications/{}': { url: (i) => `/test-publications/${i.publicationId}`, notFound: 'TEST_PUBLICATION_NOT_FOUND' },
  'GET /experiments/{}': { url: (i) => `/experiments/${i.experimentId}`, notFound: 'EXPERIMENT_NOT_FOUND' },
  'GET /experiments/{}/results': { url: (i) => `/experiments/${i.experimentId}/results`, notFound: 'EXPERIMENT_NOT_FOUND' },
  'POST /projects/{}/integrations/github': {
    url: (i) => `/projects/${i.projectId}/integrations/github`,
    body: () => ({ repositoryId: '100', repositoryName: REPO, integrationBranch: 'main' }),
    notFound: PROJECT_404,
  },
  'POST /projects/{}/integrations/github/enable': { url: (i) => `/projects/${i.projectId}/integrations/github/enable`, notFound: PROJECT_404 },
  'DELETE /projects/{}/integrations/github': { url: (i) => `/projects/${i.projectId}/integrations/github`, notFound: PROJECT_404 },
  'POST /analysis-runs/{}/context-questions/{}/answers': {
    url: (i) => `/analysis-runs/${i.runId}/context-questions/${i.questionId}/answers`,
    body: () => ({}),
    notFound: 'ANALYSIS_RUN_NOT_FOUND',
  },
  'POST /analysis-runs/{}/test-publications': {
    url: (i) => `/analysis-runs/${i.runId}/test-publications`,
    body: () => ({ proposalIds: ['00000000-0000-4000-8000-000000000001'] }),
    notFound: 'ANALYSIS_RUN_NOT_FOUND',
  },
  'POST /experiments': {
    url: () => '/experiments',
    body: (i) => ({ projectId: i.projectId, targetId: '00000000-0000-4000-8000-000000000002' }),
    notFound: PROJECT_404,
  },
  'PATCH /projects/{}': { url: (i) => `/projects/${i.projectId}`, body: () => ({ name: 'renamed' }), notFound: PROJECT_404 },
  'DELETE /projects/{}': { url: (i) => `/projects/${i.projectId}`, notFound: PROJECT_404 },
};

/** Listados: sin recurso; `GET /projects`, `GET /analysis-runs` y `GET /action-required` solo devuelven lo visible. */
const LISTINGS = ['GET /projects', 'GET /analysis-runs', 'GET /action-required'];

const METHOD_OF = (key: string) => key.split(' ')[0].toLowerCase() as 'get' | 'post' | 'patch' | 'delete';

describe('Access matrix by route and role (HU59, HU60, HU63, HU64, corte 3 etapa 2b, e2e)', () => {
  let app: INestApplication;
  let github: FakeGithubAccessPort;
  const prisma = new InMemoryPrisma();

  beforeAll(async () => {
    github = new FakeGithubAccessPort();

    const moduleFixture = await overrideAuthTokenVerifier(
      Test.createTestingModule({ imports: [AppModule] })
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
          getInstallationToken: () => Promise.resolve('installation-token'),
          getAppInfo: () => Promise.resolve({ slug: 'tjc-core', name: 'TJC Core' }),
        })
        .overrideProvider(GithubRepositoryContentService)
        .useValue({ listBranches: () => Promise.resolve([{ name: 'main', protected: false }]) })
        .overrideProvider(GithubUserRepositoriesService)
        .useValue({ list: vi.fn().mockResolvedValue({ items: [], hasNextPage: false }) })
        // El dominio de experimentos necesita tablas que el Prisma en memoria no modela; aquí solo
        // importa que el guard deje pasar (o no) la petición.
        .overrideProvider(ExperimentsService)
        .useValue({
          createRun: () => Promise.resolve({ experimentId: 'e' }),
          getStatus: () => Promise.resolve({ id: 'e' }),
          getResults: () => Promise.resolve({ id: 'e' }),
        }),
    ).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    github.reset();
    github.addOrganization({ installationId: 'inst-42', organizationId: ORG_ID, organizationLogin: ORG, avatarUrl: null, suspended: false });
    github
      .setMembership(ORG, gh(OWNER), { role: 'admin', state: 'active' })
      // Owner de la organización SIN permiso explícito sobre el repositorio (no es colaborador
      // explícito): GitHub le da admin efectivo.
      .setMembership(ORG, gh(OWNER_NO_COLLABORATOR), { role: 'admin', state: 'active' })
      .setMembership(ORG, gh(WRITER), { role: 'member', state: 'active' })
      .setMembership(ORG, gh(READER), { role: 'member', state: 'active' })
      .addRepository(REPO, { repositoryId: '100', ownerId: ORG_ID, ownerLogin: ORG, ownerType: 'Organization' })
      .setPermission(REPO, gh(OWNER), 'admin')
      .setPermission(REPO, gh(WRITER), 'write')
      .setPermission(REPO, gh(READER), 'read')
      // Colaborador externo: NO es miembro de la organización pero tiene `write`.
      .setPermission(REPO, gh(EXTERNAL), 'write');
  });

  /** Project (de organización o personal) con repositorio vinculado y un recurso de cada tipo. */
  function seedProject(kind: 'ORG' | 'PERSONAL'): Ids {
    const org = kind === 'ORG';
    const project = prisma.insert('project', {
      name: 'matrix-project',
      ownerUserId: org ? OWNER : PERSONAL_CREATOR,
      githubOrgId: org ? ORG_ID : null,
      githubOrgLogin: org ? ORG : null,
    });
    prisma.insert('repositoryBinding', {
      projectId: project.id,
      installationId: 'inst-42',
      repositoryId: org ? '100' : '200',
      repositoryName: org ? REPO : 'someone/personal',
      integrationBranch: 'main',
      status: 'ENABLED',
      disabledReason: null,
    });
    if (org) {
      prisma.insert('projectAccess', { projectId: project.id, userId: OWNER, role: 'ADMIN', verifiedAt: new Date() });
    }
    const run = prisma.insert('analysisRun', {
      projectId: project.id,
      repositoryId: '100',
      repositoryName: REPO,
      prNumber: 1,
      prTitle: 't',
      baseRef: 'main',
      headRef: 'f',
      baseSha: 'a',
      headSha: 'b',
      draft: false,
      prState: 'OPEN',
      actorLogin: null,
      status: 'QUEUED',
      current: true,
      attemptCount: 1,
      indexMode: 'BOOTSTRAP',
      changesetBaseSha: 'a',
      changesetHeadSha: 'b',
      indexDeltaBaseSha: null,
      functionalBehaviorValidated: false,
      resultSummary: null,
      actionRequiredCount: 0,
      generatedTestsCount: 0,
      completedAt: null,
    });
    const version = prisma.insert('projectVersion', {
      projectId: project.id,
      commitSha: 'abc',
      status: 'COMPLETED',
      originalFileName: null,
      sizeBytes: null,
      filesProcessed: 1,
      chunksCount: 1,
      failureReason: null,
      startedAt: null,
      completedAt: new Date(),
      detectedFramework: 'VITEST',
      targetsTotal: 0,
      targetsWithTest: 0,
    });
    const question = prisma.insert('functionalQuestion', {
      projectId: project.id,
      analysisRunId: run.id,
      status: 'PENDING',
      question: 'q',
      rationale: 'r',
      qualifiedName: 'A.b',
      filePath: 'a.ts',
      symbolKind: 'METHOD',
      symbolLanguage: 'TYPESCRIPT',
    });
    const publication = prisma.insert('testPublication', {
      analysisRunId: run.id,
      sourceHeadSha: 'b',
      status: 'PENDING',
      branchName: null,
      companionPullRequestNumber: null,
      companionPullRequestUrl: null,
      failureMessage: null,
    });
    const experiment = prisma.insert('experimentRun', { projectId: project.id });

    return {
      projectId: project.id as string,
      runId: run.id as string,
      versionId: version.id as string,
      questionId: question.id as string,
      publicationId: publication.id as string,
      experimentId: experiment.id as string,
    };
  }

  const invoke = (user: string, key: string, ids: Ids) => {
    const routeCase = ROUTE_CASES[key];
    const call = authedRequest(app, user)[METHOD_OF(key)](routeCase.url(ids));
    return routeCase.body ? call.send(routeCase.body(ids)) : call;
  };

  const policyOf = (entry: RouteAccessEntry): ContractRole =>
    entry.policy === 'PUBLIC' ? 'PUBLIC' : entry.policy === null ? ('UNDECLARED' as ContractRole) : entry.policy.kind === 'NONE' ? 'NONE' : entry.policy.minRole;

  describe('default-deny and the interoperability matrix', () => {
    const routes = () => listRouteAccess(app.get(DiscoveryService), app.get(MetadataScanner));

    it('enumerates the router (every HTTP route and the WebSocket handshake and messages): none lacks a declaration', () => {
      const all = routes();
      const undeclared = all.filter((entry) => entry.policy === null).map((entry) => `${entry.method} ${entry.path} (${entry.handler})`);

      expect(undeclared).toEqual([]);
      expect(all.filter((entry) => entry.transport === 'http').length).toBeGreaterThanOrEqual(30);
      expect(all.filter((entry) => entry.transport === 'ws-handshake')).toHaveLength(1);
      expect(all.filter((entry) => entry.transport === 'ws-message').map((entry) => entry.path).sort()).toEqual([
        'subscribe:project-version',
        'unsubscribe:project-version',
      ]);
    });

    it('the roles implemented on every route equal the INTEROP §6.13 matrix, route by route', () => {
      const implemented = new Map(
        routes()
          .filter((entry) => entry.transport !== 'ws-handshake')
          .map((entry) => [matrixKey(entry.method, entry.path), policyOf(entry)]),
      );
      const contract = new Map(
        INTEROP_ROLE_MATRIX.filter((entry) => entry.implemented).map((entry) => [matrixKey(entry.method, entry.path), entry.role]),
      );
      // `unsubscribe` no es una operación del contrato: solo abandona una sala propia.
      implemented.delete(matrixKey('WS', 'unsubscribe:project-version'));

      expect(Object.fromEntries([...implemented].sort())).toEqual(Object.fromEntries([...contract].sort()));
    });

    it('routes of the contract that Core does not implement yet have no route (they must be added to the router with their role)', () => {
      const present = new Set(routes().map((entry) => matrixKey(entry.method, entry.path)));

      for (const entry of INTEROP_ROLE_MATRIX.filter((candidate) => !candidate.implemented)) {
        expect(present.has(matrixKey(entry.method, entry.path)), `${entry.method} ${entry.path} ya existe: márquela implemented`).toBe(false);
      }
    });

    it('the matrix fixture equals the rows of INTEROP §6.13 (same operations per role row)', () => {
      const rows = readContractMatrixRows();
      const fixtureRows: Record<ContractRow, string[]> = { SIN_ROL: [], READER: [], MAINTAINER: [], ADMIN: [] };

      for (const entry of INTEROP_ROLE_MATRIX) {
        fixtureRows[entry.row].push(entry.spec);
      }
      for (const { row, spec } of SECOND_ROW_LISTINGS) {
        fixtureRows[row].push(spec);
      }

      for (const row of Object.keys(fixtureRows) as ContractRow[]) {
        expect([...rows[row]].sort(), `fila ${row}`).toEqual([...fixtureRows[row]].sort());
      }
    });

    it('the WebSocket handshake declares its exception and the subscribe declares Reader', () => {
      const all = routes();
      const handshake = all.find((entry) => entry.transport === 'ws-handshake');
      const subscribe = all.find((entry) => entry.path === 'subscribe:project-version');

      expect(handshake?.policy).toMatchObject({ kind: 'NONE' });
      expect(subscribe?.policy).toMatchObject({ kind: 'ROLE', minRole: 'READER' });
    });
  });

  describe('matrix by route x role (organization project)', () => {
    const ROLE_USERS: Array<[Role, string]> = [
      ['ADMIN', OWNER],
      ['MAINTAINER', WRITER],
      ['READER', READER],
    ];
    const minRoleOf = (key: string): Role =>
      INTEROP_ROLE_MATRIX.find((entry) => matrixKey(entry.method, entry.path) === key.replace(/\{\}/g, '{}'))?.role as Role;

    const cases = Object.keys(ROUTE_CASES);

    it('covers every implemented, resource-bearing route of the contract', () => {
      const contractKeys = INTEROP_ROLE_MATRIX.filter(
        (entry) => entry.implemented && ['READER', 'MAINTAINER', 'ADMIN'].includes(entry.role) && entry.method !== 'WS',
      )
        .map((entry) => matrixKey(entry.method, entry.path))
        .filter((key) => !LISTINGS.includes(key));

      expect([...cases].sort()).toEqual([...contractKeys].sort());
    });

    it.each(cases)('%s: 404 to non-visible users, 403 with details to a lower role, allowed at the minimum role', async (key) => {
      const min = minRoleOf(key);
      const routeCase = ROUTE_CASES[key];

      for (const [role, user] of ROLE_USERS) {
        const ids = seedProject('ORG');
        const response = await invoke(user, key, ids);

        if (RANK[role] >= RANK[min]) {
          expect(response.status, `${key} como ${role}: ${JSON.stringify(response.body)}`).not.toBe(401);
          expect(response.body.code, `${key} como ${role}`).not.toBe('PROJECT_ROLE_INSUFFICIENT');
          expect(response.status === 404 && response.body.code === routeCase.notFound, `${key} como ${role}: no debe ser el 404 de visibilidad`).toBe(false);
          expect(response.status, `${key} como ${role}`).toBeLessThan(500);
        } else {
          expect(response.status, `${key} como ${role}`).toBe(403);
          expect(response.body).toMatchObject({
            code: 'PROJECT_ROLE_INSUFFICIENT',
            details: { requiredRole: min, currentRole: role },
          });
        }
        prisma.reset();
        github.calls.length = 0;
      }

      for (const user of [STRANGER, EXTERNAL]) {
        const ids = seedProject('ORG');
        const response = await invoke(user, key, ids);

        expect(response.status, `${key} como ${user}`).toBe(404);
        expect(response.body.code, `${key} como ${user}`).toBe(routeCase.notFound);
        expect(prisma.tables.projectAccess.some((row) => row.userId === user)).toBe(false);
        prisma.reset();
      }
    });

    it.each(cases.filter((key) => key !== 'POST /experiments'))(
      '%s: a non-visible resource answers the same 404 as a missing id (no leak)',
      async (key) => {
        const ids = seedProject('ORG');
        const routeCase = ROUTE_CASES[key];
        const hidden = await invoke(STRANGER, key, ids);
        const missingIds: Ids = {
          projectId: 'missing',
          runId: 'missing',
          versionId: 'missing',
          questionId: 'missing',
          publicationId: 'missing',
          experimentId: 'missing',
        };
        const missing = await invoke(STRANGER, key, missingIds);

        expect(hidden.status).toBe(404);
        expect(missing.status).toBe(404);
        expect(hidden.body.code).toBe(routeCase.notFound);
        expect(missing.body.code).toBe(routeCase.notFound);
        expect(hidden.body.message.replace(ids.projectId, 'X').replace(ids.runId, 'X').replace(ids.versionId, 'X').replace(ids.publicationId, 'X').replace(ids.experimentId, 'X')).toBe(
          missing.body.message.replace('missing', 'X'),
        );
      },
    );

    it('listings answer 200 with only what is visible: Reader/Maintainer/Admin see the project, the non-member and the external collaborator do not', async () => {
      const ids = seedProject('ORG');
      // Registros de acceso existentes para los listados cross-proyecto (no verifican contra GitHub).
      prisma.insert('projectAccess', { projectId: ids.projectId, userId: WRITER, role: 'MAINTAINER', verifiedAt: new Date() });
      prisma.insert('projectAccess', { projectId: ids.projectId, userId: READER, role: 'READER', verifiedAt: new Date() });

      for (const user of [OWNER, WRITER, READER]) {
        const projects = await authedRequest(app, user).get('/projects').expect(200);
        const runs = await authedRequest(app, user).get('/analysis-runs').expect(200);

        expect(projects.body.items.map((item: { id: string }) => item.id), `GET /projects como ${user}`).toEqual([ids.projectId]);
        expect(runs.body.items.map((item: { id: string }) => item.id), `GET /analysis-runs como ${user}`).toEqual([ids.runId]);
        await authedRequest(app, user).get('/action-required').expect(200);
      }

      for (const user of [STRANGER, EXTERNAL]) {
        expect((await authedRequest(app, user).get('/projects').expect(200)).body.items).toEqual([]);
        expect((await authedRequest(app, user).get('/analysis-runs').expect(200)).body.items).toEqual([]);
        expect((await authedRequest(app, user).get('/action-required').expect(200)).body.items).toEqual([]);
        const scoped = await authedRequest(app, user).get('/action-required').query({ projectId: ids.projectId }).expect(404);
        expect(scoped.body.code).toBe('PROJECT_NOT_FOUND');
      }
    });

    it('a second owner without explicit collaborator permission enters as Admin, and a Maintainer cannot create, rename or delete', async () => {
      const ids = seedProject('ORG');

      const second = await authedRequest(app, OWNER_NO_COLLABORATOR).get(`/projects/${ids.projectId}`).expect(200);
      expect(second.body.role).toBe('ADMIN');

      await authedRequest(app, WRITER).get(`/projects/${ids.projectId}`).expect(200);
      const create = await authedRequest(app, WRITER).post('/projects').send({ name: 'x', workspaceId: ORG_ID }).expect(403);
      expect(create.body.code).toBe('WORKSPACE_ADMIN_REQUIRED');
      const rename = await authedRequest(app, WRITER).patch(`/projects/${ids.projectId}`).send({ name: 'x' }).expect(403);
      expect(rename.body).toMatchObject({ code: 'PROJECT_ROLE_INSUFFICIENT', details: { requiredRole: 'ADMIN', currentRole: 'MAINTAINER' } });
      const remove = await authedRequest(app, WRITER).delete(`/projects/${ids.projectId}`).expect(403);
      expect(remove.body.code).toBe('PROJECT_ROLE_INSUFFICIENT');
      expect(prisma.tables.project.filter((row) => row.deletedAt == null)).toHaveLength(1);
    });

    it('an organization owner who is not an explicit collaborator (GitHub gives effective admin) configures a binding in a repository of the organization', async () => {
      const created = (await authedRequest(app, OWNER_NO_COLLABORATOR).post('/projects').send({ name: 'owner-2-project', workspaceId: ORG_ID }).expect(201)).body as { id: string; role: string };
      expect(created.role).toBe('ADMIN');

      const binding = await authedRequest(app, OWNER_NO_COLLABORATOR)
        .post(`/projects/${created.id}/integrations/github`)
        .send({ repositoryId: '100', repositoryName: REPO, integrationBranch: 'main' })
        .expect(201);
      expect(binding.body).toMatchObject({ repositoryName: REPO });

      // Sin el permiso efectivo del owner (p. ej. un miembro sin permiso) el binding se rechaza.
      github.setMembership(ORG, gh('plain-member'), { role: 'member', state: 'active' });
      await authedRequest(app, 'plain-member')
        .post('/projects')
        .send({ name: 'nope', workspaceId: ORG_ID })
        .expect(403);
    });
  });

  describe('personal project: only its creator, always Admin, on every route', () => {
    const cases = Object.keys(ROUTE_CASES);

    it.each(cases)('%s: the creator is allowed and a collaborator of the repository gets the resource 404 without any GitHub call', async (key) => {
      const routeCase = ROUTE_CASES[key];
      let ids = seedProject('PERSONAL');
      github.calls.length = 0;

      const other = await invoke(WRITER, key, ids);
      expect(other.status, `${key}: ${JSON.stringify(other.body)}`).toBe(404);
      expect(other.body.code).toBe(routeCase.notFound);
      expect(github.calls).toEqual([]);
      expect(prisma.tables.projectAccess).toHaveLength(0);

      ids = seedProject('PERSONAL');
      const creator = await invoke(PERSONAL_CREATOR, key, ids);
      expect(creator.status, `${key} como creador: ${JSON.stringify(creator.body)}`).toBeLessThan(500);
      expect(creator.body.code).not.toBe('PROJECT_ROLE_INSUFFICIENT');
      expect(creator.status === 404 && creator.body.code === routeCase.notFound, `${key} como creador`).toBe(false);
      expect(github.calls.filter((call) => call.method !== 'getRepositoryOwner' && call.method !== 'getRepositoryPermission')).toEqual([]);
    });
  });

  describe('entry by deep link to a descendant resource (alta al entrar)', () => {
    it.each([
      ['a Run', (ids: Ids) => `/analysis-runs/${ids.runId}`],
      ['a version', (ids: Ids) => `/project-versions/${ids.versionId}`],
      ['a publication', (ids: Ids) => `/test-publications/${ids.publicationId}`],
      ['an experiment', (ids: Ids) => `/experiments/${ids.experimentId}`],
      ['the questions of a Run', (ids: Ids) => `/analysis-runs/${ids.runId}/context-questions`],
    ])('a member with access to the repository enters by %s without opening the project first: access record created, same predicate', async (_label, url) => {
      const ids = seedProject('ORG');
      expect(prisma.tables.projectAccess).toHaveLength(1);

      const writer = await authedRequest(app, WRITER).get(url(ids)).expect(200);
      const reader = await authedRequest(app, READER).get(url(ids)).expect(200);

      expect(writer.body).toBeDefined();
      expect(reader.body).toBeDefined();
      expect(prisma.tables.projectAccess.map((row) => [row.userId, row.role]).sort()).toEqual(
        [
          [OWNER, 'ADMIN'],
          [WRITER, 'MAINTAINER'],
          [READER, 'READER'],
        ].sort(),
      );
    });

    it('an external collaborator with write gets 404 by deep link, and no record is created', async () => {
      const ids = seedProject('ORG');

      await authedRequest(app, EXTERNAL).get(`/analysis-runs/${ids.runId}`).expect(404);
      await authedRequest(app, EXTERNAL).get(`/project-versions/${ids.versionId}`).expect(404);

      expect(prisma.tables.projectAccess).toHaveLength(1);
    });

    it('GitHub down: 503 GITHUB_VERIFICATION_UNAVAILABLE for a new access by deep link (never 404); registered access keeps working', async () => {
      const ids = seedProject('ORG');
      await authedRequest(app, WRITER).get(`/analysis-runs/${ids.runId}`).expect(200);
      github.installationsMode = 'UNVERIFIABLE';
      github.permissionMode = 'UNVERIFIABLE';

      await authedRequest(app, WRITER).get(`/analysis-runs/${ids.runId}`).expect(200);
      const unavailable = await authedRequest(app, READER).get(`/analysis-runs/${ids.runId}`).expect(503);
      expect(unavailable.body.code).toBe('GITHUB_VERIFICATION_UNAVAILABLE');
    });

    it('race: a deep-link alta in flight and a concurrent revocation serialize on the (project, user) lock; the revoked access is not resurrected', async () => {
      const ids = seedProject('ORG');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let verifying!: () => void;
      const started = new Promise<void>((resolve) => {
        verifying = resolve;
      });
      const original = github.getRepositoryPermission.bind(github);
      github.getRepositoryPermission = async (...args) => {
        verifying();
        await gate;
        return original(...args);
      };

      const alta = authedRequest(app, WRITER).get(`/analysis-runs/${ids.runId}`).then((response) => response);
      await started;
      // La pérdida de acceso llega mientras la verificación está en vuelo: toma el mismo lock y espera.
      const revocation = app.get(ProjectAccessService).revoke(ids.projectId, WRITER);
      await new Promise((resolve) => setTimeout(resolve, 5));
      github.setMembership(ORG, gh(WRITER), { role: 'member', state: 'pending' });
      release();

      // La petición en vuelo termina 200 (el guard pasó antes de la revocación) o 404 (el handler ya
      // ve el acceso revocado): ambos son seguros; lo que no puede pasar es que el alta lo recree.
      expect([200, 404]).toContain((await alta).status);
      await revocation;
      expect(prisma.tables.projectAccess.some((row) => row.userId === WRITER)).toBe(false);

      // Tras la revocación, la siguiente entrada re-verifica en vivo y GitHub ya no da acceso.
      await authedRequest(app, WRITER).get(`/analysis-runs/${ids.runId}`).expect(404);
      expect(prisma.tables.projectAccess.some((row) => row.userId === WRITER)).toBe(false);
    });

    it('a Project without repository or with a REVOKED binding is visible only to an Admin, even to a member with a stale record', async () => {
      const ids = seedProject('ORG');
      prisma.insert('projectAccess', { projectId: ids.projectId, userId: WRITER, role: 'MAINTAINER', verifiedAt: new Date() });
      (prisma.tables.repositoryBinding[0] as { status: string }).status = 'REVOKED';

      await authedRequest(app, WRITER).get(`/projects/${ids.projectId}`).expect(404);
      await authedRequest(app, WRITER).get(`/analysis-runs/${ids.runId}`).expect(404);
      await authedRequest(app, OWNER).get(`/analysis-runs/${ids.runId}`).expect(200);

      prisma.tables.repositoryBinding.length = 0;
      await authedRequest(app, WRITER).get(`/projects/${ids.projectId}`).expect(404);
      await authedRequest(app, READER).get(`/projects/${ids.projectId}`).expect(404);
      await authedRequest(app, OWNER).get(`/projects/${ids.projectId}`).expect(200);
      expect(prisma.tables.projectAccess.some((row) => row.userId === READER)).toBe(false);
    });
  });

  describe('RealtimeGateway: Reader on subscribe, SubscribeAck and eviction', () => {
    let socketCounter = 0;
    // Como en Socket.IO, cada socket tiene un id único.
    const fakeSocket = (user: string, id = `socket-${user}-${(socketCounter += 1)}`) => ({
      id,
      data: { userId: user },
      join: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn().mockResolvedValue(undefined),
    });
    const subscribe = (socket: ReturnType<typeof fakeSocket>, projectVersionId: string) =>
      app.get(RealtimeGateway).subscribeProjectVersion(socket as never, { projectVersionId });

    it('Reader, Maintainer and Admin subscribe (SubscribeAck true) and the socket -> Project map records it; the rest get { false, null, false }', async () => {
      const ids = seedProject('ORG');
      const subscriptions = app.get(ProjectSubscriptionsService);

      for (const user of [OWNER, WRITER, READER]) {
        const socket = fakeSocket(user);
        await expect(subscribe(socket, ids.versionId)).resolves.toEqual({ subscribed: true, code: null, retryable: false });
        expect(socket.join).toHaveBeenCalledWith(`project-version:${ids.versionId}`);
        expect(subscriptions.projectsOf(socket.id)).toEqual([ids.projectId]);
      }

      for (const user of [STRANGER, EXTERNAL]) {
        const socket = fakeSocket(user);
        await expect(subscribe(socket, ids.versionId)).resolves.toEqual({ subscribed: false, code: null, retryable: false });
        expect(socket.join).not.toHaveBeenCalled();
      }

      // Una versión inexistente es indistinguible de una no visible.
      await expect(subscribe(fakeSocket(STRANGER), 'missing')).resolves.toEqual({ subscribed: false, code: null, retryable: false });
    });

    it('answers { false, GITHUB_VERIFICATION_UNAVAILABLE, retryable: true } when GitHub cannot verify a new access; registered access still subscribes', async () => {
      const ids = seedProject('ORG');
      github.installationsMode = 'UNVERIFIABLE';
      github.permissionMode = 'UNVERIFIABLE';

      await expect(subscribe(fakeSocket(WRITER), ids.versionId)).resolves.toEqual({
        subscribed: false,
        code: 'GITHUB_VERIFICATION_UNAVAILABLE',
        retryable: true,
      });
      await expect(subscribe(fakeSocket(OWNER), ids.versionId)).resolves.toMatchObject({ subscribed: true });
    });

    it('a personal project version subscribes only for its creator', async () => {
      const ids = seedProject('PERSONAL');

      await expect(subscribe(fakeSocket(PERSONAL_CREATOR), ids.versionId)).resolves.toMatchObject({ subscribed: true });
      await expect(subscribe(fakeSocket(WRITER), ids.versionId)).resolves.toMatchObject({ subscribed: false, code: null });
    });

    it('evicts a socket when its user loses access, and when the binding turns REVOKED (non-Admin) or the Project is deleted', async () => {
      const ids = seedProject('ORG');
      const subscriptions = app.get(ProjectSubscriptionsService);
      const admin = fakeSocket(OWNER);
      const writer = fakeSocket(WRITER);
      const reader = fakeSocket(READER);
      for (const socket of [admin, writer, reader]) {
        await subscribe(socket, ids.versionId);
      }

      // 1. El registro del Reader se borra (lo hará el corte 5 desde un evento): solo él sale.
      prisma.tables.projectAccess = prisma.tables.projectAccess.filter((row) => row.userId !== READER);
      await expect(subscriptions.revalidateProject(ids.projectId)).resolves.toBe(1);
      expect(reader.leave).toHaveBeenCalledWith(`project-version:${ids.versionId}`);
      expect(writer.leave).not.toHaveBeenCalled();

      // 2. El binding pasa a REVOKED: el Maintainer sale, el Admin se queda.
      (prisma.tables.repositoryBinding[0] as { status: string }).status = 'REVOKED';
      await expect(subscriptions.revalidateProject(ids.projectId)).resolves.toBe(1);
      expect(writer.leave).toHaveBeenCalled();
      expect(admin.leave).not.toHaveBeenCalled();
      expect(subscriptions.projectsOf(admin.id)).toEqual([ids.projectId]);

      // 3. El Project se borra (DELETE /projects/{id}): el Admin también sale.
      await authedRequest(app, OWNER).delete(`/projects/${ids.projectId}`).expect(204);
      expect(admin.leave).toHaveBeenCalledWith(`project-version:${ids.versionId}`);
      expect(subscriptions.projectsOf(admin.id)).toEqual([]);
    });
  });
});
