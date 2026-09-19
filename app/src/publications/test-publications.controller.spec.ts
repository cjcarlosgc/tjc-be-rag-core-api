import { describe, expect, it, vi } from 'vitest';
import { TestPublicationsController } from './test-publications.controller.js';
import { TestPublicationsService } from './test-publications.service.js';

describe('TestPublicationsController', () => {
  function setup() {
    const service = { create: vi.fn(), getById: vi.fn() };
    const controller = new TestPublicationsController(service as unknown as TestPublicationsService);
    return { controller, service };
  }

  it('create forwards analysisRunId, proposalIds and userId', async () => {
    const { controller, service } = setup();
    await controller.create('run-1', { proposalIds: ['p1', 'p2'] }, 'user-1');
    expect(service.create).toHaveBeenCalledWith('run-1', ['p1', 'p2'], 'user-1');
  });

  it('getById forwards publicationId and userId', async () => {
    const { controller, service } = setup();
    await controller.getById('publication-1', 'user-1');
    expect(service.getById).toHaveBeenCalledWith('publication-1', 'user-1');
  });
});
