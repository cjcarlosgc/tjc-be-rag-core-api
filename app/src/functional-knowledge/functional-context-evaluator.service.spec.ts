import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';
import { AnalysisSymbolsRepository } from '../analysis-runs/persistence/analysis-symbols.repository.js';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import { FunctionalKnowledgeRepository } from './functional-knowledge.repository.js';
import type { AnalysisRun, AnalysisSymbol, FunctionalQuestion } from '../generated/prisma/client.js';

const RUN = { id: 'run-1', projectId: 'project-1' } as AnalysisRun;

function buildSymbol(overrides: Partial<AnalysisSymbol> = {}): AnalysisSymbol {
  return {
    id: 'symbol-1',
    analysisRunId: 'run-1',
    language: 'TYPESCRIPT',
    kind: 'METHOD',
    qualifiedName: 'Thing.doIt',
    filePath: 'src/thing.ts',
    changeKind: 'DIRECTLY_CHANGED',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('FunctionalContextEvaluatorService', () => {
  let service: FunctionalContextEvaluatorService;
  let analysisSymbolsRepository: { findByAnalysisRun: ReturnType<typeof vi.fn> };
  let functionalQuestionsRepository: {
    findByAnalysisRun: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let functionalKnowledgeRepository: { findActive: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    analysisSymbolsRepository = { findByAnalysisRun: vi.fn().mockResolvedValue([]) };
    functionalQuestionsRepository = {
      findByAnalysisRun: vi.fn().mockResolvedValue([] as FunctionalQuestion[]),
      create: vi.fn(),
    };
    functionalKnowledgeRepository = { findActive: vi.fn().mockResolvedValue(null) };
    service = new FunctionalContextEvaluatorService(
      analysisSymbolsRepository as unknown as AnalysisSymbolsRepository,
      functionalQuestionsRepository as unknown as FunctionalQuestionsRepository,
      functionalKnowledgeRepository as unknown as FunctionalKnowledgeRepository,
    );
  });

  it('returns actionRequired=false when there are no DIRECTLY_CHANGED METHOD/FUNCTION symbols', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ kind: 'CLASS' }),
      buildSymbol({ changeKind: 'POTENTIALLY_IMPACTED' }),
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: false });
    expect(functionalQuestionsRepository.create).not.toHaveBeenCalled();
  });

  it('creates one question and stops at the first uncovered symbol', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ qualifiedName: 'Thing.first' }),
      buildSymbol({ qualifiedName: 'Thing.second' }),
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: true });
    expect(functionalQuestionsRepository.create).toHaveBeenCalledTimes(1);
    expect(functionalQuestionsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ analysisRunId: 'run-1', projectId: 'project-1', qualifiedName: 'Thing.first' }),
    );
  });

  it('does not create a question for a symbol already covered by ACTIVE knowledge', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([buildSymbol()]);
    functionalKnowledgeRepository.findActive.mockResolvedValue({ id: 'knowledge-1' });

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: false });
    expect(functionalQuestionsRepository.create).not.toHaveBeenCalled();
  });

  it('does not create a question for a symbol that already has a tracked (non-obsolete) question', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([buildSymbol()]);
    functionalQuestionsRepository.findByAnalysisRun.mockResolvedValue([
      { filePath: 'src/thing.ts', qualifiedName: 'Thing.doIt', status: 'ANSWERED' } as FunctionalQuestion,
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: false });
    expect(functionalQuestionsRepository.create).not.toHaveBeenCalled();
  });

  it('re-considers a symbol whose previous question is OBSOLETE', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([buildSymbol()]);
    functionalQuestionsRepository.findByAnalysisRun.mockResolvedValue([
      { filePath: 'src/thing.ts', qualifiedName: 'Thing.doIt', status: 'OBSOLETE' } as FunctionalQuestion,
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: true });
    expect(functionalQuestionsRepository.create).toHaveBeenCalledTimes(1);
  });

  it('uses SYMBOL scope (not METHOD) for a FUNCTION kind symbol', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ kind: 'FUNCTION', qualifiedName: 'standaloneFn' }),
    ]);

    await service.evaluate(RUN);

    expect(functionalKnowledgeRepository.findActive).toHaveBeenCalledWith(
      'project-1',
      'SYMBOL',
      'src/thing.ts::standaloneFn',
    );
  });
});
