import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import type { RetrievalResult } from '../retrieval/retrieval.service.js';
import type { RetrievalTarget } from '../retrieval/generation-context.js';
import {
  InsufficientGenerationContextError,
  assessContextSufficiency,
} from './context-sufficiency.js';

const TARGET: RetrievalTarget = {
  filePath: 'src/thing.ts',
  symbolName: 'Thing',
  methodName: 'doIt',
  targetType: 'METHOD',
};

const RULE_KEY = 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa';
const OTHER_KEY = 'BOUNDARY:bbbbbbbbbbbbbbbb';

function chunk(id: string, content: string, tokenCount = 10) {
  return {
    id,
    filePath: 'src/thing.ts',
    symbolKind: 'METHOD',
    symbolName: 'Thing',
    parentSymbolName: null,
    startLine: 1,
    endLine: 3,
    content,
    tokenCount,
    projectVersionId: 'version-1',
    createdAt: new Date(0),
    importsUsed: [] as string[],
    partIndex: 1,
    partsTotal: 1,
  };
}

function candidate(id: string, semanticScore: number | null, structuralMatch: 'IMPORTS' | null = null) {
  return {
    chunk: { ...chunk(id, `${id}()`, 5), filePath: `src/${id}.ts`, symbolName: id },
    semanticScore,
    structuralMatch,
  };
}

/** Contexto real de `ContextBuilder` (no mocks), para cubrir la auditoría que produce el producto. */
function buildContext(
  result: RetrievalResult,
  options: { minimumScore?: number; topK?: number; maxContextTokens?: number } = {},
  rules: Array<{ knowledgeId: string; scenarioKey: string }> = [],
) {
  const builder = new ContextBuilder({ get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService);
  return builder.build(
    result,
    TARGET,
    { framework: 'JEST', language: 'typescript' },
    options,
    rules.map((rule) => ({
      ...rule,
      normalizedRule: 'Devuelve true.',
      scope: 'METHOD',
      targetRef: 'src/thing.ts::Thing.doIt',
      source: 'HUMAN_ANSWER',
      provenance: { confirmedByUserId: null, confirmedRole: null, originHeadSha: null, sourceRef: null },
    })) as never,
  );
}

const WITH_CODE: RetrievalResult = {
  targetChunks: [chunk('target-1', 'doIt() { return true; }')],
  candidates: [],
};

describe('assessContextSufficiency (WI-CORE-098, D-5)', () => {
  it('1. does not block when the target has code and no rule is required', () => {
    const context = buildContext({ ...WITH_CODE, candidates: [candidate('bar', 0.9)] });

    expect(
      assessContextSufficiency({ generationContext: context, retrievedRuleScenarioKeys: [], requiredScenarioKeys: [] }),
    ).toBeNull();
  });

  it('2. blocks TARGET_WITHOUT_CODE when the target content is empty or only spaces, even with candidates and rules', () => {
    for (const content of ['', '   \n\t ']) {
      const context = buildContext({
        targetChunks: [chunk('target-1', content)],
        candidates: [candidate('bar', 0.9)],
      });

      const error = assessContextSufficiency({
        generationContext: context,
        retrievedRuleScenarioKeys: [RULE_KEY],
        requiredScenarioKeys: [RULE_KEY],
      });

      expect(error).toBeInstanceOf(InsufficientGenerationContextError);
      expect(error?.reason).toBe('TARGET_WITHOUT_CODE');
      expect(error?.missingScenarioKeys).toEqual([]);
    }
  });

  it('3. does not block with no eligible candidate when no rule is required (clause b alone)', () => {
    const context = buildContext(WITH_CODE);

    expect(
      assessContextSufficiency({ generationContext: context, retrievedRuleScenarioKeys: [], requiredScenarioKeys: [] }),
    ).toBeNull();
  });

  it('4. does not block when a rule is missing but at least one candidate is eligible (clause c alone)', () => {
    const context = buildContext({ ...WITH_CODE, candidates: [candidate('bar', 0.9)] });

    expect(
      assessContextSufficiency({
        generationContext: context,
        retrievedRuleScenarioKeys: [],
        requiredScenarioKeys: [RULE_KEY],
      }),
    ).toBeNull();
  });

  it('5. blocks NO_RELEVANT_CANDIDATES_AND_MISSING_RULES with the missing keys when no candidate is eligible and a rule is missing', () => {
    const context = buildContext(WITH_CODE);

    const error = assessContextSufficiency({
      generationContext: context,
      retrievedRuleScenarioKeys: [],
      requiredScenarioKeys: [RULE_KEY],
    });

    expect(error).toBeInstanceOf(InsufficientGenerationContextError);
    expect(error?.reason).toBe('NO_RELEVANT_CANDIDATES_AND_MISSING_RULES');
    expect(error?.missingScenarioKeys).toEqual([RULE_KEY]);
    expect(error?.eligibleCandidates).toBe(0);
    expect(error?.message).toContain('Contexto insuficiente');
  });

  it('6. does not block with no eligible candidate when every required rule is retrieved', () => {
    const context = buildContext(WITH_CODE, {}, [{ knowledgeId: 'rule-1', scenarioKey: RULE_KEY }]);

    expect(
      assessContextSufficiency({
        generationContext: context,
        retrievedRuleScenarioKeys: [RULE_KEY],
        requiredScenarioKeys: [RULE_KEY],
      }),
    ).toBeNull();
  });

  it('7. with two required rules and one present, blocks only with no eligible candidate and reports the absent key', () => {
    const context = buildContext(WITH_CODE);
    const input = {
      generationContext: context,
      retrievedRuleScenarioKeys: [RULE_KEY],
      requiredScenarioKeys: [RULE_KEY, OTHER_KEY],
    };

    const error = assessContextSufficiency(input);
    expect(error?.missingScenarioKeys).toEqual([OTHER_KEY]);

    const withCandidate = buildContext({ ...WITH_CODE, candidates: [candidate('bar', 0.9)] });
    expect(assessContextSufficiency({ ...input, generationContext: withCandidate })).toBeNull();
  });

  it('8. candidates below the minimum do not count as eligible; at or above the minimum they do; TOP_K and budget discards still count', () => {
    const below = buildContext(
      { ...WITH_CODE, candidates: [candidate('low', 0.1)] },
      { minimumScore: 0.5 },
    );
    expect(below.audit?.candidates[0]?.discardReason).toBe('BELOW_MINIMUM_SCORE');
    expect(
      assessContextSufficiency({ generationContext: below, retrievedRuleScenarioKeys: [], requiredScenarioKeys: [RULE_KEY] })
        ?.eligibleCandidates,
    ).toBe(0);

    // score = 0.7 · semántico + 0.3 · estructural = 0.7 exacto: igual al mínimo, cuenta como elegible.
    const atMinimum = buildContext(
      { ...WITH_CODE, candidates: [candidate('edge', 1)] },
      { minimumScore: 0.7 },
    );
    expect(atMinimum.audit?.candidates[0]?.discardReason).toBeNull();
    expect(
      assessContextSufficiency({ generationContext: atMinimum, retrievedRuleScenarioKeys: [], requiredScenarioKeys: [RULE_KEY] }),
    ).toBeNull();

    // topK 0: el candidato supera el mínimo pero queda fuera por TOP_K_LIMIT; sigue contando como elegible.
    const topKOnly = buildContext(
      { ...WITH_CODE, candidates: [candidate('high', 1)] },
      { minimumScore: 0.5, topK: 0 },
    );
    expect(topKOnly.audit?.candidates[0]?.discardReason).toBe('TOP_K_LIMIT');
    expect(
      assessContextSufficiency({ generationContext: topKOnly, retrievedRuleScenarioKeys: [], requiredScenarioKeys: [RULE_KEY] }),
    ).toBeNull();
  });

  it('9. a rule that was retrieved but omitted by the token budget still counts as present', () => {
    const context = buildContext(
      { ...WITH_CODE, candidates: [] },
      { maxContextTokens: 1 },
      [{ knowledgeId: 'rule-1', scenarioKey: RULE_KEY }],
    );
    expect(context.functionalRules).toEqual([]);
    expect(context.audit?.functionalRules.omitted).toHaveLength(1);

    expect(
      assessContextSufficiency({
        generationContext: context,
        retrievedRuleScenarioKeys: [RULE_KEY],
        requiredScenarioKeys: [RULE_KEY],
      }),
    ).toBeNull();
  });

  it('10. the same decision for the SE context with semantic-only and with structural candidates', () => {
    const semanticOnly = buildContext({ ...WITH_CODE, candidates: [candidate('bar', 0.9, null)] });
    const withStructural = buildContext({ ...WITH_CODE, candidates: [candidate('bar', 0.9, 'IMPORTS')] });
    const input = { retrievedRuleScenarioKeys: [], requiredScenarioKeys: [RULE_KEY] };

    expect(assessContextSufficiency({ ...input, generationContext: semanticOnly })).toBeNull();
    expect(assessContextSufficiency({ ...input, generationContext: withStructural })).toBeNull();
  });

  it('does not expose code or user keys in the error message', () => {
    const context = buildContext(WITH_CODE);
    const error = assessContextSufficiency({
      generationContext: context,
      retrievedRuleScenarioKeys: [],
      requiredScenarioKeys: [RULE_KEY],
    });

    expect(error?.message).not.toContain('doIt');
    expect(error?.message).not.toContain('return true');
    expect(error?.message).not.toContain(RULE_KEY);
  });
});
