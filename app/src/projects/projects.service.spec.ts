import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsService } from './projects.service.js';
import { ProjectsRepository } from './projects.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Project } from '../generated/prisma/client.js';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repository: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
  };

  const project: Project = {
    id: 'project-1',
    name: 'demo',
    currentVersionId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    repository = { create: vi.fn(), findById: vi.fn(), findAll: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProjectsService, { provide: ProjectsRepository, useValue: repository }],
    }).compile();

    service = module.get(ProjectsService);
  });

  describe('create', () => {
    it('trims the name and returns the serialized project', async () => {
      repository.create.mockResolvedValue(project);

      const result = await service.create({ name: '  demo  ' });

      expect(repository.create).toHaveBeenCalledWith('demo');
      expect(result).toEqual({
        id: 'project-1',
        name: 'demo',
        currentVersionId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('getById', () => {
    it('returns the serialized project when found', async () => {
      repository.findById.mockResolvedValue({ ...project, currentVersionId: 'version-1' });

      const result = await service.getById('project-1');

      expect(result.currentVersionId).toBe('version-1');
    });

    it('throws PROJECT_NOT_FOUND when the project does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getById('missing')).rejects.toMatchObject<Partial<AppException>>({
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

      const page = await service.list(2, undefined);

      expect(repository.findAll).toHaveBeenCalledWith(2, undefined);
      expect(page.items).toHaveLength(2);
      expect(page.items.map((item) => item.id)).toEqual(['project-3', 'project-2']);
      expect(page.nextCursor).toBe('project-2');
    });

    it('returns nextCursor null when there is no further page', async () => {
      repository.findAll.mockResolvedValue([project]);

      const page = await service.list(20, undefined);

      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeNull();
    });

    it('passes the cursor through to the repository and applies the default limit', async () => {
      repository.findAll.mockResolvedValue([]);

      await service.list(undefined, 'project-5');

      expect(repository.findAll).toHaveBeenCalledWith(20, 'project-5');
    });
  });
});
