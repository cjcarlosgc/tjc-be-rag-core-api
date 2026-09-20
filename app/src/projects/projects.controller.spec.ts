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
});
