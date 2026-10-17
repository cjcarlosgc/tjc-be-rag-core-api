import { beforeEach, describe, expect, it } from 'vitest';
import { buildAccessSyncHarness, ORG_ID, socketOf } from '../../test/support/access-sync-harness.js';
import { AccessEventsService } from './access-events.service.js';

/**
 * Eventos de acceso de organización (`INTEROP-2.4` §6.9, tabla de eventos; HU61): por evento y
 * `action`. El manejador SOLO selecciona qué reverificar (nunca aplica un rol del payload), encola
 * un `ACCESS_REVERIFY` deduplicado por alcance y no llama a GitHub.
 */
describe('AccessEventsService (HU61, tabla de eventos de §6.9)', () => {
  let h: ReturnType<typeof buildAccessSyncHarness>;
  let service: AccessEventsService;

  beforeEach(() => {
    h = buildAccessSyncHarness();
    service = new AccessEventsService(h.reverify, h.organizations, h.accessRepository);
    h.seedOrganization({ boss: 'owner', writer: 'member' });
    h.seedOrgProject('p1', { repositoryId: '100', repositoryName: 'acme/widgets' });
    h.grant('p1', 'boss', 'ADMIN');
    h.grant('p1', 'writer', 'MAINTAINER');
  });

  const jobs = () => h.queue.pending().map((job) => job.payload);
  const noGithubCalls = () => expect(h.github.calls).toEqual([]);

  describe('member (added, edited, removed): the user over the projects linked to repository.id', () => {
    it.each(['added', 'edited', 'removed'])('%s enqueues USER_REPOSITORY with the ids of the payload and never calls GitHub', async (action) => {
      await service.handle('member', { action, member: { id: 501 }, repository: { id: 100 } });

      expect(jobs()).toEqual([{ scope: 'USER_REPOSITORY', githubUserId: '501', repositoryId: '100' }]);
      expect(h.queue.pending()[0].dedupeKey).toBe('ACCESS_REVERIFY:USER_REPOSITORY:501:100');
      noGithubCalls();
    });

    it('an unlisted action, a payload without ids and a repository that is not linked to an organization project enqueue nothing', async () => {
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200' });

      await service.handle('member', { action: 'archived', member: { id: 501 }, repository: { id: 100 } });
      await service.handle('member', { action: 'added', repository: { id: 100 } });
      await service.handle('member', { action: 'added', member: { id: 'x' as never }, repository: { id: 100 } });
      await service.handle('member', { action: 'added', member: { id: 501 }, repository: { id: 999 } }); // sin binding
      await service.handle('member', { action: 'added', member: { id: 501 }, repository: { id: 200 } }); // Project personal

      expect(jobs()).toEqual([]);
    });

    it('the event only selects: it never changes an access record by itself', async () => {
      await service.handle('member', { action: 'removed', member: { id: 501 }, repository: { id: 100 } });

      expect(h.recordsOf('p1')).toEqual(['boss:ADMIN', 'writer:MAINTAINER']);
    });
  });

  describe('membership (added, removed): the user over the projects WITH a repository of organization.id', () => {
    it.each(['added', 'removed'])('%s enqueues USER_ORGANIZATION_REPOSITORIES', async (action) => {
      await service.handle('membership', { action, member: { id: 501 }, organization: { id: Number(ORG_ID) } });

      expect(jobs()).toEqual([{ scope: 'USER_ORGANIZATION_REPOSITORIES', githubUserId: '501', organizationId: ORG_ID }]);
      noGithubCalls();
    });

    it('ignores other actions, malformed payloads and an organization without live projects', async () => {
      await service.handle('membership', { action: 'edited', member: { id: 501 }, organization: { id: 42 } });
      await service.handle('membership', { action: 'added', organization: { id: 42 } });
      await service.handle('membership', { action: 'added', member: { id: 501 }, organization: { id: 777 } });

      expect(jobs()).toEqual([]);
    });
  });

  describe('organization', () => {
    it('member_removed enqueues USER_ORGANIZATION over ALL the projects of the organization (Admin records included)', async () => {
      await service.handle('organization', { action: 'member_removed', membership: { user: { id: 501 } }, organization: { id: 42, login: 'acme' } });

      expect(jobs()).toEqual([{ scope: 'USER_ORGANIZATION', githubUserId: '501', organizationId: ORG_ID }]);
      expect(h.queue.pending()[0].dedupeKey).toBe(`ACCESS_REVERIFY:USER_ORGANIZATION:501:${ORG_ID}`);
    });

    it.each(['member_added', 'member_invited', 'created', 'anything'])('%s does not enqueue anything (nothing is revoked; access is created on entry)', async (action) => {
      await service.handle('organization', { action, membership: { user: { id: 501 } }, organization: { id: 42, login: 'acme' } });

      expect(jobs()).toEqual([]);
    });

    it('member_removed without the user id or the organization id is ignored', async () => {
      await service.handle('organization', { action: 'member_removed', organization: { id: 42 } });
      await service.handle('organization', { action: 'member_removed', membership: { user: { id: 501 } } });

      expect(jobs()).toEqual([]);
    });

    it('renamed updates the stored login of every project of the organization and nothing else', async () => {
      h.seedOrgProject('p2', null);
      h.seedPersonalProject('mine', 'creator', '7001');

      await service.handle('organization', { action: 'renamed', changes: { login: { from: 'acme' } }, organization: { id: 42, login: 'acme-renamed' } } as never);

      const logins = h.db.tables.project.map((row) => `${row.id}:${row.githubOrgLogin}`).sort();
      expect(logins).toEqual(['mine:null', 'p1:acme-renamed', 'p2:acme-renamed']);
      expect(h.recordsOf('p1')).toEqual(['boss:ADMIN', 'writer:MAINTAINER']);
      expect(h.bindingOf('p1').status).toBe('ENABLED');
      noGithubCalls();
    });

    it('renamed with a missing id or login is ignored, and a rename of another organization does not touch this one', async () => {
      await service.handle('organization', { action: 'renamed', organization: { id: 42 } });
      await service.handle('organization', { action: 'renamed', organization: { login: 'x' } });
      await service.handle('organization', { action: 'renamed', organization: { id: 999, login: 'other' } });

      expect(h.db.tables.project.every((row) => row.githubOrgLogin === 'acme')).toBe(true);
    });

    it('deleted hides and keeps every project: bindings REVOKED, ALL records deleted (Admin included), sockets evicted, nothing deleted', async () => {
      h.seedOrgProject('p2', null); // sin repositorio: solo Admin
      h.grant('p2', 'boss', 'ADMIN');
      const writerSocket = socketOf('writer-socket');
      const bossSocket = socketOf('boss-socket');
      h.subscriptions.track(writerSocket, 'writer', 'v1', 'p1');
      h.subscriptions.track(bossSocket, 'boss', 'v2', 'p2');

      await service.handle('organization', { action: 'deleted', organization: { id: 42, login: 'acme' } });

      expect(h.bindingOf('p1').status).toBe('REVOKED');
      expect(h.recordsOf('p1')).toEqual([]);
      expect(h.recordsOf('p2')).toEqual([]);
      expect(h.db.tables.project.filter((row) => row.deletedAt == null)).toHaveLength(2); // Projects y evidencia conservados
      expect(h.db.tables.repositoryBinding).toHaveLength(1);
      expect(writerSocket.leave).toHaveBeenCalled();
      expect(bossSocket.leave).toHaveBeenCalled();
      expect(jobs()).toEqual([]);
    });

    it('deleted is idempotent (duplicate or late) and does not touch another organization or a personal project', async () => {
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200' });
      h.db.insert('project', { id: 'other', name: 'other', ownerUserId: 'x', githubOrgId: '777', githubOrgLogin: 'other' });
      h.grant('other', 'someone', 'ADMIN');

      await service.handle('organization', { action: 'deleted', organization: { id: 42 } });
      await service.handle('organization', { action: 'deleted', organization: { id: 42 } });

      expect(h.bindingOf('p1').status).toBe('REVOKED');
      expect(h.bindingOf('mine').status).toBe('ENABLED');
      expect(h.recordsOf('other')).toEqual(['someone:ADMIN']);
    });
  });

  describe('team (added_to_repository, removed_from_repository, edited, deleted)', () => {
    it.each(['added_to_repository', 'removed_from_repository', 'edited', 'deleted'])(
      '%s with repository.id enqueues REPOSITORY (all the records of the projects linked to it)',
      async (action) => {
        await service.handle('team', { action, repository: { id: 100 }, organization: { id: 42 } });

        expect(jobs()).toEqual([{ scope: 'REPOSITORY', repositoryId: '100' }]);
      },
    );

    it.each(['edited', 'deleted'])('%s WITHOUT repository.id enqueues ORGANIZATION_REPOSITORIES (every project with a repository of organization.id)', async (action) => {
      await service.handle('team', { action, organization: { id: 42 } });

      expect(jobs()).toEqual([{ scope: 'ORGANIZATION_REPOSITORIES', organizationId: ORG_ID }]);
      expect(h.queue.pending()[0].dedupeKey).toBe(`ACCESS_REVERIFY:ORGANIZATION_REPOSITORIES:${ORG_ID}`);
    });

    it('created and other actions do not enqueue; a payload with neither repository nor organization is ignored', async () => {
      await service.handle('team', { action: 'created', organization: { id: 42 } });
      await service.handle('team', { action: 'edited' });
      await service.handle('team', { action: 'deleted', repository: { id: 999 }, organization: { id: 42 } }); // repositorio sin binding

      expect(jobs()).toEqual([]);
    });
  });

  describe('deduplication of the jobs (only over PENDING)', () => {
    it('duplicate and out-of-order deliveries of the same scope collapse in a single PENDING job', async () => {
      const event = { action: 'removed', member: { id: 501 }, repository: { id: 100 } };
      await service.handle('member', event);
      await service.handle('member', event);
      await service.handle('member', { ...event, action: 'added' });

      expect(h.queue.pending()).toHaveLength(1);
    });

    it('different scopes are different jobs', async () => {
      await service.handle('member', { action: 'removed', member: { id: 501 }, repository: { id: 100 } });
      await service.handle('member', { action: 'removed', member: { id: 502 }, repository: { id: 100 } });
      await service.handle('team', { action: 'edited', repository: { id: 100 } });

      expect(h.queue.pending()).toHaveLength(3);
    });

    it('an event while a job of the same scope is RUNNING enqueues a new PENDING that runs after it', async () => {
      const event = { action: 'removed', member: { id: 501 }, repository: { id: 100 } };
      await service.handle('member', event);
      await h.queue.claimNext('worker-a'); // RUNNING

      await service.handle('member', event);

      expect(h.queue.pending()).toHaveLength(1);
      expect(await h.queue.claimNext('worker-b')).toBeNull(); // no corre en paralelo con el RUNNING vigente
    });

    it('an event absorbed by a PENDING that is waiting out a backoff brings it forward to now', async () => {
      const event = { action: 'removed', member: { id: 501 }, repository: { id: 100 } };
      await service.handle('member', event);
      const claimed = (await h.queue.claimNext('worker-a'))!;
      await h.queue.reschedule(claimed, 1_800_000, 'GitHub no verificable');
      expect(await h.queue.claimNext('worker-a')).toBeNull(); // en backoff

      await service.handle('member', event);

      expect(await h.queue.claimNext('worker-a')).toMatchObject({ id: claimed.id });
    });
  });
});
