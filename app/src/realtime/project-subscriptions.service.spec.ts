import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryPrisma } from '../../test/support/in-memory-prisma.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ProjectSubscriptionsService } from './project-subscriptions.service.js';

const socketOf = (id: string) => ({ id, leave: vi.fn().mockResolvedValue(undefined) });

/**
 * Mapa socket -> Project y expulsión al perder acceso, con el mismo predicado que HTTP
 * (`accessibleProject`) evaluado sobre datos en memoria.
 */
describe('ProjectSubscriptionsService (HU59, HU60, WebSocket §6.6)', () => {
  let db: InMemoryPrisma;
  let service: ProjectSubscriptionsService;

  const grant = (projectId: string, userId: string, role: string) =>
    db.insert('projectAccess', { projectId, userId, role, verifiedAt: new Date() });
  const binding = () => db.tables.repositoryBinding[0] as { status: string };

  beforeEach(() => {
    db = new InMemoryPrisma();
    service = new ProjectSubscriptionsService(new ProjectAccessRepository(db as unknown as PrismaService));
    db.insert('project', { id: 'org-project', name: 'p', ownerUserId: 'owner', githubOrgId: '42', githubOrgLogin: 'acme' });
    db.insert('project', { id: 'personal', name: 'mine', ownerUserId: 'creator' });
    db.insert('repositoryBinding', { projectId: 'org-project', status: 'ENABLED', repositoryName: 'acme/w' });
    grant('org-project', 'owner', 'ADMIN');
    grant('org-project', 'writer', 'MAINTAINER');
    grant('org-project', 'reader', 'READER');
  });

  it('keeps the socket -> Project map: several versions, several projects, cleared on disconnect', () => {
    const socket = socketOf('s1');

    service.track(socket, 'reader', 'v1', 'org-project');
    service.track(socket, 'reader', 'v2', 'org-project');
    service.track(socket, 'reader', 'v3', 'personal');

    expect(service.projectsOf('s1').sort()).toEqual(['org-project', 'personal']);

    service.untrack('s1', 'v3');
    expect(service.projectsOf('s1')).toEqual(['org-project']);
    service.forget('s1');
    expect(service.projectsOf('s1')).toEqual([]);
  });

  it('evicts the sockets of a user whose access record was deleted, leaving the others subscribed', async () => {
    const reader = socketOf('reader-socket');
    const writer = socketOf('writer-socket');
    service.track(reader, 'reader', 'v1', 'org-project');
    service.track(writer, 'writer', 'v1', 'org-project');
    db.tables.projectAccess = db.tables.projectAccess.filter((row) => row.userId !== 'reader');

    const evicted = await service.revalidateProject('org-project');

    expect(evicted).toBe(1);
    expect(reader.leave).toHaveBeenCalledWith('project-version:v1');
    expect(writer.leave).not.toHaveBeenCalled();
    expect(service.projectsOf('reader-socket')).toEqual([]);
    expect(service.projectsOf('writer-socket')).toEqual(['org-project']);
  });

  describe('revalidateSocket (second check of a fresh subscription)', () => {
    it('true while the user still sees the project; false and evicted (only that socket) when the access disappeared before the socket was tracked', async () => {
      const writer = socketOf('writer-socket');
      const reader = socketOf('reader-socket');
      service.track(writer, 'writer', 'v1', 'org-project');
      expect(await service.revalidateSocket('writer-socket', 'org-project')).toBe(true);

      // La revocación borró el registro ANTES de que `reader` se registrara: `revalidateProject` no pudo verlo.
      db.tables.projectAccess = db.tables.projectAccess.filter((row) => row.userId !== 'reader');
      service.track(reader, 'reader', 'v1', 'org-project');

      expect(await service.revalidateSocket('reader-socket', 'org-project')).toBe(false);
      expect(reader.leave).toHaveBeenCalledWith('project-version:v1');
      expect(service.projectsOf('reader-socket')).toEqual([]);
      expect(writer.leave).not.toHaveBeenCalled();
    });

    it('false for a socket that is not tracked', async () => {
      expect(await service.revalidateSocket('nobody', 'org-project')).toBe(false);
    });
  });

  it('evicts every subscriber of a logically deleted project, the Admin included', async () => {
    const admin = socketOf('admin-socket');
    const writer = socketOf('writer-socket');
    service.track(admin, 'owner', 'v1', 'org-project');
    service.track(writer, 'writer', 'v1', 'org-project');
    (db.tables.project.find((row) => row.id === 'org-project') as Record<string, unknown>).deletedAt = new Date();

    expect(await service.revalidateProject('org-project')).toBe(2);
    expect(admin.leave).toHaveBeenCalled();
    expect(writer.leave).toHaveBeenCalled();
  });

  it('a REVOKED binding evicts the non-Admin subscribers but keeps the Admin (who still sees the project)', async () => {
    const admin = socketOf('admin-socket');
    const writer = socketOf('writer-socket');
    const reader = socketOf('reader-socket');
    service.track(admin, 'owner', 'v1', 'org-project');
    service.track(writer, 'writer', 'v1', 'org-project');
    service.track(reader, 'reader', 'v1', 'org-project');
    binding().status = 'REVOKED';

    expect(await service.revalidateProject('org-project')).toBe(2);

    expect(admin.leave).not.toHaveBeenCalled();
    expect(writer.leave).toHaveBeenCalledWith('project-version:v1');
    expect(reader.leave).toHaveBeenCalledWith('project-version:v1');
    expect(service.projectsOf('admin-socket')).toEqual(['org-project']);
  });

  it('evicts nobody while everybody still sees the project, and ignores sockets of other projects', async () => {
    const creator = socketOf('creator-socket');
    service.track(socketOf('writer-socket'), 'writer', 'v1', 'org-project');
    service.track(creator, 'creator', 'v9', 'personal');
    (db.tables.projectAccess = db.tables.projectAccess.filter((row) => row.userId !== 'writer'));

    expect(await service.revalidateProject('personal')).toBe(0);
    expect(creator.leave).not.toHaveBeenCalled();
    expect(await service.revalidateProject('org-project')).toBe(1);
  });

  it('only leaves the rooms of the revoked project when a socket is subscribed to several', async () => {
    const socket = socketOf('s1');
    service.track(socket, 'writer', 'v-org', 'org-project');
    service.track(socket, 'writer', 'v-other', 'other-project');
    db.insert('project', { id: 'other-project', name: 'o', ownerUserId: 'writer' });
    db.tables.projectAccess = db.tables.projectAccess.filter((row) => row.userId !== 'writer');

    await service.revalidateProject('org-project');

    expect(socket.leave).toHaveBeenCalledTimes(1);
    expect(socket.leave).toHaveBeenCalledWith('project-version:v-org');
    expect(service.projectsOf('s1')).toEqual(['other-project']);
  });

  it('evictUser removes one user from a project unconditionally (a revocation the caller already decided)', async () => {
    const admin = socketOf('admin-socket');
    const writer = socketOf('writer-socket');
    service.track(admin, 'owner', 'v1', 'org-project');
    service.track(writer, 'writer', 'v1', 'org-project');

    expect(await service.evictUser('org-project', 'writer')).toBe(1);

    expect(writer.leave).toHaveBeenCalled();
    expect(admin.leave).not.toHaveBeenCalled();
  });

  it('propagates a database error so the caller (a corte-5 job) can retry', async () => {
    service.track(socketOf('s1'), 'writer', 'v1', 'org-project');
    const failing = new ProjectAccessRepository(db as unknown as PrismaService);
    failing.findVisible = vi.fn().mockRejectedValue(new Error('db down'));
    const broken = new ProjectSubscriptionsService(failing);
    broken.track(socketOf('s2'), 'writer', 'v1', 'org-project');

    await expect(broken.revalidateProject('org-project')).rejects.toThrow('db down');
  });
});
