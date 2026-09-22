import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAccessSyncHarness, ORG_ID, ORG_LOGIN, socketOf } from '../../test/support/access-sync-harness.js';
import { accessBackoffMs } from './access-backoff.js';
import { AccessReverifyJobHandler } from './access-reverify.job-handler.js';
import { ACCESS_REVERIFY_JOB_TYPE, reverifyDedupeKey, type AccessReverifyScope } from './access-reverify.scope.js';

const W = 'acme/widgets';
const G = 'acme/gadgets';
const owner = { ownerId: ORG_ID, ownerLogin: ORG_LOGIN, ownerType: 'Organization' as const };

/**
 * `ACCESS_REVERIFY` de punta a punta sobre la cola en memoria (HU61, corte 5b): el job recalcula
 * los registros que señala el evento con las mismas reglas que el alta, bajo el mismo advisory lock
 * por `(projectId, userId)`; borra lo confirmado perdido, actualiza el rol, conserva lo no
 * verificable reprogramándolo con backoff (sin consumir intentos) y expulsa sockets.
 */
describe('AccessReverifyJobHandler (HU61)', () => {
  let h: ReturnType<typeof buildAccessSyncHarness>;
  let handler: AccessReverifyJobHandler;

  beforeEach(() => {
    h = buildAccessSyncHarness();
    handler = new AccessReverifyJobHandler(h.jobs, h.reverify);
    handler.onModuleInit();
    h.seedOrganization({ boss: 'owner', writer: 'member', reader: 'member', newbie: 'member' });
    h.seedOrgProject('p1', { repositoryId: '100', repositoryName: W });
    h.seedOrgProject('p2', { repositoryId: '101', repositoryName: G });
    h.seedOrgProject('p3', null); // sin repositorio: solo Admin
    h.github.addRepository(W, { repositoryId: '100', ...owner }).addRepository(G, { repositoryId: '101', ...owner });
    h.github
      .setPermission(W, 'gh-writer', 'write')
      .setPermission(G, 'gh-writer', 'write')
      .setPermission(W, 'gh-reader', 'read')
      .setPermission(G, 'gh-reader', 'read');
    for (const project of ['p1', 'p2', 'p3']) {
      h.grant(project, 'boss', 'ADMIN');
    }
    h.grant('p1', 'writer', 'MAINTAINER');
    h.grant('p2', 'writer', 'MAINTAINER');
    h.grant('p1', 'reader', 'READER');
    h.grant('p2', 'reader', 'READER');
  });

  const enqueue = (scope: AccessReverifyScope) => h.reverify.enqueue(scope);
  const run = () => h.jobs.runOnce();
  const allRecords = () => [...h.recordsOf('p1'), ...h.recordsOf('p2'), ...h.recordsOf('p3')].sort();
  const verifiedAtOf = (projectId: string, userId: string) =>
    (h.db.tables.projectAccess.find((row) => row.projectId === projectId && row.userId === userId) as { verifiedAt: Date }).verifiedAt;

  describe('the role always comes from a live verification, never from the event', () => {
    it('confirms an unchanged access (updates verifiedAt) without changing the role', async () => {
      const before = verifiedAtOf('p1', 'writer');
      await new Promise((resolve) => setTimeout(resolve, 5));
      await enqueue({ scope: 'USER_REPOSITORY', githubUserId: 'gh-writer', repositoryId: '100' });

      await run();

      expect(h.recordsOf('p1')).toContain('writer:MAINTAINER');
      expect(verifiedAtOf('p1', 'writer').getTime()).toBeGreaterThan(before.getTime());
      expect(h.queue.jobs.map((job) => job.status)).toEqual(['COMPLETED']);
    });

    it('changes the role when GitHub says it changed (write -> read: Maintainer -> Reader)', async () => {
      h.github.setPermission(W, 'gh-writer', 'read');
      await enqueue({ scope: 'USER_REPOSITORY', githubUserId: 'gh-writer', repositoryId: '100' });

      await run();

      expect(h.recordsOf('p1')).toContain('writer:READER');
      expect(h.recordsOf('p2')).toContain('writer:MAINTAINER'); // el alcance es solo el repositorio del evento
    });

    it('promotes to Admin when the user became an owner (a stale event payload cannot decide this)', async () => {
      h.github.setMembership(ORG_LOGIN, 'gh-writer', { role: 'admin', state: 'active' });
      await enqueue({ scope: 'USER_REPOSITORY', githubUserId: 'gh-writer', repositoryId: '100' });

      await run();

      expect(h.recordsOf('p1')).toContain('writer:ADMIN');
    });

    it('deletes the record when GitHub confirms the permission was lost (member removed from the repository)', async () => {
      h.github.removePermission(W, 'gh-writer');
      await enqueue({ scope: 'USER_REPOSITORY', githubUserId: 'gh-writer', repositoryId: '100' });

      await run();

      expect(h.recordsOf('p1')).toEqual(['boss:ADMIN', 'reader:READER']);
      expect(h.recordsOf('p2')).toContain('writer:MAINTAINER');
    });

    it('a duplicate or late event after the fact is harmless (idempotent) and never recreates anything', async () => {
      h.github.removePermission(W, 'gh-writer');
      const event: AccessReverifyScope = { scope: 'USER_REPOSITORY', githubUserId: 'gh-writer', repositoryId: '100' };
      await enqueue(event);
      await run();
      await enqueue(event);
      await run();

      expect(h.recordsOf('p1')).toEqual(['boss:ADMIN', 'reader:READER']);
    });

    it('an event about a user that lost access and then GOT IT BACK is decided by the live state (out of order)', async () => {
      h.github.removePermission(W, 'gh-writer');
      await enqueue({ scope: 'USER_REPOSITORY', githubUserId: 'gh-writer', repositoryId: '100' }); // "removed"
      h.github.setPermission(W, 'gh-writer', 'write'); // ...pero ya lo recuperó cuando corre el job
      await run();

      expect(h.recordsOf('p1')).toContain('writer:MAINTAINER');
    });

    it('never creates a record: a user without one is left alone (access is created on entry)', async () => {
      await enqueue({ scope: 'USER_REPOSITORY', githubUserId: 'gh-newbie', repositoryId: '100' });

      await run();

      expect(h.recordsOf('p1')).not.toContain('newbie:READER');
      expect(allRecords()).toHaveLength(7);
    });

    it('a githubUserId with no Core user (never signed in) has nothing to reverify and asks GitHub nothing', async () => {
      await enqueue({ scope: 'USER_REPOSITORY', githubUserId: 'gh-stranger', repositoryId: '100' });

      await run();

      expect(h.queue.jobs.map((job) => job.status)).toEqual(['COMPLETED']);
      expect(h.github.calls).toEqual([]);
    });

    it('a Maintainer/Reader record whose binding is REVOKED is deleted even if GitHub still says the user is a member', async () => {
      h.bindingOf('p1').status = 'REVOKED';
      await enqueue({ scope: 'REPOSITORY', repositoryId: '100' });

      await run();

      expect(h.recordsOf('p1')).toEqual(['boss:ADMIN']);
    });
  });

  describe('scopes select exactly the records of the table in INTEROP §6.9', () => {
    it('USER_ORGANIZATION (organization.member_removed): every project of the organization, Admin records included', async () => {
      h.github.removeMembership(ORG_LOGIN, 'gh-boss');
      h.github.setOwners(ORG_LOGIN, [{ githubUserId: 'gh-other', login: 'other' }]);
      await enqueue({ scope: 'USER_ORGANIZATION', githubUserId: 'gh-boss', organizationId: ORG_ID });

      await run();

      expect(h.recordsOf('p1')).toEqual(['reader:READER', 'writer:MAINTAINER']);
      expect(h.recordsOf('p3')).toEqual([]); // el Project sin repositorio también pierde su Admin
    });

    it('USER_ORGANIZATION_REPOSITORIES (membership): only the projects WITH a repository', async () => {
      h.github.removeMembership(ORG_LOGIN, 'gh-boss');
      await enqueue({ scope: 'USER_ORGANIZATION_REPOSITORIES', githubUserId: 'gh-boss', organizationId: ORG_ID });

      await run();

      expect(h.recordsOf('p1')).not.toContain('boss:ADMIN');
      expect(h.recordsOf('p2')).not.toContain('boss:ADMIN');
      expect(h.recordsOf('p3')).toEqual(['boss:ADMIN']); // sin repositorio: un Team no lo afecta
    });

    it('REPOSITORY (repository.privatized, team with repository.id): every user of the projects linked to it', async () => {
      h.github.removePermission(W, 'gh-writer');
      h.github.removePermission(W, 'gh-reader');
      h.github.removePermission(G, 'gh-reader'); // p2 no se toca: otro repositorio
      await enqueue({ scope: 'REPOSITORY', repositoryId: '100' });

      await run();

      expect(h.recordsOf('p1')).toEqual(['boss:ADMIN']);
      expect(h.recordsOf('p2')).toEqual(['boss:ADMIN', 'reader:READER', 'writer:MAINTAINER']);
    });

    it('ORGANIZATION_REPOSITORIES (team without repository.id): every project with a repository of the organization', async () => {
      h.github.removePermission(W, 'gh-reader');
      h.github.removePermission(G, 'gh-reader');
      await enqueue({ scope: 'ORGANIZATION_REPOSITORIES', organizationId: ORG_ID });

      await run();

      expect(h.recordsOf('p1')).toEqual(['boss:ADMIN', 'writer:MAINTAINER']);
      expect(h.recordsOf('p2')).toEqual(['boss:ADMIN', 'writer:MAINTAINER']);
      expect(h.recordsOf('p3')).toEqual(['boss:ADMIN']);
    });

    it('never touches another organization, a personal project or a soft-deleted project', async () => {
      h.db.insert('project', { id: 'other', name: 'other', ownerUserId: 'x', githubOrgId: '777', githubOrgLogin: 'other' });
      h.grant('other', 'writer', 'MAINTAINER');
      h.db.insert('project', { id: 'gone', name: 'gone', ownerUserId: 'x', githubOrgId: ORG_ID, githubOrgLogin: ORG_LOGIN, deletedAt: new Date() });
      h.grant('gone', 'writer', 'MAINTAINER');
      h.github.removeMembership(ORG_LOGIN, 'gh-writer');
      await enqueue({ scope: 'USER_ORGANIZATION', githubUserId: 'gh-writer', organizationId: ORG_ID });

      await run();

      expect(h.recordsOf('other')).toEqual(['writer:MAINTAINER']);
      expect(h.recordsOf('gone')).toEqual(['writer:MAINTAINER']);
      expect(h.recordsOf('p1')).not.toContain('writer:MAINTAINER');
    });
  });

  describe('WebSocket', () => {
    it('evicts from the project rooms whoever lost access, and keeps the sockets of who did not', async () => {
      const writer = socketOf('writer-socket');
      const reader = socketOf('reader-socket');
      h.subscriptions.track(writer, 'writer', 'v1', 'p1');
      h.subscriptions.track(reader, 'reader', 'v1b', 'p1');
      h.github.removePermission(W, 'gh-writer');
      await enqueue({ scope: 'REPOSITORY', repositoryId: '100' });

      await run();

      expect(writer.leave).toHaveBeenCalled();
      expect(reader.leave).not.toHaveBeenCalled();
    });
  });

  describe('GitHub not verifiable: keep what exists, retry with backoff, never fail silently', () => {
    const scope: AccessReverifyScope = { scope: 'USER_REPOSITORY', githubUserId: 'gh-writer', repositoryId: '100' };

    it.each([
      ['permission not verifiable', () => (h.github.permissionMode = 'UNVERIFIABLE')],
      ['installation list not verifiable', () => (h.github.installationsMode = 'UNVERIFIABLE')],
      ['Members: read not accepted', () => h.github.setOrganizationMode(ORG_LOGIN, 'UNVERIFIABLE')],
    ])('%s: the record is kept and the job goes back to PENDING with backoff without consuming an attempt', async (_name, breakGithub) => {
      breakGithub();
      await enqueue(scope);

      await run();

      expect(h.recordsOf('p1')).toContain('writer:MAINTAINER');
      const [job] = h.queue.jobs;
      expect(job).toMatchObject({ status: 'PENDING', attempts: 0, lockedBy: null });
      expect(job.availableAt.getTime() - h.queue.now().getTime()).toBe(accessBackoffMs(0));
      expect(job.payload).toEqual({ ...scope, deferrals: 1 });
      expect(job.lastError).toContain('reintento 1');
    });

    it('a suspended installation is not verifiable either: nothing is deleted and nothing is granted', async () => {
      h.github.removeOrganization(ORG_LOGIN);
      h.github.addOrganization({ installationId: 'inst-42', organizationId: ORG_ID, organizationLogin: ORG_LOGIN, avatarUrl: null, suspended: true });
      await enqueue({ scope: 'REPOSITORY', repositoryId: '100' });

      await run();

      expect(allRecords()).toHaveLength(7);
      expect(h.queue.jobs[0].status).toBe('PENDING');
    });

    it('the backoff grows with every deferral, is capped at one hour, and the job succeeds once GitHub recovers', async () => {
      h.github.permissionMode = 'UNVERIFIABLE';
      h.github.removePermission(W, 'gh-writer');
      await enqueue(scope);

      const delays: number[] = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await run();
        const [job] = h.queue.jobs;
        delays.push(job.availableAt.getTime() - h.queue.now().getTime());
        h.queue.advance(delays[delays.length - 1]);
      }

      expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000]);
      expect(h.queue.jobs[0].attempts).toBe(0); // reprogramar nunca consume maxAttempts
      expect(h.recordsOf('p1')).toContain('writer:MAINTAINER'); // se conservó todo el tiempo

      h.github.permissionMode = 'NORMAL'; // GitHub se recupera: el job confirma la pérdida y termina
      await run();

      expect(h.recordsOf('p1')).not.toContain('writer:MAINTAINER');
      expect(h.queue.jobs[0].status).toBe('COMPLETED');
    });

    it('reschedules the COMPLETE scope (not only the pending pairs), so an event absorbed into it is still covered', async () => {
      h.github.setPermission(W, 'gh-writer', 'write');
      const original = h.access.reverify.bind(h.access);
      vi.spyOn(h.access, 'reverify').mockImplementation((projectId, userId, githubUserId, context) =>
        userId === 'reader' ? Promise.resolve('UNVERIFIABLE' as const) : original(projectId, userId, githubUserId, context),
      );
      await enqueue({ scope: 'REPOSITORY', repositoryId: '100' });

      await run();

      expect(h.queue.jobs[0].payload).toEqual({ scope: 'REPOSITORY', repositoryId: '100', deferrals: 1 });
    });

    it('an unexpected error on ONE record does not stop the others and follows the NORMAL failure path (consumes attempts, no deferral counter), until FAILED', async () => {
      h.github.removePermission(W, 'gh-writer');
      const original = h.access.reverify.bind(h.access);
      const failing = vi.spyOn(h.access, 'reverify').mockImplementation((projectId, userId, githubUserId, context) =>
        userId === 'boss' ? Promise.reject(new Error('lock timeout')) : original(projectId, userId, githubUserId, context),
      );
      await enqueue({ scope: 'REPOSITORY', repositoryId: '100' });

      await run();

      expect(h.recordsOf('p1')).not.toContain('writer:MAINTAINER'); // los demás se procesaron
      expect(h.queue.jobs[0]).toMatchObject({ status: 'PENDING', attempts: 1, payload: { scope: 'REPOSITORY', repositoryId: '100' } });
      expect(h.queue.jobs[0].payload).not.toHaveProperty('deferrals');
      expect(h.queue.jobs[0].lastError).toContain('error inesperado');

      h.queue.advance(60_000);
      await run();
      expect(h.queue.jobs[0]).toMatchObject({ status: 'PENDING', attempts: 2 });
      h.queue.advance(60_000);
      await run();
      expect(h.queue.jobs[0]).toMatchObject({ status: 'FAILED', attempts: 3 }); // visible en la cola, no en silencio

      failing.mockRestore();
    });

    it('when a record fails unexpectedly AND another is only not verifiable, the failure wins (normal path)', async () => {
      const original = h.access.reverify.bind(h.access);
      vi.spyOn(h.access, 'reverify').mockImplementation((projectId, userId, githubUserId, context) => {
        if (userId === 'boss') return Promise.reject(new Error('boom'));
        if (userId === 'reader') return Promise.resolve('UNVERIFIABLE' as const);
        return original(projectId, userId, githubUserId, context);
      });
      await enqueue({ scope: 'REPOSITORY', repositoryId: '100' });

      await run();

      expect(h.queue.jobs[0]).toMatchObject({ attempts: 1 });
    });

    it('a new event of the same scope absorbed into the backoff PENDING is brought forward and runs right away', async () => {
      h.github.permissionMode = 'UNVERIFIABLE';
      await enqueue(scope);
      await run();
      expect(await h.queue.claimNext('w')).toBeNull(); // en backoff (1 min)

      h.github.permissionMode = 'NORMAL';
      h.github.removePermission(W, 'gh-writer');
      await enqueue(scope); // se absorbe en el PENDING y lo adelanta

      expect(h.queue.pending()).toHaveLength(1);
      await run();

      expect(h.recordsOf('p1')).not.toContain('writer:MAINTAINER');
    });

    it('when GitHub is down the reconciliation-independent conservation holds for every scope: nothing is revoked', async () => {
      h.github.installationsMode = 'UNVERIFIABLE';
      for (const each of [
        { scope: 'USER_ORGANIZATION', githubUserId: 'gh-boss', organizationId: ORG_ID },
        { scope: 'REPOSITORY', repositoryId: '100' },
        { scope: 'ORGANIZATION_REPOSITORIES', organizationId: ORG_ID },
      ] as const) {
        await enqueue(each);
        await run();
        h.queue.advance(3_600_000);
      }

      expect(allRecords()).toHaveLength(7);
    });
  });

  describe('a payload that cannot be understood', () => {
    it('is dropped with a log, never retried and never touches anything', async () => {
      await h.jobs.enqueueDeduped(ACCESS_REVERIFY_JOB_TYPE, { scope: 'NOPE' }, { dedupeKey: 'ACCESS_REVERIFY:bad' });
      await h.jobs.enqueueDeduped(ACCESS_REVERIFY_JOB_TYPE, { scope: 'REPOSITORY' }, { dedupeKey: 'ACCESS_REVERIFY:bad2' });

      await run();
      await run();

      expect(h.queue.jobs.map((job) => job.status)).toEqual(['COMPLETED', 'COMPLETED']);
      expect(allRecords()).toHaveLength(7);
    });
  });

  describe('the queue: an event during a RUNNING reverification of the same scope runs AFTER it', () => {
    it('enqueues a new PENDING that only runs once the first one finished (never in parallel), and verifies the LIVE state', async () => {
      const scope: AccessReverifyScope = { scope: 'USER_REPOSITORY', githubUserId: 'gh-writer', repositoryId: '100' };
      await enqueue(scope);
      const order: string[] = [];
      let workerBSaw: unknown = 'not-tried';
      const original = h.access.reverify.bind(h.access);
      vi.spyOn(h.access, 'reverify').mockImplementation(async (projectId, userId, githubUserId, context) => {
        order.push(`reverify ${projectId}`);
        if (order.length === 1) {
          // Llega otro evento del mismo alcance mientras este job está RUNNING: se encola (no se pierde)...
          h.github.removePermission(W, 'gh-writer');
          await enqueue(scope);
          // ...pero un segundo worker no lo toma mientras el primero siga vigente.
          workerBSaw = await h.queue.claimNext('worker-b');
        }
        return original(projectId, userId, githubUserId, context);
      });

      await run();
      expect(workerBSaw).toBeNull();
      expect(h.queue.pending()).toHaveLength(1);
      // El primero pudo haber visto el permiso o no; el segundo, que corre después, verifica en vivo.
      await run();

      expect(h.recordsOf('p1')).not.toContain('writer:MAINTAINER');
      expect(h.queue.jobs.every((job) => job.status === 'COMPLETED')).toBe(true);
    });
  });

  describe('signup vs revocation event race (event side)', () => {
    /** Un alta cuya lectura de GitHub queda bloqueada dentro de su advisory lock. */
    const signupInFlight = () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = h.github.getRepositoryPermission.bind(h.github);
      vi.spyOn(h.github, 'getRepositoryPermission').mockImplementation(async (repository, githubUserId) => {
        const result = await original(repository, githubUserId); // GitHub responde ANTES de que el usuario pierda el acceso...
        await gate; // ...pero el alta aún no ha hecho el upsert
        return result;
      });
      return release;
    };

    beforeEach(() => {
      h.github.setPermission(W, 'gh-newbie', 'read');
    });

    it('a member_removed event that arrives while the signup is in flight cannot be undone by it: the reverification runs after and deletes the stale record', async () => {
      const release = signupInFlight();
      const signup = h.access.grantOnEntry('p1', 'newbie', 'gh-newbie');
      await vi.waitFor(() => expect(h.github.calls.some((call) => call.method === 'getRepositoryPermission' && call.githubUserId === 'gh-newbie')).toBe(true));

      h.github.removeMembership(ORG_LOGIN, 'gh-newbie'); // el usuario sale de la organización
      await enqueue({ scope: 'USER_ORGANIZATION', githubUserId: 'gh-newbie', organizationId: ORG_ID });
      const reverification = run(); // espera el lock del alta: no puede intercalarse
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(h.recordsOf('p1')).not.toContain('newbie:READER');

      release(); // el alta termina con su veredicto obsoleto y crea el registro...
      expect(await signup).toEqual({ status: 'GRANTED', role: 'READER' });
      await reverification; // ...y la reverificación, que corre DESPUÉS, verifica en vivo y lo borra

      expect(h.recordsOf('p1')).not.toContain('newbie:READER');
      expect(h.queue.jobs.at(-1)?.status).toBe('COMPLETED');
    });

    it('a signup that starts after the reverification that deleted the access sees the live state and does not recreate it', async () => {
      await h.access.grantOnEntry('p1', 'newbie', 'gh-newbie');
      h.github.removeMembership(ORG_LOGIN, 'gh-newbie');
      await enqueue({ scope: 'USER_ORGANIZATION', githubUserId: 'gh-newbie', organizationId: ORG_ID });
      await run();
      expect(h.recordsOf('p1')).not.toContain('newbie:READER');

      expect(await h.access.grantOnEntry('p1', 'newbie', 'gh-newbie')).toEqual({ status: 'DENIED' });
      expect(h.recordsOf('p1')).not.toContain('newbie:READER');
    });

    it('takes ONE advisory lock per (project, user), the same one of the signup', async () => {
      h.db.lockLog.length = 0;
      await enqueue({ scope: 'USER_REPOSITORY', githubUserId: 'gh-writer', repositoryId: '100' });

      await run();

      expect(h.db.lockLog).toEqual(['project_access:p1:writer']);
    });
  });

  describe('ProjectAccessService.reverify, the shared building block', () => {
    it('a soft-deleted project (or a personal one) makes the record meaningless: deleted', async () => {
      h.db.insert('project', { id: 'gone', name: 'gone', ownerUserId: 'x', githubOrgId: ORG_ID, githubOrgLogin: ORG_LOGIN, deletedAt: new Date() });
      h.grant('gone', 'writer', 'MAINTAINER');

      expect(await h.access.reverify('gone', 'writer', 'gh-writer')).toBe('REVOKED');
      expect(h.recordsOf('gone')).toEqual([]);
      expect(h.github.calls).toEqual([]);
    });

    it('NO_RECORD without asking GitHub when there is nothing to reverify', async () => {
      expect(await h.access.reverify('p1', 'newbie', 'gh-newbie')).toBe('NO_RECORD');
      expect(h.github.calls).toEqual([]);
    });

    it('a transaction that times out or cannot get a connection is UNVERIFIABLE (the record is kept), any other error propagates', async () => {
      const lock = vi.spyOn(h.accessRepository, 'withAccessLock').mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'P2028' }));
      expect(await h.access.reverify('p1', 'writer', 'gh-writer')).toBe('UNVERIFIABLE');

      lock.mockRejectedValueOnce(new Error('db down'));
      await expect(h.access.reverify('p1', 'writer', 'gh-writer')).rejects.toThrow('db down');
      expect(h.recordsOf('p1')).toContain('writer:MAINTAINER');
    });

    it('a Maintainer whose binding was revoked between the live read and the upsert is denied (FOR SHARE confirmation), as in the signup', async () => {
      vi.spyOn(h.github, 'getRepositoryPermission').mockImplementation(async () => {
        h.bindingOf('p1').status = 'REVOKED'; // la transición llega mientras se verifica
        return { status: 'OK', value: 'write' };
      });

      expect(await h.access.reverify('p1', 'writer', 'gh-writer')).toBe('REVOKED');
      expect(h.recordsOf('p1')).not.toContain('writer:MAINTAINER');
    });
  });

  it('the dedupeKey of every scope is stable and includes every id that selects', () => {
    expect(reverifyDedupeKey({ scope: 'USER_REPOSITORY', githubUserId: '5', repositoryId: '9' })).toBe('ACCESS_REVERIFY:USER_REPOSITORY:5:9');
    expect(reverifyDedupeKey({ scope: 'REPOSITORY', repositoryId: '9' })).toBe('ACCESS_REVERIFY:REPOSITORY:9');
    expect(reverifyDedupeKey({ scope: 'ORGANIZATION_REPOSITORIES', organizationId: '4' })).toBe('ACCESS_REVERIFY:ORGANIZATION_REPOSITORIES:4');
    expect(new Set([
      reverifyDedupeKey({ scope: 'USER_ORGANIZATION', githubUserId: '5', organizationId: '4' }),
      reverifyDedupeKey({ scope: 'USER_ORGANIZATION_REPOSITORIES', githubUserId: '5', organizationId: '4' }),
    ]).size).toBe(2);
  });
});
