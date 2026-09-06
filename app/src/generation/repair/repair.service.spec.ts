import { describe, expect, it, vi } from 'vitest';
import { RepairService } from './repair.service.js';
import type { RepairContext } from './repair-context.js';

describe('RepairService', () => {
  it('builds a repair prompt via PromptBuilder and delegates generation to the LLM provider', async () => {
    const promptBuilder = { buildRepair: vi.fn().mockReturnValue('repair prompt') };
    const llmProvider = {
      generate: vi.fn().mockResolvedValue({ content: 'fixed code', inputTokens: 20, outputTokens: 15 }),
    };
    const service = new RepairService(promptBuilder as never, llmProvider as never);
    const context: RepairContext = {
      generationContext: {
        target: {
          filePath: 'src/foo.ts',
          symbolName: 'foo',
          methodName: null,
          targetType: 'FUNCTION',
          content: 'function foo() {}',
        },
        relatedChunks: [],
        metadata: { language: 'typescript', framework: 'VITEST' },
        retrievedChunks: 0,
        selectedChunks: 0,
        contextTokens: 5,
      },
      failedTestContent: 'it("foo", () => {});',
      failureType: 'TEST_ASSERTION',
      errorSummary: 'boom',
      runnerFacts: null,
      attempt: 1,
    };

    const result = await service.repair(context);

    expect(promptBuilder.buildRepair).toHaveBeenCalledWith(context);
    expect(llmProvider.generate).toHaveBeenCalledWith('repair prompt');
    expect(result).toEqual({ content: 'fixed code', inputTokens: 20, outputTokens: 15 });
  });
});
