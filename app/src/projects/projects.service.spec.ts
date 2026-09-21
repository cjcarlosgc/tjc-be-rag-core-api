import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { OrganizationContext, WorkspaceResolution } from '../project-access/organization-access.resolver.js';
import type { Project } from '../generated/prisma/client.js';

const OWNER_USER_ID = 'user-1';
const GITHUB_USER_ID = '1001';
const PERSONAL_WORKSPACE = { kind: 'PERSONAL', id: GITHUB_USER_ID, login: 'octocat' };

const project: Project = {
  id: 'project-1',
  name: 'demo',
  ownerUserId: OWNER_USER_ID,
  currentVersionId: null,
  deletedAt: null,
  githubOrgId: null,
  githubOrgLogin: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const orgProject: Project = { ...project, id: 'project-org', githubOrgId: '42', githubOrgLogin: 'acme' };

function organization(role: 'ADMIN' | 'MEMBER'): OrganizationContext {
  return { organizationId: '42', login: 'acme-renamed', installationId: 'inst-42', avatarUrl: null, role };
}

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repository: {
    create: ReturnType<typeof vi.fn>;
    createInOrganization: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
  };
  let workspaces: { personalRef: ReturnType<typeof vi.fn> };
  let projectAccess: { require: ReturnType<typeof vi.fn>; syncOrganizationProjects: ReturnType<typeof vi.fn> };
  let accessRepository: { findRegisteredOrganizations: ReturnType<typeof vi.fn> };
  let organizations: {
    resolveWorkspace: ReturnType<typeof vi.fn>;
    listMemberOrganizations: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      createInOrganization: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
      rename: vi.fn(),
      softDelete: vi.fn(),
    };
    workspaces = { personalRef: vi.fn().mockResolvedValue(PERSONAL_WORKSPACE) };
    projectAccess = {
      require: vi.fn().mockResolvedValue({ project, role: 'ADMIN' }),
      syncOrganizationProjects: vi.fn().mockResolvedValue(undefined),
    };
    accessRepository = { findRegisteredOrganizations: vi.fn().mockResolvedValue([]) };
    organizations = {
      resolveWorkspace: vi.fn().mockResolvedValue({ status: 'PERSONAL' } satisfies WorkspaceResolution),
      listMemberOrganizations: vi.fn().mockResolvedValue({ status: 'OK', member: [], unverifiable: [] }),
    };

    service = new ProjectsService(
      repository as never,
      workspaces as never,
      projectAccess as never,
      accessRepository as never,
      organizations as never,
    );
  });

  describe('create', () => {
    it('trims the name, persists the owner and returns the serialized personal project', async () => {
      repository.create.mockResolvedValue(project);

      const result = await service.create({ name: '  demo  ' }, OWNER_USER_ID, GITHUB_USER_ID);

      expect(repository.create).toHaveBeenCalledWith('demo', OWNER_USER_ID);
      expect(organizations.resolveWorkspace).toHaveBeenCalledWith(undefined, GITHUB_USER_ID);
      expect(result).toEqual({
        id: 'project-1',
        name: 'demo',
        currentVersionId: null,
        workspace: PERSONAL_WORKSPACE,
        role: 'ADMIN',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('creates a personal project when workspaceId is the own numeric id (HU63)', async () => {
      repository.create.mockResolvedValue(project);

      const result = await service.create({ name: 'demo', workspaceId: GITHUB_USER_ID }, OWNER_USER_ID, GITHUB_USER_ID);

      expect(result.workspace).toEqual(PERSONAL_WORKSPACE);
      expect(repository.createInOrganization).not.toHaveBeenCalled();
    });

    it('creates the project in an organization for its owner with the CURRENT login, as ADMIN (HU63)', async () => {
      organizations.resolveWorkspace.mockResolvedValue({ status: 'ORGANIZATION', organization: organization('ADMIN') });
      repository.createInOrganization.mockResolvedValue({ ...orgProject, githubOrgLogin: 'acme-renamed' });

      const result = await service.create({ name: 'demo', workspaceId: '42' }, OWNER_USER_ID, GITHUB_USER_ID);

      expect(repository.createInOrganization).toHaveBeenCalledWith('demo', OWNER_USER_ID, {
        id: '42',
        login: 'acme-renamed',
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        workspace: { kind: 'ORGANIZATION', id: '42', login: 'acme-renamed' },
        role: 'ADMIN',
      });
    });

    it('answers 403 WORKSPACE_ADMIN_REQUIRED to an active member who is not an owner and persists nothing', async () => {
      organizations.resolveWorkspace.mockResolvedValue({ status: 'ORGANIZATION', organization: organization('MEMBER') });

      await expect(
        service.create({ name: 'demo', workspaceId: '42' }, OWNER_USER_ID, GITHUB_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.WORKSPACE_ADMIN_REQUIRED, status: 403 });
      expect(repository.createInOrganization).not.toHaveBeenCalled();
    });

    it('answers 404 WORKSPACE_NOT_FOUND when it is not a workspace of the user (not a member, App not installed, not numeric)', async () => {
      organizations.resolveWorkspace.mockResolvedValue({ status: 'NOT_FOUND' });

      await expect(
        service.create({ name: 'demo', workspaceId: '4242' }, OWNER_USER_ID, GITHUB_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.WORKSPACE_NOT_FOUND, status: 404 });
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.createInOrganization).not.toHaveBeenCalled();
    });

    it('answers 503 GITHUB_VERIFICATION_UNAVAILABLE when the ownership cannot be verified (nothing new is granted)', async () => {
      organizations.resolveWorkspace.mockResolvedValue({ status: 'UNVERIFIABLE' });

      await expect(
        service.create({ name: 'demo', workspaceId: '42' }, OWNER_USER_ID, GITHUB_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE, status: 503 });
      expect(repository.createInOrganization).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('requires Reader access and returns the project with the role of the user', async () => {
      projectAccess.require.mockResolvedValue({ project: { ...project, currentVersionId: 'version-1' }, role: 'ADMIN' });

      const result = await service.getById('project-1', OWNER_USER_ID, GITHUB_USER_ID);

      expect(projectAccess.require).toHaveBeenCalledWith(OWNER_USER_ID, 'project-1', 'READER');
      expect(result.currentVersionId).toBe('version-1');
      expect(result.workspace).toEqual(PERSONAL_WORKSPACE);
      expect(result.role).toBe('ADMIN');
    });

    it('exposes the organization columns as the workspace and the derived role of an organization project', async () => {
      projectAccess.require.mockResolvedValue({ project: orgProject, role: 'MAINTAINER' });

      const result = await service.getById('project-org', OWNER_USER_ID, GITHUB_USER_ID);

      expect(result.workspace).toEqual({ kind: 'ORGANIZATION', id: '42', login: 'acme' });
      expect(result.role).toBe('MAINTAINER');
    });

    it('propagates the access failure (404 / 503) without looking up the workspace', async () => {
      projectAccess.require.mockRejectedValue(new AppException(ErrorCode.PROJECT_NOT_FOUND, 'nope', 404));

      await expect(service.getById('missing', OWNER_USER_ID, GITHUB_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.PROJECT_NOT_FOUND,
      });
      expect(workspaces.personalRef).not.toHaveBeenCalled();
    });
  });

  describe('update (HU63, PATCH)', () => {
    it('requires the Admin role, renames and returns the updated project', async () => {
      repository.rename.mockResolvedValue(true);
      projectAccess.require.mockResolvedValue({ project: { ...project, name: 'renamed' }, role: 'ADMIN' });

      const result = await service.update('project-1', { name: 'renamed' }, OWNER_USER_ID, GITHUB_USER_ID);

      expect(projectAccess.require).toHaveBeenNthCalledWith(1, OWNER_USER_ID, 'project-1', 'ADMIN');
      expect(repository.rename).toHaveBeenCalledWith('project-1', 'renamed', OWNER_USER_ID);
      expect(result.name).toBe('renamed');
    });

    it('answers 403 PROJECT_ROLE_INSUFFICIENT to a visible non-Admin and renames nothing', async () => {
      projectAccess.require.mockRejectedValue(new AppException(ErrorCode.PROJECT_ROLE_INSUFFICIENT, 'no', 403));

      await expect(
        service.update('project-1', { name: 'x' }, OWNER_USER_ID, GITHUB_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_ROLE_INSUFFICIENT });
      expect(repository.rename).not.toHaveBeenCalled();
    });

    it('answers 404 when the project disappeared between the access check and the rename', async () => {
      repository.rename.mockResolvedValue(false);

      await expect(
        service.update('project-1', { name: 'x' }, OWNER_USER_ID, GITHUB_USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_NOT_FOUND });
    });
  });

  describe('list (HU25/HU58/HU59)', () => {
    it('requests one extra row to detect a next page and strips it from the returned items', async () => {
      repository.findAll.mockResolvedValue([
        { ...project, id: 'project-3', access: [] },
        { ...project, id: 'project-2', access: [] },
        { ...project, id: 'project-1', access: [] },
      ]);

      const page = await service.list(2, undefined, OWNER_USER_ID, GITHUB_USER_ID);

      expect(repository.findAll).toHaveBeenCalledWith(2, OWNER_USER_ID, undefined, undefined);
      expect(page.items.map((item) => item.id)).toEqual(['project-3', 'project-2']);
      expect(page.nextCursor).toBe('project-2');
    });

    it('returns nextCursor null and applies the default limit and the cursor', async () => {
      repository.findAll.mockResolvedValue([{ ...project, access: [] }]);

      const page = await service.list(undefined, 'project-5', OWNER_USER_ID, GITHUB_USER_ID);

      expect(repository.findAll).toHaveBeenCalledWith(20, OWNER_USER_ID, 'project-5', undefined);
      expect(page.nextCursor).toBeNull();
    });

    it('serializes personal projects as ADMIN and organization projects with the role of their access record', async () => {
      repository.findAll.mockResolvedValue([
        { ...orgProject, access: [{ role: 'READER' }] },
        { ...project, access: [] },
      ]);

      const page = await service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID);

      expect(page.items.map((item) => [item.workspace.kind, item.role])).toEqual([
        ['ORGANIZATION', 'READER'],
        ['PERSONAL', 'ADMIN'],
      ]);
      expect(workspaces.personalRef).toHaveBeenCalledTimes(1);
    });

    it('without workspaceId verifies the not-yet-seen projects of the organizations of the user before listing', async () => {
      organizations.listMemberOrganizations.mockResolvedValue({
        status: 'OK',
        member: [organization('ADMIN')],
        unverifiable: [],
      });

      await service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID);

      expect(projectAccess.syncOrganizationProjects).toHaveBeenCalledWith(
        OWNER_USER_ID,
        GITHUB_USER_ID,
        [{ organizationId: '42', role: 'ADMIN' }],
        expect.anything(),
      );
    });

    it('lists what is registered, without failing, when GitHub cannot list the organizations of the user', async () => {
      organizations.listMemberOrganizations.mockResolvedValue({ status: 'UNVERIFIABLE' });
      repository.findAll.mockResolvedValue([{ ...orgProject, access: [{ role: 'MAINTAINER' }] }]);

      const page = await service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID);

      expect(projectAccess.syncOrganizationProjects).not.toHaveBeenCalled();
      expect(page.items).toHaveLength(1);
    });

    it('filters to the personal workspace without any verification', async () => {
      await service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID, GITHUB_USER_ID);

      expect(repository.findAll).toHaveBeenCalledWith(20, OWNER_USER_ID, undefined, { githubOrgId: null });
      expect(projectAccess.syncOrganizationProjects).not.toHaveBeenCalled();
      expect(organizations.listMemberOrganizations).not.toHaveBeenCalled();
    });

    it('with an organization workspaceId verifies its projects and filters to it', async () => {
      organizations.resolveWorkspace.mockResolvedValue({ status: 'ORGANIZATION', organization: organization('MEMBER') });

      await service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID, '42');

      expect(projectAccess.syncOrganizationProjects).toHaveBeenCalledWith(
        OWNER_USER_ID,
        GITHUB_USER_ID,
        [{ organizationId: '42', role: 'MEMBER' }],
        expect.anything(),
      );
      expect(repository.findAll).toHaveBeenCalledWith(20, OWNER_USER_ID, undefined, { githubOrgId: '42' });
    });

    it('answers 404 WORKSPACE_NOT_FOUND for a workspaceId that is not a workspace of the user, before reading any project', async () => {
      organizations.resolveWorkspace.mockResolvedValue({ status: 'NOT_FOUND' });

      await expect(service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID, '4242')).rejects.toMatchObject({
        code: ErrorCode.WORKSPACE_NOT_FOUND,
        status: 404,
      });
      expect(repository.findAll).not.toHaveBeenCalled();
    });

    it('with GitHub down lists the registered projects of the organization, and answers 503 when nothing is registered', async () => {
      organizations.resolveWorkspace.mockResolvedValue({ status: 'UNVERIFIABLE' });
      accessRepository.findRegisteredOrganizations.mockResolvedValue([
        { organizationId: '42', login: 'acme', hasAdmin: false },
      ]);

      await service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID, '42');
      expect(repository.findAll).toHaveBeenCalledWith(20, OWNER_USER_ID, undefined, { githubOrgId: '42' });
      expect(projectAccess.syncOrganizationProjects).not.toHaveBeenCalled();

      repository.findAll.mockClear();
      await expect(service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID, '99')).rejects.toMatchObject({
        code: ErrorCode.GITHUB_VERIFICATION_UNAVAILABLE,
        status: 503,
      });
      expect(repository.findAll).not.toHaveBeenCalled();
    });
  });

  describe('delete (HU56/HU63)', () => {
    it('requires the Admin role and soft-deletes', async () => {
      repository.softDelete.mockResolvedValue(true);

      await expect(service.delete('project-1', OWNER_USER_ID)).resolves.toBeUndefined();
      expect(projectAccess.require).toHaveBeenCalledWith(OWNER_USER_ID, 'project-1', 'ADMIN');
      expect(repository.softDelete).toHaveBeenCalledWith('project-1', OWNER_USER_ID);
    });

    it('answers 403 to a visible non-Admin without deleting', async () => {
      projectAccess.require.mockRejectedValue(new AppException(ErrorCode.PROJECT_ROLE_INSUFFICIENT, 'no', 403));

      await expect(service.delete('project-1', OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.PROJECT_ROLE_INSUFFICIENT,
      });
      expect(repository.softDelete).not.toHaveBeenCalled();
    });

    it('answers PROJECT_NOT_FOUND when the project was already deleted concurrently', async () => {
      repository.softDelete.mockResolvedValue(false);

      await expect(service.delete('project-1', OWNER_USER_ID)).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.PROJECT_NOT_FOUND,
      });
    });
  });
});
