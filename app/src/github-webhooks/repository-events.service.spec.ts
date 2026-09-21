import { beforeEach, describe, expect, it } from 'vitest';
import { buildAccessSyncHarness, ORG_ID, socketOf } from '../../test/support/access-sync-harness.js';
import { RepositoryEventsService } from './repository-events.service.js';

const event = (action: string, repository: Record<string, unknown> = {}) => ({
  action,
  repository: { id: 100, full_name: 'acme/widgets', owner: { id: Number(ORG_ID), login: 'acme', type: 'Organization' }, ...repository },
  installation: { id: 7 },
});

describe('RepositoryEventsService (HU61, tabla de eventos de §6.9)', () => {
  let h: ReturnType<typeof buildAccessSyncHarness>;
  let service: RepositoryEventsService;

  beforeEach(() => {
    h = buildAccessSyncHarness();
    service = new RepositoryEventsService(h.bindings, h.lifecycle);
    h.seedOrgProject('p1', { repositoryId: '100', repositoryName: 'acme/widgets' });
    h.grant('p1', 'admin', 'ADMIN');
    h.grant('p1', 'writer', 'MAINTAINER');
    h.grant('p1', 'reader', 'READER');
  });

  describe('renamed', () => {
    it('updates repositoryName without touching the status or the access records', async () => {
      await service.handle(event('renamed', { full_name: 'acme/gadgets' }));

      expect(h.bindingOf('p1')).toMatchObject({ repositoryName: 'acme/gadgets', status: 'ENABLED' });
      expect(h.recordsOf('p1')).toHaveLength(3);
    });

    it.each(['DISABLED', 'REVOKED'])('is processed although the binding is %s (access events do not depend on binding.status)', async (status) => {
      h.bindingOf('p1').status = status;

      await service.handle(event('renamed', { full_name: 'acme/gadgets' }));

      expect(h.bindingOf('p1')).toMatchObject({ repositoryName: 'acme/gadgets', status });
    });

    it('is idempotent on duplicates and ignores a payload without a usable name', async () => {
      await service.handle(event('renamed', { full_name: 'acme/gadgets' }));
      await service.handle(event('renamed', { full_name: 'acme/gadgets' }));
      await service.handle(event('renamed', { full_name: '' }));
      await service.handle(event('renamed', { full_name: undefined }));

      expect(h.bindingOf('p1').repositoryName).toBe('acme/gadgets');
    });

    it('also updates the binding of a PERSONAL project', async () => {
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200', repositoryName: 'creator/old' });

      await service.handle(event('renamed', { id: 200, full_name: 'creator/new', owner: { id: 7001 } }));

      expect(h.bindingOf('mine').repositoryName).toBe('creator/new');
    });
  });

  describe('transferred', () => {
    it('out of the organization: REVOKED, Maintainer and Reader deleted, Admin kept, sockets evicted', async () => {
      const reader = socketOf('reader-socket');
      const admin = socketOf('admin-socket');
      h.subscriptions.track(reader, 'reader', 'v1', 'p1');
      h.subscriptions.track(admin, 'admin', 'v1', 'p1');

      await service.handle(event('transferred', { full_name: 'other/widgets', owner: { id: 999, login: 'other', type: 'Organization' } }));

      expect(h.bindingOf('p1').status).toBe('REVOKED');
      expect(h.recordsOf('p1')).toEqual(['admin:ADMIN']);
      expect(reader.leave).toHaveBeenCalled();
      expect(admin.leave).not.toHaveBeenCalled();
    });

    it('to the same organization: only updates the name', async () => {
      await service.handle(event('transferred', { full_name: 'acme/renamed-on-transfer' }));

      expect(h.bindingOf('p1')).toMatchObject({ status: 'ENABLED', repositoryName: 'acme/renamed-on-transfer' });
      expect(h.recordsOf('p1')).toHaveLength(3);
    });

    it("out of a personal project's creator account: REVOKED", async () => {
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200', repositoryName: 'creator/repo' });

      await service.handle(event('transferred', { id: 200, full_name: 'someone/repo', owner: { id: 8002 } }));

      expect(h.bindingOf('mine').status).toBe('REVOKED');
    });

    it("to the creator's own account (personal): only updates the name", async () => {
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200', repositoryName: 'org-a/repo' });

      await service.handle(event('transferred', { id: 200, full_name: 'creator/repo', owner: { id: 7001 } }));

      expect(h.bindingOf('mine')).toMatchObject({ status: 'ENABLED', repositoryName: 'creator/repo' });
    });

    it('never infers a transfer without a persisted identity (personal) or without the new owner', async () => {
      h.seedPersonalProject('mine', 'creator', null, { repositoryId: '200', repositoryName: 'creator/repo' });

      await service.handle(event('transferred', { id: 200, full_name: 'someone/repo', owner: { id: 8002 } }));
      await service.handle(event('transferred', { full_name: 'acme/widgets', owner: undefined }));

      expect(h.bindingOf('mine').status).toBe('ENABLED');
      expect(h.bindingOf('p1').status).toBe('ENABLED');
    });

    it('a late transfer back to the organization does not reactivate a REVOKED binding (only an Admin does, via enable)', async () => {
      await service.handle(event('transferred', { owner: { id: 999 } }));
      await service.handle(event('transferred', { owner: { id: Number(ORG_ID) } }));

      expect(h.bindingOf('p1').status).toBe('REVOKED');
    });
  });

  describe('deleted', () => {
    it('REVOKED and the Maintainer/Reader records are deleted, keeping the Admin; duplicates are harmless', async () => {
      await service.handle(event('deleted'));
      await service.handle(event('deleted'));

      expect(h.bindingOf('p1').status).toBe('REVOKED');
      expect(h.recordsOf('p1')).toEqual(['admin:ADMIN']);
    });

    it('is processed although the binding was DISABLED by the user', async () => {
      h.bindingOf('p1').status = 'DISABLED';

      await service.handle(event('deleted'));

      expect(h.bindingOf('p1').status).toBe('REVOKED');
    });

    it('a rename that arrives after the deletion changes the name but never undoes the REVOKED state', async () => {
      await service.handle(event('deleted'));
      await service.handle(event('renamed', { full_name: 'acme/late-name' }));

      expect(h.bindingOf('p1')).toMatchObject({ status: 'REVOKED', repositoryName: 'acme/late-name' });
    });

    it('revokes PERSONAL project bindings too (they have no records to delete)', async () => {
      h.seedPersonalProject('mine', 'creator', '7001', { repositoryId: '200' });

      await service.handle(event('deleted', { id: 200 }));

      expect(h.bindingOf('mine').status).toBe('REVOKED');
    });
  });

  it('privatized has no effect on the binding in this stage (the reverification of records is stage 3b)', async () => {
    await service.handle(event('privatized'));

    expect(h.bindingOf('p1')).toMatchObject({ status: 'ENABLED', repositoryName: 'acme/widgets' });
    expect(h.recordsOf('p1')).toHaveLength(3);
  });

  it.each(['archived', 'unarchived', 'publicized', 'edited', 'created', 'anything'])('ignores the unlisted action %s', async (action) => {
    await service.handle(event(action, { full_name: 'acme/other' }));

    expect(h.bindingOf('p1')).toMatchObject({ status: 'ENABLED', repositoryName: 'acme/widgets' });
  });

  it('ignores a repository with no binding, a soft-deleted project and a malformed payload', async () => {
    await service.handle(event('deleted', { id: 555 }));
    (h.db.tables.project.find((row) => row.id === 'p1') as Record<string, unknown>).deletedAt = new Date();
    await service.handle(event('deleted'));
    await service.handle({ action: 'deleted' } as never);

    expect(h.bindingOf('p1').status).toBe('ENABLED');
  });
});
