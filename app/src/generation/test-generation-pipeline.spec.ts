import { describe, expect, it, vi } from 'vitest';
import { acquireGenerationContext } from './test-generation-pipeline.js';
import { InsufficientGenerationContextError } from './context-sufficiency.js';

const TARGET = {
  filePath: 'src/thing.ts',
  symbolName: 'Thing',
  methodName: 'doIt',
  targetType: 'METHOD' as const,
};

function makeSources(content: string, candidates: unknown[] = []) {
  const generationContext = {
    target: { ...TARGET, content },
    relatedChunks: [],
    functionalRules: [],
    metadata: { language: 'typescript', framework: 'JEST' },
    retrievedChunks: candidates.length,
    selectedChunks: 0,
    contextTokens: 0,
    audit: {
      functionalRules: { retrieved: 0, selected: 0, tokenCount: 0, omitted: [] },
      target: { chunkIds: [], chunks: [], tokenCount: 0 },
      candidates: candidates.map((entry) => ({ ...(entry as object), discardReason: null })),
      configuration: { minimumScore: 0, topK: 10, maxContextTokens: 1000, semanticWeight: 0.7, structuralWeight: 0.3 },
    },
  };
  return {
    retrievalService: { retrieve: vi.fn().mockResolvedValue({ targetChunks: [{ id: 't' }], candidates }) },
    functionalRulesRetriever: {
      retrieve: vi.fn().mockResolvedValue([
        {
          knowledgeId: 'rule-1',
          scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
          normalizedRule: 'x',
          scope: 'METHOD',
          targetRef: 'src/thing.ts::Thing.doIt',
          source: 'HUMAN_ANSWER',
          provenance: { confirmedByUserId: null, confirmedRole: null, originHeadSha: null, sourceRef: null },
        },
      ]),
    },
    phpDependencyContextService: { resolve: vi.fn().mockResolvedValue(null) },
    contextBuilder: { build: vi.fn().mockReturnValue(generationContext) },
  };
}

const INPUT = {
  projectId: 'project-1',
  projectVersionId: 'version-1',
  retrievalTarget: TARGET,
  framework: 'JEST' as const,
  language: 'typescript' as const,
  contextOptions: {},
};

describe('acquireGenerationContext sufficiency gate (WI-CORE-098)', () => {
  it('without the sufficiency option, returns the context even when the target has no code (unchanged behavior)', async () => {
    const sources = makeSources('');

    const result = await acquireGenerationContext(sources as never, INPUT);

    expect(result.generationContext.target.content).toBe('');
    expect(result.retrieval).toBeDefined();
  });

  it('without the sufficiency option, returns the context with no candidates and a required rule missing', async () => {
    const sources = makeSources('doIt() {}');

    const result = await acquireGenerationContext(sources as never, INPUT);

    expect(result.generationContext).toBeDefined();
  });

  it('with the sufficiency option, throws InsufficientGenerationContextError and returns no context when the gate blocks', async () => {
    const sources = makeSources('doIt() {}');

    const attempt = acquireGenerationContext(sources as never, {
      ...INPUT,
      sufficiency: { requiredScenarioKeys: ['BOUNDARY:bbbbbbbbbbbbbbbb'] },
    });

    await expect(attempt).rejects.toBeInstanceOf(InsufficientGenerationContextError);
    await expect(attempt).rejects.toMatchObject({
      reason: 'NO_RELEVANT_CANDIDATES_AND_MISSING_RULES',
      missingScenarioKeys: ['BOUNDARY:bbbbbbbbbbbbbbbb'],
    });
  });

  it('with the sufficiency option, returns the context when the gate does not block', async () => {
    const sources = makeSources('doIt() {}', [{ chunk: { id: 'c1' }, semanticScore: 0.9, structuralMatch: null }]);

    const result = await acquireGenerationContext(sources as never, {
      ...INPUT,
      sufficiency: { requiredScenarioKeys: ['BOUNDARY:bbbbbbbbbbbbbbbb'] },
    });

    expect(result.generationContext.target.content).toBe('doIt() {}');
  });

  it('with the sufficiency option and a required rule that is retrieved, does not block without candidates', async () => {
    const sources = makeSources('doIt() {}');

    const result = await acquireGenerationContext(sources as never, {
      ...INPUT,
      sufficiency: { requiredScenarioKeys: ['EXPECTED_RESULT:aaaaaaaaaaaaaaaa'] },
    });

    expect(result.generationContext).toBeDefined();
  });
});
