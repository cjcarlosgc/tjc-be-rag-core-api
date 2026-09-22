import { describe, expect, it, vi } from 'vitest';
import { WorkspacesController } from './workspaces.controller.js';
import type { WorkspacesService } from './workspaces.service.js';

describe('WorkspacesController', () => {
  it('GET /workspaces delegates with the session user and GitHub identity', async () => {
    const service = { list: vi.fn().mockResolvedValue({ items: [] }) };
    const controller = new WorkspacesController(service as unknown as WorkspacesService);

    await expect(controller.list('sub-1', '1001')).resolves.toEqual({ items: [] });
    expect(service.list).toHaveBeenCalledWith('sub-1', '1001');
  });
});
