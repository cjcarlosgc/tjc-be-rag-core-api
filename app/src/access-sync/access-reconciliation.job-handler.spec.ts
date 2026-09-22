import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { buildAccessSyncHarness, ORG_ID, socketOf } from '../../test/support/access-sync-harness.js';
import { InMemoryJobsRepository } from '../../test/support/in-memory-jobs.repository.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { JobsRepository } from '../jobs/jobs.repository.js';
import { ACCESS_RECONCILIATION_DEDUPE_KEY, ACCESS_RECONCILIATION_JOB_TYPE } from './access-sync.constants.js';
import { AccessReconciliationJobHandler } from './access-reconciliation.job-handler.js';

const HOUR = 3_600_000;
const owner = (ownerId: string) => ({ ownerId, ownerLogin: 'x', ownerType: 'Organization' as const });

describe('AccessReconciliationJobHandler (HU61, parte (c) y cadena)', () => {
  let h: ReturnType<typeof buildAccessSyncHarness>;
  let queue: InMemoryJobsRepository;
  let jobs: JobsService;
  let handler: AccessReconciliationJobHandler;
  let config: Record<string, unknown>;

  const build = () => {
    const configService = { get: (key: string, fallback?: unknown) => config[key] ?? fallback } as unknown as ConfigService;
    jobs = new JobsService(queue as unknown as JobsRepository, configService);
    handler = new AccessReconciliationJobHandler(jobs, configService, h.bindings, h.lifecycle, h.github, h.organizations, h.reverify, h.accessRepository);
    handler.onModuleInit();
  };

  /** Repositorio de GitHub registrado con el propietario de la organización `42`. */
  const repo = (name: string, repositoryId: string, ownerId = ORG_ID) =>
    h.github.addRepository(name, { repositoryId, ...owner(ownerId) });

  beforeEach(() => {
    h = buildAccessSyncHarness();
    // La organización `42` sigue instalada y con un owner (las partes (a) y (b) no la ocultan);
    // `admin` es su owner y `writer`/`reader` sus miembros.
    h.seedOrganization({ admin: 'owner', writer: 'member', reader: 'member' });
    queue = new InMemoryJobsRepository();
    config = {};
    build();
  });

  describe('seeding at startup', () => {
    it('enqueues one occurrence when there is none', async () => {
      expect(await handler.seed()).toBe(true);

      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)).toHaveLength(1);
      expect(queue.jobs[0]).toMatchObject({ type: ACCESS_RECONCILIATION_JOB_TYPE, dedupeKey: ACCESS_RECONCILIATION_DEDUPE_KEY });
    });

    it('is skipped while a PENDING exists (several instances do not duplicate the chain)', async () => {
      await handler.seed();

      expect(await handler.seed()).toBe(false);
      expect(queue.jobs).toHaveLength(1);
    });

    it('is skipped while a non-stale RUNNING exists', async () => {
      await handler.seed();
      await queue.claimNext('worker-a');

      expect(await handler.seed()).toBe(false);
      expect(queue.pending()).toHaveLength(0);
    });

    it('treats a stale RUNNING as absent and seeds', async () => {
      await handler.seed();
      await queue.claimNext('worker-a');
      queue.advance(700_000); // > JOBS_STALE_LOCK_MS por defecto (10 min)

      expect(await handler.seed()).toBe(true);
      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)).toHaveLength(1);
    });

    it('does nothing when the reconciliation is disabled', async () => {
      config.ACCESS_RECONCILIATION_ENABLED = false;

      expect(await handler.seed()).toBe(false);
      expect(queue.jobs).toHaveLength(0);
    });

    it('a startup failure (database down) does not abort the application boot', async () => {
      vi.spyOn(jobs, 'enqueueDeduped').mockRejectedValue(new Error('db down'));

      await expect(handler.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });

  describe('the hourly chain', () => {
    it('enqueues the next occurrence (now + 1 h) at the START of the run, while its own row is RUNNING', async () => {
      await handler.seed();
      const findLive = vi.spyOn(h.bindings, 'findLiveForReconciliation').mockImplementation(async () => {
        // A mitad de la ejecución la siguiente ocurrencia ya existe y la fila propia sigue RUNNING.
        expect(queue.jobs.map((job) => job.status).sort()).toEqual(['PENDING', 'RUNNING']);
        return [];
      });

      await jobs.runOnce();

      expect(findLive).toHaveBeenCalled();
      const [next] = queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY);
      expect(next.availableAt.getTime() - queue.now().getTime()).toBe(HOUR);
      expect(queue.jobs.filter((job) => job.status === 'COMPLETED')).toHaveLength(1);
    });

    it('survives a failure in the middle of the run: exactly one PENDING remains and the failed run is discarded (N1)', async () => {
      await handler.seed();
      vi.spyOn(h.bindings, 'findLiveForReconciliation').mockRejectedValue(new Error('db down mid-run'));

      await jobs.runOnce();

      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)).toHaveLength(1);
      const [failed] = queue.jobs.filter((job) => job.status !== 'PENDING');
      expect(failed).toMatchObject({ status: 'COMPLETED', lastError: expect.stringContaining('Descartado') });
      // La cadena continúa a la hora siguiente.
      expect(queue.pending()[0].availableAt.getTime() - queue.now().getTime()).toBe(HOUR);
    });

    it('runs again one hour later and keeps chaining', async () => {
      await handler.seed();
      await jobs.runOnce();
      expect(await queue.claimNext('w')).toBeNull(); // todavía no toca

      queue.advance(HOUR);
      await jobs.runOnce();

      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)).toHaveLength(1);
      expect(queue.jobs.filter((job) => job.status === 'COMPLETED')).toHaveLength(2);
    });

    it('does not chain when disabled', async () => {
      await handler.seed();
      config.ACCESS_RECONCILIATION_ENABLED = false;

      await jobs.runOnce();

      expect(queue.pending()).toHaveLength(0);
    });

    it('a stale RUNNING run is released and re-run (its PENDING successor already covers the chain)', async () => {
      await handler.seed();
      const dead = (await queue.claimNext('dead-worker'))!;
      await queue.insertDeduped({
        type: ACCESS_RECONCILIATION_JOB_TYPE,
        payload: {},
        maxAttempts: 3,
        dedupeKey: ACCESS_RECONCILIATION_DEDUPE_KEY,
        delayMs: HOUR,
      });
      queue.advance(700_000);

      await jobs.runOnce(); // barrido: el RUNNING obsoleto se descarta porque ya hay un PENDING

      expect(queue.jobs.find((job) => job.id === dead.id)?.status).toBe('COMPLETED');
      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)).toHaveLength(1);
    });
  });

  describe('part (c): owner and name of every live binding, personal projects included', () => {
    const run = () => handler.run({});

    it('renamed: updates repositoryName (organization and personal projects)', async () => {
      h.seedOrgProject('p1', { repositoryId: '100', repositoryName: 'acme/old' });
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200', repositoryName: 'creator/old' });
      repo('acme/new', '100');
      repo('creator/new', '200', '7001');

      const summary = await run();

      expect(summary).toMatchObject({ checked: 2, renamed: 2, revoked: 0 });
      expect(h.bindingOf('p1')).toMatchObject({ repositoryName: 'acme/new', status: 'ENABLED' });
      expect(h.bindingOf('mine')).toMatchObject({ repositoryName: 'creator/new', status: 'ENABLED' });
    });

    it('reads the repository by its immutable id with the binding installation', async () => {
      h.seedOrgProject('p1', { repositoryId: '100', repositoryName: 'acme/widgets' });
      repo('acme/widgets', '100');

      await run();

      expect(h.github.calls).toEqual([{ method: 'getRepositoryById', repositoryId: '100' }]);
    });

    it('transferred out of the organization: REVOKED, Maintainer/Reader deleted, Admin kept, sockets evicted', async () => {
      h.seedOrgProject('p1', { repositoryId: '100', repositoryName: 'acme/widgets' });
      h.grant('p1', 'admin', 'ADMIN');
      h.grant('p1', 'writer', 'MAINTAINER');
      h.grant('p1', 'reader', 'READER');
      repo('acme/widgets', '100');
      h.github.transferRepository('acme/widgets', owner('999'));
      const reader = socketOf('reader-socket');
      h.subscriptions.track(reader, 'reader', 'v1', 'p1');

      const summary = await run();

      expect(summary).toMatchObject({ revoked: 1 });
      expect(h.bindingOf('p1').status).toBe('REVOKED');
      expect(h.recordsOf('p1')).toEqual(['admin:ADMIN']);
      expect(reader.leave).toHaveBeenCalled();
    });

    it("transferred out of a personal project's creator account: REVOKED", async () => {
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200', repositoryName: 'creator/repo' });
      repo('creator/repo', '200', '7001');
      h.github.transferRepository('creator/repo', owner('8002'));

      await run();

      expect(h.bindingOf('mine').status).toBe('REVOKED');
    });

    it('a personal project without a persisted identity is never revoked for its owner (only the name is corrected)', async () => {
      h.seedPersonalProject('mine', 'creator', null, { repositoryId: '200', repositoryName: 'creator/old' });
      repo('someone/new', '200', '8002');

      await run();

      expect(h.bindingOf('mine')).toMatchObject({ status: 'ENABLED', repositoryName: 'someone/new' });
    });

    it('deleted (GitHub confirms NOT_FOUND): REVOKED and records deleted', async () => {
      h.seedOrgProject('p1', { repositoryId: '100' });
      h.grant('p1', 'reader', 'READER');

      const summary = await run(); // el repositorio no está registrado en el fake: 404

      expect(summary).toMatchObject({ revoked: 1 });
      expect(h.bindingOf('p1').status).toBe('REVOKED');
      expect(h.recordsOf('p1')).toEqual([]);
    });

    it('App no longer installed (NOT_INSTALLED, confirmed by GitHub, not an outage): REVOKED', async () => {
      h.seedOrgProject('p1', { repositoryId: '100' });
      h.github.ownerMode = 'NOT_INSTALLED';

      await run();

      expect(h.bindingOf('p1').status).toBe('REVOKED');
    });

    it('GitHub unverifiable: keeps everything, never revokes on a network error, and still chains the next occurrence', async () => {
      h.seedOrgProject('p1', { repositoryId: '100', repositoryName: 'acme/widgets' });
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200' });
      h.grant('p1', 'reader', 'READER');
      h.github.ownerMode = 'UNVERIFIABLE';
      h.github.permissionMode = 'UNVERIFIABLE'; // la parte (b) tampoco puede verificar el registro: lo conserva
      await handler.seed();

      await jobs.runOnce();

      expect(h.bindingOf('p1').status).toBe('ENABLED');
      expect(h.bindingOf('mine').status).toBe('ENABLED');
      expect(h.recordsOf('p1')).toEqual(['reader:READER']);
      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)).toHaveLength(1);
    });

    it('a binding that has not changed is left alone', async () => {
      h.seedOrgProject('p1', { repositoryId: '100', repositoryName: 'acme/widgets' });
      repo('acme/widgets', '100');

      expect(await run()).toMatchObject({ checked: 1, unchanged: 1, renamed: 0, revoked: 0 });
    });

    it('revalidates a user-paused (DISABLED) binding too, but not a REVOKED one', async () => {
      h.seedOrgProject('paused', { status: 'DISABLED', repositoryId: '100', repositoryName: 'acme/old' });
      h.seedOrgProject('revoked', { status: 'REVOKED', repositoryId: '300', repositoryName: 'acme/gone' });
      repo('acme/new', '100');

      await run();

      expect(h.bindingOf('paused')).toMatchObject({ status: 'DISABLED', repositoryName: 'acme/new' });
      expect(h.github.calls.map((call) => call.repositoryId)).toEqual(['100']);
    });

    it('skips logically deleted projects', async () => {
      h.seedOrgProject('p1', { repositoryId: '100' });
      (h.db.tables.project.find((row) => row.id === 'p1') as Record<string, unknown>).deletedAt = new Date();

      expect(await run()).toMatchObject({ checked: 0 });
    });

    it('finishes an interrupted revocation: a REVOKED binding with leftover Maintainer/Reader records is cleaned without GitHub', async () => {
      h.seedOrgProject('p1', { status: 'REVOKED', repositoryId: '100' });
      h.grant('p1', 'admin', 'ADMIN');
      h.grant('p1', 'reader', 'READER');
      h.github.installationsMode = 'UNVERIFIABLE'; // con GitHub caído solo el barrido (sin GitHub) puede terminar el borrado

      const summary = await run();

      expect(summary).toMatchObject({ leftoverProjectsCleaned: 1, checked: 0 });
      expect(h.recordsOf('p1')).toEqual(['admin:ADMIN']);
      expect(h.github.calls.filter((call) => call.method === 'getRepositoryById')).toEqual([]);
    });

    it('one binding that throws is counted and does not stop the others', async () => {
      h.seedOrgProject('bad', { repositoryId: '100' });
      h.seedOrgProject('good', { repositoryId: '101', repositoryName: 'acme/old' });
      repo('acme/new', '101');
      const original = h.github.getRepositoryById.bind(h.github);
      vi.spyOn(h.github, 'getRepositoryById').mockImplementation((installationId, id) =>
        id === '100' ? Promise.reject(new Error('boom')) : original(installationId, id),
      );

      const summary = await run();

      expect(summary).toMatchObject({ checked: 2, failed: 1, renamed: 1 });
      expect(h.bindingOf('good').repositoryName).toBe('acme/new');
    });

    it('a failure while revoking (records cannot be deleted) is FAILED, not silently REVOKED-and-forgotten', async () => {
      h.seedOrgProject('p1', { repositoryId: '100' });
      h.grant('p1', 'reader', 'READER');
      h.github.permissionMode = 'UNVERIFIABLE'; // la parte (b) conserva el registro; lo borra la revocación de (c)
      vi.spyOn(h.access, 'revoke').mockRejectedValue(new Error('lock timeout'));

      const summary = await run();

      expect(summary).toMatchObject({ failed: 1 });
      // El estado ya es REVOKED (el predicado deniega); el sobrante lo termina la siguiente ocurrencia.
      expect(h.bindingOf('p1').status).toBe('REVOKED');
    });
  });

  describe('verification budget and concurrency per run', () => {
    const seedMany = (count: number) => {
      for (let index = 1; index <= count; index += 1) {
        const id = `p${index}`;
        h.seedOrgProject(id, { repositoryId: `${index}`, repositoryName: `acme/old-${index}` });
        repo(`acme/new-${index}`, `${index}`);
      }
    };

    it('stops at the budget, hands the cursor to the next occurrence, and that occurrence continues from there', async () => {
      seedMany(5);
      config.ACCESS_RECONCILIATION_BUDGET = 2;
      await handler.seed();

      await jobs.runOnce();

      expect(h.github.calls).toHaveLength(2);
      const [next] = queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY);
      expect(next.payload).toEqual({ afterBindingId: expect.any(String) });

      queue.advance(HOUR);
      await jobs.runOnce();
      queue.advance(HOUR);
      await jobs.runOnce();

      // 2 + 2 + 1: cada binding se revalida una vez por vuelta, ninguno se queda sin verificar.
      expect(h.github.calls.map((call) => call.repositoryId).sort()).toEqual(['1', '2', '3', '4', '5']);
      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)[0].payload).toEqual({});
    });

    it('does not truncate when the budget fits everything', async () => {
      seedMany(3);
      config.ACCESS_RECONCILIATION_BUDGET = 3;

      const summary = await handler.run({});

      expect(summary).toMatchObject({ checked: 3, truncated: false });
    });

    it('never has more than ACCESS_RECONCILIATION_CONCURRENCY reads in flight', async () => {
      seedMany(6);
      config.ACCESS_RECONCILIATION_CONCURRENCY = 2;
      let inFlight = 0;
      let peak = 0;
      const original = h.github.getRepositoryById.bind(h.github);
      vi.spyOn(h.github, 'getRepositoryById').mockImplementation(async (installationId, id) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return original(installationId, id);
      });

      await handler.run({});

      expect(peak).toBe(2);
    });
  });

  describe('part (a): organizations with access records', () => {
    const W = 'acme/widgets';
    const setUp = () => {
      h.seedOrgProject('p1', { repositoryId: '100', repositoryName: W });
      h.seedOrgProject('p2', null); // sin repositorio: solo Admin
      repo(W, '100');
      h.github.setPermission(W, 'gh-writer', 'write').setPermission(W, 'gh-reader', 'read');
      h.grant('p1', 'admin', 'ADMIN');
      h.grant('p1', 'writer', 'MAINTAINER');
      h.grant('p1', 'reader', 'READER');
      h.grant('p2', 'admin', 'ADMIN');
    };
    const run = () => handler.run({});

    it('an organization that is resolvable, with the App installed and an owner, is left as is', async () => {
      setUp();

      const summary = await run();

      expect(summary?.organizations).toEqual({ checked: 1, hidden: 0, renamed: 0, unverifiable: 0, failed: 0 });
      expect(h.recordsOf('p1')).toHaveLength(3);
      expect(h.bindingOf('p1').status).toBe('ENABLED');
    });

    it('App uninstalled from the organization: its projects are hidden and kept (bindings REVOKED, ALL records deleted, sockets evicted)', async () => {
      setUp();
      h.github.removeOrganization('acme');
      const writer = socketOf('writer-socket');
      h.subscriptions.track(writer, 'writer', 'v1', 'p1');

      const summary = await run();

      expect(summary?.organizations).toMatchObject({ checked: 1, hidden: 1 });
      expect(h.bindingOf('p1').status).toBe('REVOKED');
      expect(h.recordsOf('p1')).toEqual([]);
      expect(h.recordsOf('p2')).toEqual([]);
      expect(h.db.tables.project).toHaveLength(2); // Projects y evidencia conservados
      expect(writer.leave).toHaveBeenCalled();
    });

    it('organization that GitHub no longer finds (owners read NOT_FOUND): hidden', async () => {
      setUp();
      h.github.setOrganizationMode('acme', 'NOT_FOUND');

      expect((await run())?.organizations).toMatchObject({ hidden: 1 });
      expect(h.recordsOf('p2')).toEqual([]);
    });

    it('an EMPTY owners list (a visibility artifact, an organization cannot have zero owners) hides nothing: unverifiable', async () => {
      setUp();
      h.github.setOwners('acme', []);

      expect((await run())?.organizations).toMatchObject({ hidden: 0, unverifiable: 1 });
      expect(h.recordsOf('p1')).toHaveLength(3);
      expect(h.bindingOf('p1').status).toBe('ENABLED');
    });

    it('organization deleted while its installation record lingers (owners read NOT_INSTALLED): hidden', async () => {
      setUp();
      h.github.setOrganizationMode('acme', 'NOT_INSTALLED');

      expect((await run())?.organizations).toMatchObject({ hidden: 1 });
      expect(h.bindingOf('p1').status).toBe('REVOKED');
    });

    it('GitHub down (installation list, Members: read missing, suspended installation): revokes NOTHING and still chains the next occurrence', async () => {
      setUp();
      await handler.seed();

      h.github.installationsMode = 'UNVERIFIABLE';
      let summary = await jobs.runOnce().then(() => queue.jobs.length);
      expect(summary).toBe(2);
      expect(h.recordsOf('p1')).toHaveLength(3);

      h.github.installationsMode = 'NORMAL';
      h.github.setOrganizationMode('acme', 'UNVERIFIABLE'); // Members: read sin aceptar
      const outcome = await handler.run({});
      expect(outcome?.organizations).toMatchObject({ unverifiable: 1, hidden: 0 });
      expect(h.recordsOf('p1')).toHaveLength(3);
      expect(h.bindingOf('p1').status).toBe('ENABLED');

      h.github.setOrganizationMode('acme', 'NORMAL');
      h.github.removeOrganization('acme');
      h.github.addOrganization({ installationId: 'inst-42', organizationId: ORG_ID, organizationLogin: 'acme', avatarUrl: null, suspended: true });
      expect((await handler.run({}))?.organizations).toMatchObject({ unverifiable: 1, hidden: 0 });
      expect(h.recordsOf('p1')).toHaveLength(3);
      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)).toHaveLength(1);
    });

    it('reads the installation list ONCE per run even though parts (a) and (b) both need it', async () => {
      setUp();

      await run();

      expect(h.github.calls.filter((call) => call.method === 'listOrganizationInstallations')).toHaveLength(1);
      expect(h.github.calls.filter((call) => call.method === 'listOrganizationOwners')).toHaveLength(1);
    });

    it('corrects a stale stored login with the current one of the installation', async () => {
      setUp();
      h.db.tables.project.forEach((row) => (row.githubOrgLogin = 'old-name'));

      expect((await run())?.organizations).toMatchObject({ renamed: 1 });
      expect(h.db.tables.project.every((row) => row.githubOrgLogin === 'acme')).toBe(true);
    });

    it('an organization whose projects have no records is not visited (only organizations with records)', async () => {
      h.seedOrgProject('p1', { repositoryId: '100', repositoryName: W });
      repo(W, '100');
      h.github.removeOrganization('acme');

      const summary = await run();

      expect(summary?.organizations.checked).toBe(0);
      expect(h.bindingOf('p1').status).toBe('ENABLED');
    });

    it('the organization comes back: the Admin re-enters, the binding stays REVOKED until an Admin reactivates it', async () => {
      setUp();
      h.github.removeOrganization('acme');
      await run();
      h.github.addOrganization({ installationId: 'inst-42', organizationId: ORG_ID, organizationLogin: 'acme', avatarUrl: null, suspended: false });

      expect(await h.access.grantOnEntry('p1', 'admin', 'gh-admin')).toEqual({ status: 'GRANTED', role: 'ADMIN' });
      expect(h.bindingOf('p1').status).toBe('REVOKED');
      expect(await h.access.grantOnEntry('p1', 'writer', 'gh-writer')).toEqual({ status: 'DENIED' });
    });

    it('an error in part (a) is logged and does not stop parts (b) and (c)', async () => {
      setUp();
      h.bindingOf('p1').repositoryName = 'acme/old';
      h.github.renameRepository(W, 'acme/new'); // (c) corrige el nombre y (b) ya lee con el nombre nuevo
      h.github.setPermission('acme/new', 'gh-writer', 'read').setPermission('acme/new', 'gh-reader', 'read');
      vi.spyOn(h.accessRepository, 'findOrganizationsWithRecords').mockRejectedValue(new Error('db hiccup'));

      const summary = await run();

      expect(summary?.organizations.checked).toBe(0);
      expect(h.recordsOf('p1')).toContain('writer:READER'); // (b)
      expect(h.bindingOf('p1').repositoryName).toBe('acme/new'); // (c)
    });
  });

  describe('part (b): access records recomputed with the rules of the signup', () => {
    const W = 'acme/widgets';
    const setUp = () => {
      h.seedOrgProject('p1', { repositoryId: '100', repositoryName: W });
      repo(W, '100');
      h.github.setPermission(W, 'gh-writer', 'write').setPermission(W, 'gh-reader', 'read');
      h.grant('p1', 'admin', 'ADMIN');
      h.grant('p1', 'writer', 'MAINTAINER');
      h.grant('p1', 'reader', 'READER');
    };
    const run = () => handler.run({});

    it('confirms unchanged records (verifiedAt is refreshed) and changes nothing else', async () => {
      setUp();

      const summary = await run();

      expect(summary?.records).toMatchObject({ checked: 3, unchanged: 3, updated: 0, revoked: 0, truncated: false });
      expect(h.recordsOf('p1')).toEqual(['admin:ADMIN', 'reader:READER', 'writer:MAINTAINER']);
    });

    it('a role changed WITHOUT an event (permission base of the organization, inherited access) is corrected', async () => {
      setUp();
      h.github.setPermission(W, 'gh-writer', 'read');
      h.github.setPermission(W, 'gh-reader', 'maintain');

      const summary = await run();

      expect(summary?.records).toMatchObject({ updated: 2 });
      expect(h.recordsOf('p1')).toEqual(['admin:ADMIN', 'reader:MAINTAINER', 'writer:READER']);
    });

    it('a role demoted from owner: the Admin record is recalculated too', async () => {
      setUp();
      h.github.setMembership('acme', 'gh-admin', { role: 'member', state: 'active' });
      h.github.setPermission(W, 'gh-admin', 'read');

      await run();

      expect(h.recordsOf('p1')).toContain('admin:READER');
    });

    it('confirmed loss: a member removed, a pending invitation and an external collaborator with write are deleted', async () => {
      setUp();
      h.github.removeMembership('acme', 'gh-writer');
      h.github.setMembership('acme', 'gh-reader', { role: 'member', state: 'pending' });

      const summary = await run();

      expect(summary?.records).toMatchObject({ revoked: 2 });
      expect(h.recordsOf('p1')).toEqual(['admin:ADMIN']);
    });

    it('GitHub not verifiable (permission read): the records are kept, counted, and the next occurrence is chained', async () => {
      setUp();
      h.github.permissionMode = 'UNVERIFIABLE';
      h.github.removePermission(W, 'gh-writer');
      await handler.seed();

      await jobs.runOnce();

      expect(h.recordsOf('p1')).toEqual(['admin:ADMIN', 'reader:READER', 'writer:MAINTAINER']);
      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)).toHaveLength(1);
    });

    it('a network error never revokes: Members: read missing keeps every record', async () => {
      setUp();
      h.github.setOrganizationMode('acme', 'UNVERIFIABLE');
      h.github.removeMembership('acme', 'gh-writer');

      const summary = await run();

      expect(summary?.records).toMatchObject({ unverifiable: 3, revoked: 0 });
      expect(h.recordsOf('p1')).toHaveLength(3);
    });

    it('Maintainer/Reader records of a REVOKED binding are deleted; the Admin keeps the project', async () => {
      setUp();
      h.bindingOf('p1').status = 'REVOKED';

      await run();

      expect(h.recordsOf('p1')).toEqual(['admin:ADMIN']);
    });

    it('does not touch personal projects (they have no records) or soft-deleted projects', async () => {
      setUp();
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200', repositoryName: 'creator/repo' });
      repo('creator/repo', '200', '7001');
      h.db.insert('project', { id: 'gone', name: 'gone', ownerUserId: 'x', githubOrgId: ORG_ID, githubOrgLogin: 'acme', deletedAt: new Date() });
      h.grant('gone', 'writer', 'MAINTAINER');

      await run();

      expect(h.recordsOf('gone')).toEqual(['writer:MAINTAINER']);
      expect(h.github.calls.filter((call) => call.githubUserId !== undefined && call.repositoryName === 'creator/repo')).toEqual([]);
    });

    it('a record whose user has no persisted GitHub identity is skipped and counted (it cannot be verified), never revoked', async () => {
      setUp();
      h.grant('p1', 'ghost', 'READER');

      const summary = await run();

      expect(summary?.records).toMatchObject({ skipped: 1, revoked: 0 });
      expect(h.recordsOf('p1')).toContain('ghost:READER');
    });

    it('stops at the budget, hands the project cursor to the next occurrence together with the binding cursor, and continues there', async () => {
      for (const id of ['pa', 'pb', 'pc']) {
        h.seedOrgProject(id, { repositoryId: `r-${id}`, repositoryName: `acme/${id}` });
        repo(`acme/${id}`, `r-${id}`);
        h.github.setPermission(`acme/${id}`, 'gh-writer', 'read'); // cada registro cambia de Maintainer a Reader
        h.grant(id, 'writer', 'MAINTAINER');
        h.grant(id, 'reader', 'READER');
      }
      h.github.setPermission('acme/pa', 'gh-reader', 'read').setPermission('acme/pb', 'gh-reader', 'read').setPermission('acme/pc', 'gh-reader', 'read');
      config.ACCESS_RECONCILIATION_BUDGET = 3; // dos registros por Project: se agota tras el segundo Project
      await handler.seed();

      await jobs.runOnce();

      const [next] = queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY);
      expect(next.payload).toMatchObject({ afterProjectId: expect.any(String) });
      expect(['pa:writer:READER', 'pb:writer:READER'].every((entry) => h.recordsOf(entry.split(':')[0]).includes(entry.slice(3)))).toBe(true);
      expect(h.recordsOf('pc')).toContain('writer:MAINTAINER'); // aún sin recorrer

      queue.advance(HOUR);
      await jobs.runOnce();

      expect(h.recordsOf('pc')).toContain('writer:READER');
      expect(queue.pending(ACCESS_RECONCILIATION_DEDUPE_KEY)[0].payload).toEqual({});
    });

    it('never has more than five verifications in flight (the verification concurrency)', async () => {
      setUp();
      for (let index = 0; index < 8; index += 1) {
        h.grant('p1', `extra-${index}`, 'READER');
        void h.identities.create(`extra-${index}`, `gh-extra-${index}`, null);
        h.github.setMembership('acme', `gh-extra-${index}`, { role: 'member', state: 'active' }).setPermission(W, `gh-extra-${index}`, 'read');
      }
      let inFlight = 0;
      let peak = 0;
      const original = h.github.getRepositoryPermission.bind(h.github);
      vi.spyOn(h.github, 'getRepositoryPermission').mockImplementation(async (repository, githubUserId) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return original(repository, githubUserId);
      });

      await run();

      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(5);
    });
  });
});
