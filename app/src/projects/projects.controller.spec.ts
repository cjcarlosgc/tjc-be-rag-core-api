import { describe, expect, it, vi } from 'vitest';
import { ProjectsController } from './projects.controller.js';
import type { ProjectsService } from './projects.service.js';

describe('ProjectsController', () => {
  it('DELETE /projects/:id delegates the logical delete with the authenticated owner', async () => {
    const projectsService = { delete: vi.fn().mockResolvedValue(undefined) };
    const controller = new ProjectsController(projectsService as unknown as ProjectsService);

    await expect(controller.remove('project-1', 'user-1')).resolves.toBeUndefined();
    expect(projectsService.delete).toHaveBeenCalledWith('project-1', 'user-1');
  });

  it('POST /projects, GET /projects and GET /projects/:id pass the session GitHub identity and the workspaceId to the service', async () => {
    const projectsService = {
      create: vi.fn().mockResolvedValue('created'),
      list: vi.fn().mockResolvedValue('page'),
      getById: vi.fn().mockResolvedValue('one'),
    };
    const controller = new ProjectsController(projectsService as unknown as ProjectsService);

    await expect(controller.create({ name: 'demo', workspaceId: '1001' }, 'user-1', '1001')).resolves.toBe('created');
    expect(projectsService.create).toHaveBeenCalledWith({ name: 'demo', workspaceId: '1001' }, 'user-1', '1001');

    await expect(controller.list({ limit: 5, cursor: 'c', workspaceId: '1001' }, 'user-1', '1001')).resolves.toBe('page');
    expect(projectsService.list).toHaveBeenCalledWith(5, 'c', 'user-1', '1001', '1001');

    await expect(controller.getById('project-1', 'user-1', '1001')).resolves.toBe('one');
    expect(projectsService.getById).toHaveBeenCalledWith('project-1', 'user-1', '1001');
  });

  it('PATCH /projects/:id delegates the rename with the session identity', async () => {
    const projectsService = { update: vi.fn().mockResolvedValue('renamed') };
    const controller = new ProjectsController(projectsService as unknown as ProjectsService);

    await expect(controller.update('project-1', { name: 'new' }, 'user-1', '1001')).resolves.toBe('renamed');
    expect(projectsService.update).toHaveBeenCalledWith('project-1', { name: 'new' }, 'user-1', '1001');
  });
});
