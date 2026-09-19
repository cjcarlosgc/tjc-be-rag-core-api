import { describe, expect, it, vi } from 'vitest';
import { AnalysisRunValidationController } from './analysis-run-validation.controller.js';
import { AnalysisRunsService } from '../analysis-runs/analysis-runs.service.js';
import { GeneratedTestProposalsRepository } from './generated-test-proposals.repository.js';
import type { AnalysisRun, GeneratedTestProposal } from '../generated/prisma/client.js';

describe('AnalysisRunValidationController', () => {
  function setup() {
    const analysisRunsService = { getById: vi.fn() };
    const generatedTestProposalsRepository = { findByAnalysisRun: vi.fn() };
    const controller = new AnalysisRunValidationController(
      analysisRunsService as unknown as AnalysisRunsService,
      generatedTestProposalsRepository as unknown as GeneratedTestProposalsRepository,
    );
    return { controller, analysisRunsService, generatedTestProposalsRepository };
  }

  it('returns the proposal set for the owner-scoped run', async () => {
    const { controller, analysisRunsService, generatedTestProposalsRepository } = setup();
    analysisRunsService.getById.mockResolvedValue({ id: 'run-1', headSha: 'head-sha' } as AnalysisRun);
    generatedTestProposalsRepository.findByAnalysisRun.mockResolvedValue([
      {
        id: 'proposal-1',
        relativePath: 'src/thing.spec.ts',
        symbolLanguage: 'TYPESCRIPT',
        symbolKind: 'METHOD',
        qualifiedName: 'Thing.doIt',
        filePath: 'src/thing.ts',
        contentSha256: 'abc',
        status: 'AVAILABLE',
      } as GeneratedTestProposal,
    ]);

    const result = await controller.listProposals('run-1', 'user-1');

    expect(analysisRunsService.getById).toHaveBeenCalledWith('run-1', 'user-1');
    expect(result).toEqual({
      analysisRunId: 'run-1',
      headSha: 'head-sha',
      items: [
        {
          id: 'proposal-1',
          relativePath: 'src/thing.spec.ts',
          target: {
            language: 'TYPESCRIPT',
            kind: 'METHOD',
            qualifiedName: 'Thing.doIt',
            filePath: 'src/thing.ts',
            changeKind: 'DIRECTLY_CHANGED',
          },
          contentSha256: 'abc',
          status: 'AVAILABLE',
        },
      ],
    });
  });
});
