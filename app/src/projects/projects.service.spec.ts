import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service.js';
import { ProjectsRepository } from './projects.repository.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Project } from '../generated/prisma/client.js';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repository: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
  };

  let workspaces: { personalRef: ReturnType<typeof vi.fn> };
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

  beforeEach(async () => {
    repository = { create: vi.fn(), findById: vi.fn(), findAll: vi.fn(), softDelete: vi.fn() };
    workspaces = { personalRef: vi.fn().mockResolvedValue(PERSONAL_WORKSPACE) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: ProjectsRepository, useValue: repository },
        { provide: WorkspacesService, useValue: workspaces },
      ],
    }).compile();

    service = module.get(ProjectsService);
  });

  describe('create', () => {
    it('trims the name, persists the owner and returns the serialized project', async () => {
      repository.create.mockResolvedValue(project);

      const result = await service.create({ name: '  demo  ' }, OWNER_USER_ID, GITHUB_USER_ID);

      expect(repository.create).toHaveBeenCalledWith('demo', OWNER_USER_ID);
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
      expect(repository.create).toHaveBeenCalledWith('demo', OWNER_USER_ID);
    });

    it.each(['4242', 'not-numeric'])(
      'answers 404 WORKSPACE_NOT_FOUND for workspaceId "%s" (an organization or a foreign account) and persists nothing',
      async (workspaceId) => {
        await expect(
          service.create({ name: 'demo', workspaceId }, OWNER_USER_ID, GITHUB_USER_ID),
        ).rejects.toMatchObject({ code: ErrorCode.WORKSPACE_NOT_FOUND, status: 404 });
        expect(repository.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('getById', () => {
    it('returns the serialized project when found for its owner', async () => {
      repository.findById.mockResolvedValue({ ...project, currentVersionId: 'version-1' });

      const result = await service.getById('project-1', OWNER_USER_ID, GITHUB_USER_ID);

      expect(repository.findById).toHaveBeenCalledWith('project-1', OWNER_USER_ID);
      expect(result.currentVersionId).toBe('version-1');
      expect(result.workspace).toEqual(PERSONAL_WORKSPACE);
      expect(result.role).toBe('ADMIN');
    });

    it('exposes the organization columns as the workspace of an organization project', async () => {
      repository.findById.mockResolvedValue({ ...project, githubOrgId: '42', githubOrgLogin: 'acme' });

      const result = await service.getById('project-1', OWNER_USER_ID, GITHUB_USER_ID);

      expect(result.workspace).toEqual({ kind: 'ORGANIZATION', id: '42', login: 'acme' });
    });

    it('does not look up the workspace when the project is not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getById('missing', OWNER_USER_ID, GITHUB_USER_ID)).rejects.toBeInstanceOf(AppException);
      expect(workspaces.personalRef).not.toHaveBeenCalled();
    });

    it('throws PROJECT_NOT_FOUND when the project does not exist or belongs to another owner', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.getById('missing', OWNER_USER_ID, GITHUB_USER_ID),
      ).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.PROJECT_NOT_FOUND,
      });
    });
  });

  describe('list (HU25)', () => {
    it('requests one extra row to detect a next page and strips it from the returned items', async () => {
      repository.findAll.mockResolvedValue([
        { ...project, id: 'project-3' },
        { ...project, id: 'project-2' },
        { ...project, id: 'project-1' },
      ]);

      const page = await service.list(2, undefined, OWNER_USER_ID, GITHUB_USER_ID);

      expect(repository.findAll).toHaveBeenCalledWith(2, OWNER_USER_ID, undefined);
      expect(page.items).toHaveLength(2);
      expect(page.items.map((item) => item.id)).toEqual(['project-3', 'project-2']);
      expect(page.nextCursor).toBe('project-2');
    });

    it('returns nextCursor null when there is no further page', async () => {
      repository.findAll.mockResolvedValue([project]);

      const page = await service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID);

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    it('passes the cursor through to the repository and applies the default limit', async () => {
      repository.findAll.mockResolvedValue([]);

      await service.list(undefined, 'project-5', OWNER_USER_ID, GITHUB_USER_ID);

      expect(repository.findAll).toHaveBeenCalledWith(20, OWNER_USER_ID, 'project-5');
    });

    it('serializes each item with its workspace and role, resolving the personal workspace once', async () => {
      repository.findAll.mockResolvedValue([{ ...project, id: 'project-2' }, project]);

      const page = await service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID);

      expect(page.items.map((item) => [item.workspace, item.role])).toEqual([
        [PERSONAL_WORKSPACE, 'ADMIN'],
        [PERSONAL_WORKSPACE, 'ADMIN'],
      ]);
      expect(workspaces.personalRef).toHaveBeenCalledTimes(1);
    });

    it('accepts the own numeric id as workspaceId (same result as omitting it)', async () => {
      repository.findAll.mockResolvedValue([project]);

      const page = await service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID, GITHUB_USER_ID);

      expect(page.items).toHaveLength(1);
    });

    it('answers 404 WORKSPACE_NOT_FOUND for the workspaceId of an organization, before reading any project', async () => {
      await expect(
        service.list(20, undefined, OWNER_USER_ID, GITHUB_USER_ID, '42'),
      ).rejects.toMatchObject({ code: ErrorCode.WORKSPACE_NOT_FOUND, status: 404 });
      expect(repository.findAll).not.toHaveBeenCalled();
    });
  });

  describe('delete (HU56)', () => {
    it('soft-deletes an owned project', async () => {
      repository.softDelete.mockResolvedValue(true);

      await expect(service.delete('project-1', OWNER_USER_ID)).resolves.toBeUndefined();
      expect(repository.softDelete).toHaveBeenCalledWith('project-1', OWNER_USER_ID);
    });

    it('answers PROJECT_NOT_FOUND for a missing, foreign or already deleted project', async () => {
      repository.softDelete.mockResolvedValue(false);

      await expect(service.delete('project-1', OWNER_USER_ID)).rejects.toMatchObject<Partial<AppException>>({
        code: ErrorCode.PROJECT_NOT_FOUND,
      });
    });
  });
});
