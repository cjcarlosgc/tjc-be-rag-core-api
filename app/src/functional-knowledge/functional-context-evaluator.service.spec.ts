import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionalContextEvaluatorService } from './functional-context-evaluator.service.js';
import { AnalysisSymbolsRepository } from '../analysis-runs/persistence/analysis-symbols.repository.js';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import { FunctionalKnowledgeRepository } from './functional-knowledge.repository.js';
import type { AnalysisRun, AnalysisSymbol, FunctionalQuestion } from '../generated/prisma/client.js';

const RUN = { id: 'run-1', projectId: 'project-1', status: 'PROCESSING', current: true } as AnalysisRun;

function buildSymbol(overrides: Partial<AnalysisSymbol> = {}): AnalysisSymbol {
  return {
    id: 'symbol-1',
    analysisRunId: 'run-1',
    language: 'TYPESCRIPT',
    kind: 'METHOD',
    qualifiedName: 'Thing.doIt',
    filePath: 'src/thing.ts',
    changeKind: 'DIRECTLY_CHANGED',
    behaviorConstructs: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function buildConstruct(overrides: Record<string, unknown> = {}) {
  return {
    scenarioKind: 'EXPECTED_RESULT',
    scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    order: 0,
    snippet: 'if (amount <= 0)',
    ...overrides,
  };
}

function buildQuestion(overrides: Partial<FunctionalQuestion> = {}): FunctionalQuestion {
  return {
    filePath: 'src/thing.ts',
    qualifiedName: 'Thing.doIt',
    status: 'ANSWERED',
    scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    ...overrides,
  } as FunctionalQuestion;
}

describe('FunctionalContextEvaluatorService', () => {
  let service: FunctionalContextEvaluatorService;
  let analysisSymbolsRepository: { findByAnalysisRun: ReturnType<typeof vi.fn> };
  let functionalQuestionsRepository: {
    findByAnalysisRun: ReturnType<typeof vi.fn>;
    createForCurrentRun: ReturnType<typeof vi.fn>;
  };
  let functionalKnowledgeRepository: { findActive: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    analysisSymbolsRepository = { findByAnalysisRun: vi.fn().mockResolvedValue([]) };
    functionalQuestionsRepository = {
      findByAnalysisRun: vi.fn().mockResolvedValue([] as FunctionalQuestion[]),
      createForCurrentRun: vi.fn().mockResolvedValue({
        question: {} as FunctionalQuestion,
        analysisRun: { ...RUN, status: 'ACTION_REQUIRED' },
      }),
    };
    functionalKnowledgeRepository = { findActive: vi.fn().mockResolvedValue(null) };
    service = new FunctionalContextEvaluatorService(
      analysisSymbolsRepository as unknown as AnalysisSymbolsRepository,
      functionalQuestionsRepository as unknown as FunctionalQuestionsRepository,
      functionalKnowledgeRepository as unknown as FunctionalKnowledgeRepository,
    );
  });

  it('returns actionRequired=false when no DIRECTLY_CHANGED METHOD/FUNCTION TypeScript symbol has constructs', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ kind: 'CLASS', behaviorConstructs: [buildConstruct()] }),
      buildSymbol({ changeKind: 'POTENTIALLY_IMPACTED', behaviorConstructs: [buildConstruct()] }),
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: false });
    expect(functionalQuestionsRepository.createForCurrentRun).not.toHaveBeenCalled();
  });

  it.each([
    ['EXPECTED_RESULT', 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa'],
    ['BOUNDARY', 'BOUNDARY:bbbbbbbbbbbbbbbb'],
    ['EXCEPTION', 'EXCEPTION:cccccccccccccccc'],
    ['STATE_TRANSITION', 'STATE_TRANSITION:dddddddddddddddd'],
  ])('creates a question persisting scenarioKind and scenarioKey for %s', async (scenarioKind, scenarioKey) => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ behaviorConstructs: [buildConstruct({ scenarioKind, scenarioKey })] }),
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: true, analysisRun: { ...RUN, status: 'ACTION_REQUIRED' } });
    expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisRunId: 'run-1',
        projectId: 'project-1',
        symbolLanguage: 'TYPESCRIPT',
        symbolKind: 'METHOD',
        qualifiedName: 'Thing.doIt',
        filePath: 'src/thing.ts',
        scenarioKind,
        scenarioKey,
      }),
      'PROCESSING',
    );
  });

  it('mentions the symbol, the file and the construct snippet in the templated question', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({
        behaviorConstructs: [buildConstruct({ scenarioKind: 'EXCEPTION', snippet: 'throw new Error("invalid")' })],
      }),
    ]);

    await service.evaluate(RUN);

    const input = functionalQuestionsRepository.createForCurrentRun.mock.calls[0]?.[0] as { question: string; rationale: string };
    expect(input.question).toContain('"Thing.doIt" (src/thing.ts)');
    expect(input.question).toContain('throw new Error("invalid")');
    expect(input.rationale).toContain('EXCEPTION');
  });

  it.each([
    ['null', null],
    ['an empty list', []],
    ['a malformed entry only', [{ scenarioKind: 'OBSERVABLE_SIDE_EFFECT', scenarioKey: 'x', order: 0, snippet: 'x' }]],
  ])('does not ask and lets the run continue when behaviorConstructs is %s', async (_label, behaviorConstructs) => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([buildSymbol({ behaviorConstructs })]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: false });
    expect(functionalQuestionsRepository.createForCurrentRun).not.toHaveBeenCalled();
  });

  it('does not ask when an ACTIVE rule applies to the target', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ behaviorConstructs: [buildConstruct()] }),
    ]);
    functionalKnowledgeRepository.findActive.mockResolvedValue({ id: 'knowledge-1' });

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: false });
    expect(functionalKnowledgeRepository.findActive).toHaveBeenCalledWith(
      'project-1',
      'METHOD',
      'src/thing.ts::Thing.doIt',
      'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    );
    expect(functionalQuestionsRepository.createForCurrentRun).not.toHaveBeenCalled();
  });

  it('does not duplicate a non-obsolete question that already has the same scenarioKey', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ behaviorConstructs: [buildConstruct({ scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa' })] }),
    ]);
    functionalQuestionsRepository.findByAnalysisRun.mockResolvedValue([
      buildQuestion({ scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa', status: 'PENDING' }),
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: false });
    expect(functionalQuestionsRepository.createForCurrentRun).not.toHaveBeenCalled();
  });

  it('asks about a construct with a different scenarioKey than the tracked question of the same target', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({
        behaviorConstructs: [
          buildConstruct({ scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa', order: 0 }),
          buildConstruct({ scenarioKind: 'EXCEPTION', scenarioKey: 'EXCEPTION:bbbbbbbbbbbbbbbb', order: 1 }),
        ],
      }),
    ]);
    functionalQuestionsRepository.findByAnalysisRun.mockResolvedValue([
      buildQuestion({ scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa' }),
    ]);

    await service.evaluate(RUN);

    expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledTimes(1);
    expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioKind: 'EXCEPTION', scenarioKey: 'EXCEPTION:bbbbbbbbbbbbbbbb' }),
      'PROCESSING',
    );
  });

  it('treats a historical question without scenarioKey as covering the whole target', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ behaviorConstructs: [buildConstruct({ scenarioKey: 'BOUNDARY:eeeeeeeeeeeeeeee', scenarioKind: 'BOUNDARY' })] }),
    ]);
    functionalQuestionsRepository.findByAnalysisRun.mockResolvedValue([buildQuestion({ scenarioKey: null })]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: false });
    expect(functionalQuestionsRepository.createForCurrentRun).not.toHaveBeenCalled();
  });

  it('re-considers a construct whose previous question is OBSOLETE', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ behaviorConstructs: [buildConstruct()] }),
    ]);
    functionalQuestionsRepository.findByAnalysisRun.mockResolvedValue([
      buildQuestion({ status: 'OBSOLETE' }),
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: true, analysisRun: { ...RUN, status: 'ACTION_REQUIRED' } });
    expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledTimes(1);
  });

  it('asks one question at a time in stable order: file, qualifiedName, then construct order', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({
        qualifiedName: 'Thing.second',
        filePath: 'src/z.ts',
        behaviorConstructs: [buildConstruct({ scenarioKey: 'EXPECTED_RESULT:zzzzzzzzzzzzzzzz' })],
      }),
      buildSymbol({
        qualifiedName: 'Thing.first',
        filePath: 'src/a.ts',
        behaviorConstructs: [
          buildConstruct({ scenarioKind: 'BOUNDARY', scenarioKey: 'BOUNDARY:2222222222222222', order: 1 }),
          buildConstruct({ scenarioKey: 'EXPECTED_RESULT:1111111111111111', order: 0 }),
        ],
      }),
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: true, analysisRun: { ...RUN, status: 'ACTION_REQUIRED' } });
    expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledTimes(1);
    expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        qualifiedName: 'Thing.first',
        filePath: 'src/a.ts',
        scenarioKey: 'EXPECTED_RESULT:1111111111111111',
      }),
      'PROCESSING',
    );
  });

  it('uses SYMBOL scope (not METHOD) for a FUNCTION kind symbol', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ kind: 'FUNCTION', qualifiedName: 'standaloneFn', behaviorConstructs: [buildConstruct()] }),
    ]);

    await service.evaluate(RUN);

    expect(functionalKnowledgeRepository.findActive).toHaveBeenCalledWith(
      'project-1',
      'SYMBOL',
      'src/thing.ts::standaloneFn',
      'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    );
  });

  it('asks about a PHP DIRECTLY_CHANGED METHOD with constructs and no ACTIVE rule (WI-CORE-032)', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({
        language: 'PHP',
        qualifiedName: 'App\\Billing\\Account.withdraw',
        filePath: 'src/Billing/Account.php',
        behaviorConstructs: [buildConstruct({ scenarioKind: 'BOUNDARY', scenarioKey: 'BOUNDARY:bbbbbbbbbbbbbbbb' })],
      }),
    ]);

    const result = await service.evaluate(RUN);

    expect(result).toEqual({ actionRequired: true, analysisRun: { ...RUN, status: 'ACTION_REQUIRED' } });
    expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        symbolLanguage: 'PHP',
        qualifiedName: 'App\\Billing\\Account.withdraw',
        filePath: 'src/Billing/Account.php',
        scenarioKind: 'BOUNDARY',
        scenarioKey: 'BOUNDARY:bbbbbbbbbbbbbbbb',
      }),
      'PROCESSING',
    );
  });

  it('does not report ACTION_REQUIRED when the run became obsolete before the atomic write', async () => {
    analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
      buildSymbol({ behaviorConstructs: [buildConstruct()] }),
    ]);
    functionalQuestionsRepository.createForCurrentRun.mockResolvedValue(null);

    await expect(service.evaluate(RUN)).resolves.toEqual({ actionRequired: false });
  });

  describe('aplicabilidad por scenarioKey (WI-CORE-020)', () => {
    const KEY_A = 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa';
    const KEY_B = 'EXCEPTION:bbbbbbbbbbbbbbbb';

    /** Simula el índice ACTIVE: una regla solo aplica a la clave exacta que la originó. */
    function activeOnlyForKey(keys: string[]) {
      functionalKnowledgeRepository.findActive.mockImplementation(
        (_projectId: string, _scope: string, _targetRef: string, scenarioKey: string) =>
          Promise.resolve(keys.includes(scenarioKey) ? { id: `knowledge-${scenarioKey}` } : null),
      );
    }

    it('a LEGACY rule does not cover a construct with a real scenarioKey: the evaluator still asks', async () => {
      analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
        buildSymbol({ behaviorConstructs: [buildConstruct({ scenarioKey: KEY_A })] }),
      ]);
      activeOnlyForKey(['LEGACY']);

      const result = await service.evaluate(RUN);

      expect(functionalKnowledgeRepository.findActive).toHaveBeenCalledWith(
        'project-1',
        'METHOD',
        'src/thing.ts::Thing.doIt',
        KEY_A,
      );
      expect(result).toEqual({ actionRequired: true, analysisRun: { ...RUN, status: 'ACTION_REQUIRED' } });
      expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioKey: KEY_A }),
        'PROCESSING',
      );
    });

    it('a rule for one key does not hide an uncovered construct of another key in the same target', async () => {
      analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
        buildSymbol({
          behaviorConstructs: [
            buildConstruct({ scenarioKey: KEY_A, order: 0 }),
            buildConstruct({ scenarioKind: 'EXCEPTION', scenarioKey: KEY_B, order: 1 }),
          ],
        }),
      ]);
      activeOnlyForKey([KEY_A]);

      const result = await service.evaluate(RUN);

      expect(result).toEqual({ actionRequired: true, analysisRun: { ...RUN, status: 'ACTION_REQUIRED' } });
      expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledTimes(1);
      expect(functionalQuestionsRepository.createForCurrentRun).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioKind: 'EXCEPTION', scenarioKey: KEY_B }),
        'PROCESSING',
      );
    });

    it('does not ask when every construct of the target has an ACTIVE rule with its own key', async () => {
      analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
        buildSymbol({
          behaviorConstructs: [
            buildConstruct({ scenarioKey: KEY_A, order: 0 }),
            buildConstruct({ scenarioKind: 'EXCEPTION', scenarioKey: KEY_B, order: 1 }),
          ],
        }),
      ]);
      activeOnlyForKey([KEY_A, KEY_B]);

      const result = await service.evaluate(RUN);

      expect(result).toEqual({ actionRequired: false });
      expect(functionalQuestionsRepository.createForCurrentRun).not.toHaveBeenCalled();
    });

    it('the question inherits the scenario of the construct, deterministically across evaluations', async () => {
      analysisSymbolsRepository.findByAnalysisRun.mockResolvedValue([
        buildSymbol({
          behaviorConstructs: [buildConstruct({ scenarioKind: 'BOUNDARY', scenarioKey: 'BOUNDARY:cccccccccccccccc' })],
        }),
      ]);
      activeOnlyForKey([]);

      await service.evaluate(RUN);
      await service.evaluate(RUN);

      const calls = functionalQuestionsRepository.createForCurrentRun.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toMatchObject({ scenarioKind: 'BOUNDARY', scenarioKey: 'BOUNDARY:cccccccccccccccc' });
      expect(calls[1][0]).toMatchObject({ scenarioKind: 'BOUNDARY', scenarioKey: 'BOUNDARY:cccccccccccccccc' });
    });
  });
});
