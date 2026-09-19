import { describe, expect, it, vi } from 'vitest';
import { FunctionalKnowledgeController } from './functional-knowledge.controller.js';
import { FunctionalKnowledgeService } from './functional-knowledge.service.js';

describe('FunctionalKnowledgeController', () => {
  function setup() {
    const service = {
      listActionRequired: vi.fn(),
      getQuestionSet: vi.fn(),
      submitAnswer: vi.fn(),
      listKnowledge: vi.fn(),
    };
    const controller = new FunctionalKnowledgeController(service as unknown as FunctionalKnowledgeService);
    return { controller, service };
  }

  it('listActionRequired forwards query and userId', async () => {
    const { controller, service } = setup();
    await controller.listActionRequired({ projectId: 'project-1', cursor: 'c', limit: 5 }, 'user-1');
    expect(service.listActionRequired).toHaveBeenCalledWith('user-1', 'project-1', 'c', 5);
  });

  it('getQuestionSet forwards analysisRunId and userId', async () => {
    const { controller, service } = setup();
    await controller.getQuestionSet('run-1', 'user-1');
    expect(service.getQuestionSet).toHaveBeenCalledWith('run-1', 'user-1');
  });

  it('submitAnswer forwards all params', async () => {
    const { controller, service } = setup();
    const body = { choice: 'YES' as const };
    await controller.submitAnswer('run-1', 'question-1', body, 'user-1');
    expect(service.submitAnswer).toHaveBeenCalledWith('run-1', 'question-1', body, 'user-1');
  });

  it('listKnowledge forwards projectId, query and userId', async () => {
    const { controller, service } = setup();
    await controller.listKnowledge('project-1', { status: 'ACTIVE', cursor: 'c', limit: 5 }, 'user-1');
    expect(service.listKnowledge).toHaveBeenCalledWith('project-1', 'ACTIVE', 'c', 5, 'user-1');
  });
});
