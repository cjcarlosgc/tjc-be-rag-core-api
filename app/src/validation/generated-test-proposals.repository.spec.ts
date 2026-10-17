import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { GeneratedTestProposalsRepository } from './generated-test-proposals.repository.js';

describe('GeneratedTestProposalsRepository.upsertForSymbol generation (WI-CORE-027, DEC-EVID-003)', () => {
  const base = {
    analysisRunId: 'run-1',
    analysisSymbolId: 'symbol-1',
    relativePath: 'src/thing.spec.ts',
    symbolLanguage: 'TYPESCRIPT',
    symbolKind: 'METHOD',
    qualifiedName: 'Thing.doIt',
    filePath: 'src/thing.ts',
    storageKey: 'analysis-runs/run-1/proposals/x',
    contentSha256: 'b'.repeat(64),
    status: 'AVAILABLE',
  } as const;

  it('writes the generation on create and on update, so a retry replaces it', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'proposal-1' });
    const repository = new GeneratedTestProposalsRepository({ generatedTestProposal: { upsert } } as never);
    const generation = {
      provider: 'openai',
      model: 'gpt-x',
      modelVersion: null,
      reasoningEffort: 'high',
      inputTokens: 10,
      outputTokens: 20,
      durationMs: 5,
    };

    await repository.upsertForSymbol({ ...base, generation });

    const args = upsert.mock.calls[0][0];
    expect(args.create).toMatchObject({ analysisRunId: 'run-1', generation });
    expect(args.update).toMatchObject({ generation });
    expect(args.update).not.toHaveProperty('analysisRunId');
  });

  it('writes DbNull when no generation is available, clearing a previous one', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'proposal-1' });
    const repository = new GeneratedTestProposalsRepository({ generatedTestProposal: { upsert } } as never);

    await repository.upsertForSymbol({ ...base });

    expect(upsert.mock.calls[0][0].update.generation).toBe(Prisma.DbNull);
    expect(upsert.mock.calls[0][0].create.generation).toBe(Prisma.DbNull);
  });
});
