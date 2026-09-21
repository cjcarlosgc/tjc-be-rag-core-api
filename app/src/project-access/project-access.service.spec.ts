import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGithubAccessPort } from '../../test/support/fake-github-access.port.js';
import { InMemoryPrisma } from '../../test/support/in-memory-prisma.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OrganizationAccessResolver, VerificationContext } from './organization-access.resolver.js';
import { ACCESS_VERIFICATION_BUDGET, ACCESS_VERIFICATION_CONCURRENCY } from './project-access.constants.js';
import { ProjectAccessRepository } from './project-access.repository.js';
import { ProjectAccessService, roleForPermission } from './project-access.service.js';

const ORG_ID = '42';
const ORG_LOGIN = 'acme';
const REPO = 'acme/widgets';

const OWNER = { userId: 'u-owner', githubUserId: '1001' };
const MEMBER_WRITE = { userId: 'u-writer', githubUserId: '1002' };
const MEMBER_READ = { userId: 'u-reader', githubUserId: '1003' };
const EXTERNAL = { userId: 'u-external', githubUserId: '1004' };
const STRANGER = { userId: 'u-stranger', githubUserId: '1005' };
const CREATOR_PERSONAL = { userId: 'u-personal', githubUserId: '1006' };

describe('ProjectAccessService (HU59, HU60)', () => {
  let db: InMemoryPrisma;
  let github: FakeGithubAccessPort;
  let identities: Map<string, string>;
  let service: ProjectAccessService;

  const seedProject = (id: string, fields: Record<string, unknown> = {}) =>
    db.insert('project', {
      id,
      name: id,
      ownerUserId: OWNER.userId,
      githubOrgId: ORG_ID,
      githubOrgLogin: ORG_LOGIN,
      ...fields,
    });
  const seedBinding = (projectId: string, status = 'ENABLED') =>
    db.insert('repositoryBinding', { projectId, status, repositoryName: REPO, installationId: 'inst-42' });
  const records = (projectId: string) =>
    db.tables.projectAccess.filter((row) => row.projectId === projectId).map((row) => [row.userId, row.role]);

  beforeEach(() => {
    db = new InMemoryPrisma();
    github = new FakeGithubAccessPort();
    identities = new Map(
      [OWNER, MEMBER_WRITE, MEMBER_READ, EXTERNAL, STRANGER, CREATOR_PERSONAL].map((u) => [u.userId, u.githubUserId]),
    );
    github.addOrganization({
      installationId: 'inst-42',
      organizationId: ORG_ID,
      organizationLogin: ORG_LOGIN,
      avatarUrl: null,
      suspended: false,
    });
    github
      .setMembership(ORG_LOGIN, OWNER.githubUserId, { role: 'admin', state: 'active' })
      .setMembership(ORG_LOGIN, MEMBER_WRITE.githubUserId, { role: 'member', state: 'active' })
      .setMembership(ORG_LOGIN, MEMBER_READ.githubUserId, { role: 'member', state: 'active' })
      .setPermission(REPO, MEMBER_WRITE.githubUserId, 'write')
      .setPermission(REPO, MEMBER_READ.githubUserId, 'read')
      // Colaborador externo: NO es miembro, pero tiene `write` (y el repositorio puede ser público).
      .setPermission(REPO, EXTERNAL.githubUserId, 'write');

    const repository = new ProjectAccessRepository(db as unknown as PrismaService);
    service = new ProjectAccessService(
      repository,
      new OrganizationAccessResolver(github),
      { resolve: (userId: string) => Promise.resolve(identities.get(userId) as string) } as never,
      github,
    );
  });

  describe('require: personal projects', () => {
    it('lets the creator in as ADMIN without registering anything or calling GitHub', async () => {
      seedProject('p', { githubOrgId: null, githubOrgLogin: null, ownerUserId: CREATOR_PERSONAL.userId });

      const grant = await service.require(CREATOR_PERSONAL.userId, 'p', 'ADMIN');

      expect(grant.role).toBe('ADMIN');
      expect(db.tables.projectAccess).toHaveLength(0);
      expect(github.calls).toEqual([]);
    });

    it('answers 404 to anyone else, collaborator of the repository included, without verifying anything', async () => {
      seedProject('p', { githubOrgId: null, githubOrgLogin: null, ownerUserId: CREATOR_PERSONAL.userId });
      seedBinding('p');

      await expect(service.require(MEMBER_WRITE.userId, 'p')).rejects.toMatchObject({
        code: ErrorCode.PROJECT_NOT_FOUND,
        status: 404,
      });
      expect(github.calls).toEqual([]);
      expect(db.tables.projectAccess).toHaveLength(0);
    });

    it('answers 404 for a missing or deleted project', async () => {
      seedProject('gone', { deletedAt: new Date() });

      await expect(service.require(OWNER.userId, 'missing')).rejects.toMatchObject({ status: 404 });
      await expect(service.require(OWNER.userId, 'gone')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('require: role derivation on entry (alta al entrar)', () => {
    beforeEach(() => {
      seedProject('p');
      seedBinding('p');
    });

    it('an organization owner is ADMIN and the record is created', async () => {
      const grant = await service.require(OWNER.userId, 'p', 'READER');

      expect(grant.role).toBe('ADMIN');
      expect(records('p')).toEqual([[OWNER.userId, 'ADMIN']]);
    });

    it.each(['maintain', 'write', 'admin'] as const)('an active member with %s on the repository is MAINTAINER', async (level) => {
      github.setPermission(REPO, MEMBER_WRITE.githubUserId, level);

      await expect(service.require(MEMBER_WRITE.userId, 'p')).resolves.toMatchObject({ role: 'MAINTAINER' });
      expect(records('p')).toEqual([[MEMBER_WRITE.userId, 'MAINTAINER']]);
    });

    it.each(['triage', 'read'] as const)('an active member with %s on the repository is READER', async (level) => {
      github.setPermission(REPO, MEMBER_READ.githubUserId, level);

      await expect(service.require(MEMBER_READ.userId, 'p')).resolves.toMatchObject({ role: 'READER' });
      expect(records('p')).toEqual([[MEMBER_READ.userId, 'READER']]);
    });

    it('the live read uses the LIVE login of the installation, not the stored githubOrgLogin', async () => {
      github.removeOrganization(ORG_LOGIN);
      github
        .addOrganization({
          installationId: 'inst-42',
          organizationId: ORG_ID,
          organizationLogin: 'acme-renamed',
          avatarUrl: null,
          suspended: false,
        })
        .setMembership('acme-renamed', OWNER.githubUserId, { role: 'admin', state: 'active' });

      await expect(service.require(OWNER.userId, 'p')).resolves.toMatchObject({ role: 'ADMIN' });
      expect(github.calls.find((call) => call.method === 'getOrganizationMembership')?.organizationLogin).toBe('acme-renamed');
    });

    it.each([
      ['a private or internal repository', 'private'],
      ['a public repository (its implicit read does not count)', 'public'],
    ])('an EXTERNAL collaborator with write is denied (404) on %s and nothing is registered', async () => {
      await expect(service.require(EXTERNAL.userId, 'p')).rejects.toMatchObject({ code: ErrorCode.PROJECT_NOT_FOUND, status: 404 });
      expect(db.tables.projectAccess).toHaveLength(0);
      // La membresía se exige primero: sin ella no se consulta el permiso del repositorio.
      expect(github.calls.some((call) => call.method === 'getRepositoryPermission')).toBe(false);
    });

    it('a pending invitation is not a membership', async () => {
      github.setMembership(ORG_LOGIN, STRANGER.githubUserId, { role: 'admin', state: 'pending' });

      await expect(service.require(STRANGER.userId, 'p')).rejects.toMatchObject({ status: 404 });
    });

    it('a member with no permission on the repository is denied (404)', async () => {
      github.setMembership(ORG_LOGIN, STRANGER.githubUserId, { role: 'member', state: 'active' });

      await expect(service.require(STRANGER.userId, 'p')).rejects.toMatchObject({ status: 404 });
      expect(db.tables.projectAccess).toHaveLength(0);
    });

    it('a project without repository is visible only to an Admin', async () => {
      seedProject('bare');

      await expect(service.require(OWNER.userId, 'bare')).resolves.toMatchObject({ role: 'ADMIN' });
      await expect(service.require(MEMBER_WRITE.userId, 'bare')).rejects.toMatchObject({ status: 404 });
      expect(records('bare')).toEqual([[OWNER.userId, 'ADMIN']]);
    });

    it('a project with the binding REVOKED is visible only to an Admin (no permission read for the rest)', async () => {
      seedProject('revoked');
      seedBinding('revoked', 'REVOKED');

      await expect(service.require(OWNER.userId, 'revoked')).resolves.toMatchObject({ role: 'ADMIN' });
      await expect(service.require(MEMBER_WRITE.userId, 'revoked')).rejects.toMatchObject({ status: 404 });
      expect(github.calls.some((call) => call.method === 'getRepositoryPermission')).toBe(false);
    });

    it('an Admin does not need a permission read on the repository', async () => {
      await service.require(OWNER.userId, 'p');

      expect(github.calls.some((call) => call.method === 'getRepositoryPermission')).toBe(false);
    });
  });

  describe('require: roles (403 vs 404) and existing records', () => {
    beforeEach(() => {
      seedProject('p');
      seedBinding('p');
    });

    it('answers 403 PROJECT_ROLE_INSUFFICIENT with { requiredRole, currentRole } to a visible user with a lower role', async () => {
      await expect(service.require(MEMBER_READ.userId, 'p', 'MAINTAINER')).rejects.toMatchObject({
        code: ErrorCode.PROJECT_ROLE_INSUFFICIENT,
        status: 403,
        details: { requiredRole: 'MAINTAINER', currentRole: 'READER' },
      });
      await expect(service.require(MEMBER_WRITE.userId, 'p', 'ADMIN')).rejects.toMatchObject({
        status: 403,
        details: { requiredRole: 'ADMIN', currentRole: 'MAINTAINER' },
      });
    });

    it('a registered user is served from the record: no GitHub call, the record has no TTL', async () => {
      await service.require(MEMBER_WRITE.userId, 'p');
      github.calls.length = 0;
      github.permissionMode = 'UNVERIFIABLE';

      await expect(service.require(MEMBER_WRITE.userId, 'p', 'MAINTAINER')).resolves.toMatchObject({ role: 'MAINTAINER' });
      expect(github.calls).toEqual([]);
    });

    it('a Maintainer record does not give access once the binding is REVOKED, but the record survives (5b deletes it)', async () => {
      await service.require(MEMBER_WRITE.userId, 'p');
      (db.tables.repositoryBinding[0] as { status: string }).status = 'REVOKED';

      await expect(service.require(MEMBER_WRITE.userId, 'p')).rejects.toMatchObject({ status: 404 });
      expect(records('p')).toContainEqual([MEMBER_WRITE.userId, 'MAINTAINER']);
      // El Admin sigue viéndolo para reactivar el binding.
      await expect(service.require(OWNER.userId, 'p')).resolves.toMatchObject({ role: 'ADMIN' });
    });
  });

  describe('require: GitHub down and App uninstalled', () => {
    beforeEach(() => {
      seedProject('p');
      seedBinding('p');
    });

    it('answers 503 GITHUB_VERIFICATION_UNAVAILABLE (never 404/500) to a NEW access when the installations cannot be listed', async () => {
      github.installationsMode = 'UNVERIFIABLE';

      await expect(service.require(MEMBER_WRITE.userId, 'p')).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        status: 503,
      });
      expect(db.tables.projectAccess).toHaveLength(0);
    });

    it.each([
      ['membership', () => github.setOrganizationMode(ORG_LOGIN, 'UNVERIFIABLE')],
      ['repository permission', () => { github.permissionMode = 'UNVERIFIABLE'; }],
    ])('answers 503 when the %s cannot be verified', async (_label, arrange) => {
      arrange();

      await expect(service.require(MEMBER_WRITE.userId, 'p')).rejects.toMatchObject({ status: 503 });
      expect(db.tables.projectAccess).toHaveLength(0);
    });

    it('a suspended installation is unverifiable (503), not an uninstall', async () => {
      github.removeOrganization(ORG_LOGIN);
      github.addOrganization({
        installationId: 'inst-42',
        organizationId: ORG_ID,
        organizationLogin: ORG_LOGIN,
        avatarUrl: null,
        suspended: true,
      });

      await expect(service.require(OWNER.userId, 'p')).rejects.toMatchObject({ status: 503 });
    });

    it('an uninstalled App (absent from the installations) hides the project with 404, not a permanent 503', async () => {
      github.removeOrganization(ORG_LOGIN);

      await expect(service.require(OWNER.userId, 'p')).rejects.toMatchObject({ code: ErrorCode.PROJECT_NOT_FOUND, status: 404 });
    });

    it('a NOT_INSTALLED answer while reading the membership is also 404', async () => {
      github.setOrganizationMode(ORG_LOGIN, 'NOT_INSTALLED');

      await expect(service.require(OWNER.userId, 'p')).rejects.toMatchObject({ status: 404 });
    });

    it('a repository permission read that finds the App gone (NOT_INSTALLED) hides the project', async () => {
      github.permissionMode = 'NOT_INSTALLED';

      await expect(service.require(MEMBER_WRITE.userId, 'p')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('race: alta vs revocación (advisory lock por (projectId, userId))', () => {
    beforeEach(() => {
      seedProject('p');
      seedBinding('p');
    });

    it('takes exactly ONE advisory lock per (projectId, userId) for the whole alta', async () => {
      await service.require(MEMBER_WRITE.userId, 'p');

      expect(db.lockLog).toEqual([`project_access:p:${MEMBER_WRITE.userId}`]);
    });

    it('a revocation that arrives while the alta is verifying wins: the alta commits first, the revocation deletes after, no record remains', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let verifying!: () => void;
      const started = new Promise<void>((resolve) => {
        verifying = resolve;
      });
      // El alta queda "en vuelo": su lectura de permiso contra GitHub espera la compuerta.
      const original = github.getRepositoryPermission.bind(github);
      github.getRepositoryPermission = async (...args) => {
        verifying();
        await gate;
        return original(...args);
      };

      const alta = service.grantOnEntry('p', MEMBER_WRITE.userId, MEMBER_WRITE.githubUserId);
      await started;
      // El evento de revocación (pérdida de acceso) llega ahora: toma el MISMO lock y espera.
      const revocation = service.revoke('p', MEMBER_WRITE.userId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(records('p')).toEqual([]);

      release();

      await expect(alta).resolves.toMatchObject({ status: 'GRANTED', role: 'MAINTAINER' });
      await revocation;
      expect(records('p')).toEqual([]);
    });

    it('an alta that starts after a revocation re-verifies live and does not resurrect the revoked access', async () => {
      await service.require(MEMBER_WRITE.userId, 'p');
      github.setPermission(REPO, MEMBER_WRITE.githubUserId, 'write');
      // GitHub ya no da acceso (p. ej. `member.removed`); el evento borra el registro.
      github.permissionMode = 'NORMAL';
      github.setMembership(ORG_LOGIN, MEMBER_WRITE.githubUserId, { role: 'member', state: 'pending' });
      await service.revoke('p', MEMBER_WRITE.userId);

      await expect(service.require(MEMBER_WRITE.userId, 'p')).rejects.toMatchObject({ status: 404 });
      expect(records('p')).toEqual([]);
    });

    it('two concurrent altas of the same pair serialize: the second reuses the record without calling GitHub again', async () => {
      const [first, second] = await Promise.all([
        service.grantOnEntry('p', MEMBER_WRITE.userId, MEMBER_WRITE.githubUserId),
        service.grantOnEntry('p', MEMBER_WRITE.userId, MEMBER_WRITE.githubUserId),
      ]);

      expect(first).toEqual({ status: 'GRANTED', role: 'MAINTAINER' });
      expect(second).toEqual({ status: 'GRANTED', role: 'MAINTAINER' });
      expect(github.calls.filter((call) => call.method === 'getRepositoryPermission')).toHaveLength(1);
      expect(db.tables.projectAccess).toHaveLength(1);
    });

    it('altas of different pairs do not block each other', async () => {
      const order: string[] = [];
      db.onLockAcquired = async (key) => {
        order.push(key);
      };

      await Promise.all([
        service.grantOnEntry('p', MEMBER_WRITE.userId, MEMBER_WRITE.githubUserId),
        service.grantOnEntry('p', MEMBER_READ.userId, MEMBER_READ.githubUserId),
      ]);

      expect(new Set(order).size).toBe(2);
    });

    it('a transaction timeout while holding the lock is treated as unverifiable (503), never a 500', async () => {
      const repository = new ProjectAccessRepository(db as unknown as PrismaService);
      vi.spyOn(repository, 'withAccessLock').mockRejectedValue(Object.assign(new Error('timeout'), { code: 'P2028' }));
      const timed = new ProjectAccessService(repository, new OrganizationAccessResolver(github), { resolve: () => Promise.resolve('1002') } as never, github);

      await expect(timed.require(MEMBER_WRITE.userId, 'p')).rejects.toMatchObject({ status: 503 });
    });
  });

  describe('syncOrganizationProjects (GET /projects candidates)', () => {
    it('registers the projects the member can see and skips the ones a plain member cannot (no repo / REVOKED)', async () => {
      seedProject('ok');
      seedBinding('ok');
      seedProject('bare');
      seedProject('revoked');
      seedBinding('revoked', 'REVOKED');

      await service.syncOrganizationProjects(
        MEMBER_WRITE.userId,
        MEMBER_WRITE.githubUserId,
        [{ organizationId: ORG_ID, role: 'MEMBER' }],
        new VerificationContext(),
      );

      expect(records('ok')).toEqual([[MEMBER_WRITE.userId, 'MAINTAINER']]);
      expect(records('bare')).toEqual([]);
      expect(records('revoked')).toEqual([]);
      // Las candidatas que un miembro no puede ver no consumen verificaciones.
      expect(github.calls.filter((call) => call.method === 'getRepositoryPermission')).toHaveLength(1);
    });

    it('an owner registers every live project of the organization, including bare and REVOKED ones', async () => {
      seedProject('bare');
      seedProject('revoked');
      seedBinding('revoked', 'REVOKED');

      await service.syncOrganizationProjects(
        OWNER.userId,
        OWNER.githubUserId,
        [{ organizationId: ORG_ID, role: 'ADMIN' }],
        new VerificationContext(),
      );

      expect(records('bare')).toEqual([[OWNER.userId, 'ADMIN']]);
      expect(records('revoked')).toEqual([[OWNER.userId, 'ADMIN']]);
    });

    it('does not touch projects the user already sees nor personal projects of others', async () => {
      seedProject('personal-other', { githubOrgId: null, githubOrgLogin: null, ownerUserId: CREATOR_PERSONAL.userId });
      seedProject('seen');
      seedBinding('seen');
      db.insert('projectAccess', { projectId: 'seen', userId: MEMBER_WRITE.userId, role: 'READER', verifiedAt: new Date() });

      await service.syncOrganizationProjects(
        MEMBER_WRITE.userId,
        MEMBER_WRITE.githubUserId,
        [{ organizationId: ORG_ID, role: 'MEMBER' }],
        new VerificationContext(),
      );

      expect(records('seen')).toEqual([[MEMBER_WRITE.userId, 'READER']]);
      expect(records('personal-other')).toEqual([]);
      expect(github.calls).toEqual([]);
    });

    it('omits unverifiable candidates without failing and never revokes anything', async () => {
      seedProject('ok');
      seedBinding('ok');
      github.permissionMode = 'UNVERIFIABLE';
      db.insert('projectAccess', { projectId: 'other', userId: MEMBER_WRITE.userId, role: 'READER', verifiedAt: new Date() });

      await expect(
        service.syncOrganizationProjects(
          MEMBER_WRITE.userId,
          MEMBER_WRITE.githubUserId,
          [{ organizationId: ORG_ID, role: 'MEMBER' }],
          new VerificationContext(),
        ),
      ).resolves.toBeUndefined();

      expect(records('ok')).toEqual([]);
      expect(records('other')).toEqual([[MEMBER_WRITE.userId, 'READER']]);
    });

    it('is bounded by the per-request budget and the concurrency limit', async () => {
      const total = ACCESS_VERIFICATION_BUDGET + 8;
      for (let i = 0; i < total; i += 1) {
        seedProject(`p-${i}`);
        seedBinding(`p-${i}`);
      }
      let active = 0;
      let peak = 0;
      const original = github.getRepositoryPermission.bind(github);
      github.getRepositoryPermission = async (...args) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        const result = await original(...args);
        active -= 1;
        return result;
      };

      await service.syncOrganizationProjects(
        MEMBER_WRITE.userId,
        MEMBER_WRITE.githubUserId,
        [{ organizationId: ORG_ID, role: 'MEMBER' }],
        new VerificationContext(),
      );

      expect(db.tables.projectAccess).toHaveLength(ACCESS_VERIFICATION_BUDGET);
      expect(peak).toBeLessThanOrEqual(ACCESS_VERIFICATION_CONCURRENCY);
      expect(peak).toBeGreaterThan(1);
    });

    it('lists the App installations once per request (the context memoizes only that list) and never memoizes denials', async () => {
      seedProject('a');
      seedBinding('a');
      seedProject('b');
      seedBinding('b');
      const context = new VerificationContext();

      await service.syncOrganizationProjects(
        STRANGER.userId,
        STRANGER.githubUserId,
        [{ organizationId: ORG_ID, role: 'MEMBER' }],
        context,
      );

      expect(github.calls.filter((call) => call.method === 'listOrganizationInstallations')).toHaveLength(1);
      // Sin memoizar la denegación: cada candidato vuelve a consultar la membresía.
      expect(github.calls.filter((call) => call.method === 'getOrganizationMembership')).toHaveLength(2);
    });
  });
});

describe('roleForPermission', () => {
  it.each([
    ['admin', 'MAINTAINER'],
    ['maintain', 'MAINTAINER'],
    ['write', 'MAINTAINER'],
    ['triage', 'READER'],
    ['read', 'READER'],
  ] as const)('%s -> %s', (permission, role) => {
    expect(roleForPermission(permission)).toBe(role);
  });
});
