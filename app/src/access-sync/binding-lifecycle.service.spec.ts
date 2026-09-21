import { describe, expect, it, vi } from 'vitest';
import { buildAccessSyncHarness, socketOf } from '../../test/support/access-sync-harness.js';

describe('BindingLifecycleService (HU61)', () => {
  const setup = () => {
    const h = buildAccessSyncHarness();
    const binding = h.seedOrgProject('p1')!;
    h.grant('p1', 'admin', 'ADMIN');
    h.grant('p1', 'writer', 'MAINTAINER');
    h.grant('p1', 'reader', 'READER');
    return { ...h, binding: binding as unknown as Parameters<typeof h.lifecycle.revokeBinding>[0] };
  };

  it('moves the binding to REVOKED and deletes the Maintainer and Reader records, keeping the Admin', async () => {
    const h = setup();

    await h.lifecycle.revokeBinding(h.binding);

    expect(h.bindingOf('p1').status).toBe('REVOKED');
    expect(h.recordsOf('p1')).toEqual(['admin:ADMIN']);
  });

  it('takes ONE advisory lock per (project, user) through ProjectAccessService.revoke', async () => {
    const h = setup();

    await h.lifecycle.revokeBinding(h.binding);

    expect([...h.db.lockLog].sort()).toEqual(['project_access:p1:reader', 'project_access:p1:writer']);
  });

  it('evicts the WebSocket subscriptions of who lost access, keeping the Admin subscribed', async () => {
    const h = setup();
    const admin = socketOf('admin-socket');
    const reader = socketOf('reader-socket');
    h.subscriptions.track(admin, 'admin', 'v1', 'p1');
    h.subscriptions.track(reader, 'reader', 'v1', 'p1');

    await h.lifecycle.revokeBinding(h.binding);

    expect(reader.leave).toHaveBeenCalledWith('project-version:v1');
    expect(admin.leave).not.toHaveBeenCalled();
  });

  it('is idempotent: a duplicated or late event changes nothing else', async () => {
    const h = setup();

    await h.lifecycle.revokeBinding(h.binding);
    const after = { ...h.bindingOf('p1') };
    await h.lifecycle.revokeBinding({ ...h.binding, status: 'REVOKED' });

    expect(h.bindingOf('p1').status).toBe('REVOKED');
    expect(h.recordsOf('p1')).toEqual(['admin:ADMIN']);
    expect(h.bindingOf('p1')).toMatchObject({ id: after.id });
  });

  it('an already REVOKED binding still finishes deleting leftover records without rewriting the status', async () => {
    const h = setup();
    h.bindingOf('p1').status = 'REVOKED';
    const updateStatus = vi.spyOn(h.bindings, 'updateStatus');

    await h.lifecycle.revokeBinding({ ...h.binding, status: 'REVOKED' });

    expect(updateStatus).not.toHaveBeenCalled();
    expect(h.recordsOf('p1')).toEqual(['admin:ADMIN']);
  });

  it('a failure deleting one user does not stop the others nor the socket eviction, and is reported at the end', async () => {
    const h = setup();
    const reader = socketOf('reader-socket');
    h.subscriptions.track(reader, 'reader', 'v1', 'p1');
    const revoke = h.access.revoke.bind(h.access);
    vi.spyOn(h.access, 'revoke').mockImplementation((projectId, userId) =>
      userId === 'writer' ? Promise.reject(new Error('lock timeout')) : revoke(projectId, userId),
    );

    await expect(h.lifecycle.revokeBinding(h.binding)).rejects.toThrow(/Revocación incompleta/);

    expect(h.recordsOf('p1')).toEqual(['admin:ADMIN', 'writer:MAINTAINER']);
    expect(h.bindingOf('p1').status).toBe('REVOKED');
    // El writer conserva un registro sobrante, pero la revalidación usa el predicado: con el binding REVOKED ya no lo ve.
    expect(reader.leave).toHaveBeenCalled();
  });

  describe('expectedOwnerId', () => {
    it('is the organization id for an organization project', async () => {
      const h = setup();
      expect(await h.lifecycle.expectedOwnerId({ ownerUserId: 'owner', githubOrgId: '42' })).toBe('42');
    });

    it("is the creator's persisted githubUserId for a personal project, and null without an identity", async () => {
      const h = setup();
      await h.identities.create('creator', '7001', null);

      expect(await h.lifecycle.expectedOwnerId({ ownerUserId: 'creator', githubOrgId: null })).toBe('7001');
      expect(await h.lifecycle.expectedOwnerId({ ownerUserId: 'nobody', githubOrgId: null })).toBeNull();
      expect(await h.lifecycle.expectedOwnerId({ ownerUserId: null, githubOrgId: null })).toBeNull();
    });
  });
});
