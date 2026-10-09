import { describe, expect, it } from 'vitest';
import { PromptBuilder } from './prompt-builder.service.js';
import type { GenerationContext } from '../retrieval/generation-context.js';

function makeContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    target: {
      filePath: 'src/foo.ts',
      symbolName: 'Foo',
      methodName: 'bar',
      targetType: 'METHOD',
      content: 'bar(): number { return 1; }',
    },
    relatedChunks: [],
    functionalRules: [],
    metadata: { language: 'typescript', framework: 'VITEST' },
    retrievedChunks: 0,
    selectedChunks: 0,
    contextTokens: 10,
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  it('includes the target label, file, code and framework', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(makeContext());

    expect(prompt).toContain('Foo.bar');
    expect(prompt).toContain('src/foo.ts');
    expect(prompt).toContain('bar(): number { return 1; }');
    expect(prompt).toContain('VITEST');
    expect(prompt).not.toContain('```\n\n```');
  });

  it('uses the function label for FUNCTION targets without a methodName', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(
      makeContext({
        target: {
          filePath: 'src/util.ts',
          symbolName: 'add',
          methodName: null,
          targetType: 'FUNCTION',
          content: 'function add() {}',
        },
      }),
    );

    expect(prompt).toContain('la función "add"');
  });

  it('includes related chunks labeled with their file and symbol', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(
      makeContext({
        relatedChunks: [
          {
            filePath: 'src/helper.ts',
            symbolKind: 'FUNCTION',
            symbolName: 'help',
            parentSymbolName: null,
            content: 'function help() {}',
            score: 0.9,
            matchedVia: ['SEMANTIC'],
          },
        ],
      }),
    );

    expect(prompt).toContain('src/helper.ts');
    expect(prompt).toContain('function help() {}');
  });

  it('falls back to a framework-agnostic instruction when framework is null', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(makeContext({ metadata: { language: 'typescript', framework: null } }));

    expect(prompt).toContain('Jest o Vitest');
  });

  it('presents functional rules in their own block after the code and before the related context', () => {
    const builder = new PromptBuilder();
    const prompt = builder.build(
      makeContext({
        relatedChunks: [
          {
            filePath: 'src/other.ts',
            symbolKind: 'FUNCTION',
            symbolName: 'other',
            parentSymbolName: null,
            content: 'function other() {}',
            score: 0.8,
            matchedVia: ['SEMANTIC'],
          },
        ],
        functionalRules: [
          {
            knowledgeId: 'rule-1',
            scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
            normalizedRule: 'Devuelve 1 siempre.',
            scope: 'METHOD',
            targetRef: 'src/foo.ts::Foo.bar',
            source: 'HUMAN_ANSWER',
            provenance: {
              confirmedByUserId: 'user-secret',
              confirmedRole: 'ADMIN',
              originHeadSha: 'head-sha',
              sourceRef: null,
            },
          },
        ],
      }),
    );

    const rulesIndex = prompt.indexOf('Reglas funcionales');
    expect(rulesIndex).toBeGreaterThan(prompt.indexOf('Código objetivo:'));
    expect(rulesIndex).toBeLessThan(prompt.indexOf('Contexto relacionado del mismo proyecto:'));
    expect(prompt).toContain('- [EXPECTED_RESULT:aaaaaaaaaaaaaaaa] Devuelve 1 siempre.');
    expect(prompt).toContain('confirmada por rol ADMIN');
    expect(prompt).not.toContain('user-secret');
  });

  it('omits the functional rules block when there are no rules', () => {
    const prompt = new PromptBuilder().build(makeContext());

    expect(prompt).not.toContain('Reglas funcionales');
  });
});
