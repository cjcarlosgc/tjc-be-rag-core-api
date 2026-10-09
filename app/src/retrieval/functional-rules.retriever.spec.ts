import { describe, expect, it, vi } from 'vitest';
import { FunctionalRulesRetriever, functionalTargetRef } from './functional-rules.retriever.js';
import type { FunctionalKnowledgeRepository } from '../functional-knowledge/functional-knowledge.repository.js';
import type { FunctionalKnowledge } from '../generated/prisma/client.js';

function row(overrides: Partial<FunctionalKnowledge> = {}): FunctionalKnowledge {
  return {
    id: 'knowledge-1',
    projectId: 'project-1',
    scope: 'METHOD',
    targetRef: 'src/thing.ts::Thing.doIt',
    originalQuestion: '¿Qué hace?',
    originalAnswer: 'sí',
    normalizedRule: 'Devuelve true cuando el valor es válido.',
    source: 'HUMAN_ANSWER',
    status: 'ACTIVE',
    supersedesId: null,
    confirmedByUserId: 'user-2',
    confirmedRole: 'ADMIN',
    originHeadSha: 'head-sha',
    sourceRef: null,
    scenarioKind: 'EXPECTED_RESULT',
    scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as FunctionalKnowledge;
}

function setup(rows: FunctionalKnowledge[]) {
  const repository = {
    findActiveByTargetRef: vi.fn().mockResolvedValue(rows),
  };
  const retriever = new FunctionalRulesRetriever(repository as unknown as FunctionalKnowledgeRepository);

  return { retriever, repository };
}

describe('functionalTargetRef', () => {
  it('builds filePath::Class.method for METHOD targets', () => {
    expect(
      functionalTargetRef({ filePath: 'src/thing.ts', symbolName: 'Thing', methodName: 'doIt', targetType: 'METHOD' }),
    ).toBe('src/thing.ts::Thing.doIt');
  });

  it('builds filePath::name for FUNCTION targets', () => {
    expect(
      functionalTargetRef({ filePath: 'src/util.ts', symbolName: 'parse', methodName: null, targetType: 'FUNCTION' }),
    ).toBe('src/util.ts::parse');
  });
});

describe('FunctionalRulesRetriever (WI-CORE-021)', () => {
  it('queries ACTIVE rules by exact targetRef of the project and maps every field with provenance', async () => {
    const { retriever, repository } = setup([
      row(),
      row({
        id: 'knowledge-2',
        scope: 'METHOD',
        scenarioKey: 'BOUNDARY:bbbbbbbbbbbbbbbb',
        source: 'APPROVED_IMPORT',
        sourceRef: 'import-7',
        confirmedByUserId: null,
        confirmedRole: null,
        originHeadSha: null,
      }),
    ]);

    const rules = await retriever.retrieve('project-1', {
      filePath: 'src/thing.ts',
      symbolName: 'Thing',
      methodName: 'doIt',
      targetType: 'METHOD',
    });

    expect(repository.findActiveByTargetRef).toHaveBeenCalledWith('project-1', 'src/thing.ts::Thing.doIt');
    expect(rules).toEqual([
      {
        knowledgeId: 'knowledge-1',
        scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
        normalizedRule: 'Devuelve true cuando el valor es válido.',
        scope: 'METHOD',
        targetRef: 'src/thing.ts::Thing.doIt',
        source: 'HUMAN_ANSWER',
        provenance: {
          confirmedByUserId: 'user-2',
          confirmedRole: 'ADMIN',
          originHeadSha: 'head-sha',
          sourceRef: null,
        },
      },
      {
        knowledgeId: 'knowledge-2',
        scenarioKey: 'BOUNDARY:bbbbbbbbbbbbbbbb',
        normalizedRule: 'Devuelve true cuando el valor es válido.',
        scope: 'METHOD',
        targetRef: 'src/thing.ts::Thing.doIt',
        source: 'APPROVED_IMPORT',
        provenance: {
          confirmedByUserId: null,
          confirmedRole: null,
          originHeadSha: null,
          sourceRef: 'import-7',
        },
      },
    ]);
  });

  it('keeps the repository order (createdAt, id) and returns an empty list when nothing matches', async () => {
    const { retriever } = setup([]);

    await expect(
      retriever.retrieve('project-1', { filePath: 'src/a.ts', symbolName: 'a', methodName: null, targetType: 'FUNCTION' }),
    ).resolves.toEqual([]);
  });
});
