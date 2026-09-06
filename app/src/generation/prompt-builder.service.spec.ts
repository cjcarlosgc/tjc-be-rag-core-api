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
});
