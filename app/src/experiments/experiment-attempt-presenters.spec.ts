import { describe, expect, it } from 'vitest';
import { makeRagDetail } from './experiment-attempt-presenters.js';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import type { RetrievalCandidate, RetrievalResult } from '../retrieval/retrieval.service.js';
import type { CodeChunk } from '../generated/prisma/client.js';

function chunk(id: string, overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id,
    projectVersionId: 'version-1',
    filePath: `src/${id}.php`,
    symbolKind: 'METHOD',
    symbolName: id,
    parentSymbolName: null,
    startLine: 1,
    endLine: 5,
    content: `// ${id}`,
    importsUsed: [],
    tokenCount: 10,
    partIndex: 1,
    partsTotal: 1,
    createdAt: new Date(0),
    ...overrides,
  } as CodeChunk;
}

function build(language: 'php' | 'typescript') {
  const candidates: RetrievalCandidate[] = [
    { chunk: chunk('declaring'), semanticScore: null, structuralMatch: 'DECLARING_CLASS' },
    { chunk: chunk('semantic'), semanticScore: 0.9, structuralMatch: null },
    { chunk: chunk('weak'), semanticScore: 0.2, structuralMatch: null },
  ];
  const result: RetrievalResult = { targetChunks: [chunk('target')], candidates };
  const builder = new ContextBuilder({ get: (_key: string, fallback: unknown) => fallback } as never);
  return builder.build(
    result,
    { filePath: 'src/target.php', symbolName: 'target', methodName: null, targetType: 'FUNCTION' },
    { framework: 'PHPUNIT', language },
  );
}

describe('makeRagDetail (WI-CORE-103, INTEROP-2.22)', () => {
  it('persists the layer of each candidate, the new discard reason and the whole configuration for PHP', () => {
    const detail = makeRagDetail(build('php')) as unknown as {
      candidates: Array<{ chunkId: string; layer: string | null; decision: string; discardReason: string | null }>;
      configuration: Record<string, unknown>;
    };

    const byId = (id: string) => detail.candidates.find((entry) => entry.chunkId === id);
    expect(byId('declaring')).toMatchObject({ decision: 'SELECTED', layer: 'DECLARING_CLASS' });
    expect(byId('semantic')).toMatchObject({ decision: 'SELECTED', layer: 'RELEVANT_SEMANTIC' });
    expect(byId('weak')).toMatchObject({
      decision: 'DISCARDED',
      discardReason: 'BELOW_RELEVANCE_THRESHOLD',
      layer: null,
    });
    expect(detail.configuration).toMatchObject({
      strategy: 'LAYERED',
      relevanceThreshold: 0.6,
      declaringClassMaxTokens: 4000,
      targetEvidenceMaxTokens: 2000,
    });
  });

  it('persists layer null and strategy RANKED for TypeScript', () => {
    const detail = makeRagDetail(build('typescript')) as unknown as {
      candidates: Array<{ layer: string | null }>;
      configuration: Record<string, unknown>;
    };

    expect(detail.candidates.every((entry) => entry.layer === null)).toBe(true);
    expect(detail.configuration.strategy).toBe('RANKED');
  });
});
