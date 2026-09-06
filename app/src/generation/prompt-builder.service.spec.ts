import { describe, expect, it } from 'vitest';
import { PromptBuilder } from './prompt-builder.service.js';
import type { GenerationContext } from '../retrieval/generation-context.js';
import type { RepairContext } from './repair/repair-context.js';
import type { RunnerFacts } from '../sandbox/sandbox.types.js';

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

  describe('buildRepair (HU23)', () => {
    const runnerFacts: RunnerFacts = {
      runner: 'VITEST',
      compiled: true,
      executed: true,
      passed: false,
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
      skippedTests: 0,
      testCases: [{ suitePath: null, name: 'bar works', status: 'FAILED', durationMs: 5, errorMessage: 'expected 1 to be 2' }],
      testCasesTruncated: false,
    };

    function makeRepairContext(overrides: Partial<RepairContext> = {}): RepairContext {
      return {
        generationContext: makeContext(),
        failedTestContent: 'it("bar", () => { expect(1).toBe(2); });',
        failureType: 'TEST_ASSERTION',
        errorSummary: 'expected 1 to be 2',
        runnerFacts,
        attempt: 1,
        ...overrides,
      };
    }

    it('includes the target code, the failed test and the failure details', () => {
      const builder = new PromptBuilder();
      const prompt = builder.buildRepair(makeRepairContext());

      expect(prompt).toContain('Foo.bar');
      expect(prompt).toContain('bar(): number { return 1; }');
      expect(prompt).toContain('it("bar", () => { expect(1).toBe(2); });');
      expect(prompt).toContain('TEST_ASSERTION');
      expect(prompt).toContain('expected 1 to be 2');
      expect(prompt).toContain('bar works: expected 1 to be 2');
    });

    it('omits the failed-cases section when there are no runner facts', () => {
      const builder = new PromptBuilder();
      const prompt = builder.buildRepair(makeRepairContext({ runnerFacts: null }));

      expect(prompt).not.toContain('Casos fallidos');
    });

    it('omits the error summary line when it is null', () => {
      const builder = new PromptBuilder();
      const prompt = builder.buildRepair(makeRepairContext({ errorSummary: null }));

      expect(prompt).not.toContain('Resumen del error');
    });
  });
});
