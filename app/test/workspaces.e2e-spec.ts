import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { GITHUB_ACCESS_PORT } from '../src/github-app/github-access.port.js';
import { ObjectStorageService } from '../src/object-storage/object-storage.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InMemoryPrisma } from './support/in-memory-prisma.js';
import { FakeGithubAccessPort } from './support/fake-github-access.port.js';
import { FakeObjectStorageService } from './support/fake-object-storage.service.js';
import {
  authedRequest,
  createE2eIdentityFakes,
  e2eGithubUserId,
  overrideAuthTokenVerifier,
  type E2eIdentityFakes,
} from './support/auth-test-support.js';

const MEMBER = 'workspace-member';
const MEMBER_GH = e2eGithubUserId(MEMBER);
const OWNER = 'workspace-owner';
const OWNER_GH = e2eGithubUserId(OWNER);
const LONER = 'workspace-loner';

const prisma = new InMemoryPrisma();

function organization(id: number, login: string) {
  return {
    installationId: `inst-${id}`,
    organizationId: String(id),
    organizationLogin: login,
    avatarUrl: `https://avatars/${login}`,
    suspended: false,
  };
}

describe('Workspaces (HU58, corte 2, e2e)', () => {
  let app: INestApplication;
  let github: FakeGithubAccessPort;
  let fakes: E2eIdentityFakes;

  beforeAll(async () => {
    github = new FakeGithubAccessPort();
    fakes = createE2eIdentityFakes();
    fakes.supabaseIdentity.setIdentity(MEMBER, { githubUserId: MEMBER_GH, login: 'member-login' });

    const moduleFixture = await overrideAuthTokenVerifier(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(ObjectStorageService)
        .useClass(FakeObjectStorageService)
        .overrideProvider(GITHUB_ACCESS_PORT)
        .useValue(github),
      fakes,
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
  });

  it('requires a session (401 AUTH_REQUIRED)', async () => {
    const response = await request(app.getHttpServer()).get('/workspaces').expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('lists only the personal workspace, as ADMIN, for a user without organizations', async () => {
    const response = await authedRequest(app, LONER).get('/workspaces').expect(200);

    expect(response.body).toEqual({
      items: [
        {
          kind: 'PERSONAL',
          id: e2eGithubUserId(LONER),
          login: null,
          avatarUrl: `https://avatars.githubusercontent.com/u/${e2eGithubUserId(LONER)}`,
          role: 'ADMIN',
        },
      ],
    });
  });

  it('lists the personal workspace first and then the organizations with the App installed where the user is an active member, by login', async () => {
    github
      .addOrganization(organization(20, 'zeta-labs'))
      .addOrganization(organization(10, 'acme'))
      .addOrganization(organization(30, 'not-mine'))
      .addOrganization(organization(40, 'pending-invite'))
      .setMembership('zeta-labs', MEMBER_GH, { role: 'member', state: 'active' })
      .setMembership('acme', MEMBER_GH, { role: 'admin', state: 'active' })
      .setMembership('not-mine', OWNER_GH, { role: 'admin', state: 'active' })
      .setMembership('pending-invite', MEMBER_GH, { role: 'member', state: 'pending' });

    const response = await authedRequest(app, MEMBER).get('/workspaces').expect(200);

    expect(response.body.items).toEqual([
      {
        kind: 'PERSONAL',
        id: MEMBER_GH,
        login: 'member-login',
        avatarUrl: `https://avatars.githubusercontent.com/u/${MEMBER_GH}`,
        role: 'ADMIN',
      },
      { kind: 'ORGANIZATION', id: '10', login: 'acme', avatarUrl: 'https://avatars/acme', role: 'ADMIN' },
      { kind: 'ORGANIZATION', id: '20', login: 'zeta-labs', avatarUrl: 'https://avatars/zeta-labs', role: 'MEMBER' },
    ]);
  });

  it('does not offer an organization whose installation has no accepted Members: read (unverifiable)', async () => {
    github
      .addOrganization(organization(10, 'acme'))
      .setMembership('acme', MEMBER_GH, { role: 'admin', state: 'active' })
      .setOrganizationMode('acme', 'UNVERIFIABLE');

    const response = await authedRequest(app, MEMBER).get('/workspaces').expect(200);

    expect(response.body.items.map((item: { kind: string }) => item.kind)).toEqual(['PERSONAL']);
  });

  it('degrades to the personal workspace only (200, no error) when GitHub is down', async () => {
    github.addOrganization(organization(10, 'acme')).setMembership('acme', MEMBER_GH, { role: 'admin', state: 'active' });
    github.installationsMode = 'UNVERIFIABLE';

    const response = await authedRequest(app, MEMBER).get('/workspaces').expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ kind: 'PERSONAL', id: MEMBER_GH, role: 'ADMIN' });
  });
});
