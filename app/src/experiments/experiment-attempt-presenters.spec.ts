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

describe('makeRagDetail dependencyContext y importsUsed (WI-CORE-104)', () => {
  const MARKER = 'Brick\\Money\\Context\\MARCADOR_IMPORT_INTERNO';

  function buildWithImports(dependencyContext?: Parameters<ContextBuilder['build']>[5]) {
    const candidates: RetrievalCandidate[] = [
      { chunk: chunk('declaring', { importsUsed: [MARKER] }), semanticScore: null, structuralMatch: 'DECLARING_CLASS' },
      { chunk: chunk('semantic', { importsUsed: [MARKER] }), semanticScore: 0.9, structuralMatch: null },
    ];
    const result: RetrievalResult = { targetChunks: [chunk('target', { importsUsed: [MARKER] })], candidates };
    const builder = new ContextBuilder({ get: (_key: string, fallback: unknown) => fallback } as never);
    return builder.build(
      result,
      { filePath: 'src/target.php', symbolName: 'target', methodName: null, targetType: 'FUNCTION' },
      { framework: 'PHPUNIT', language: 'php' },
      undefined,
      [],
      dependencyContext,
    );
  }

  it('el importsUsed interno de relatedChunks no se serializa en la traza', () => {
    const context = buildWithImports();

    expect(context.relatedChunks.some((related) => related.importsUsed?.includes(MARKER))).toBe(true);
    expect(JSON.stringify(makeRagDetail(context))).not.toContain(MARKER);
    expect(JSON.stringify(makeRagDetail(context))).not.toContain('importsUsed');
  });

  it('con solo glosario (entries: [], tokenCount > 0) persiste la sección sin texto, glosario ni campos internos', () => {
    const context = buildWithImports({
      entries: [],
      unresolvedCount: 0,
      tokenCount: 123,
      truncated: true,
      text: 'Nombres completos (FQCN) de los tipos que aparecen en el código de contexto:\n- X → A\\X',
    });

    const detail = makeRagDetail(context) as unknown as { dependencyContext?: Record<string, unknown> };

    expect(detail.dependencyContext).toEqual({ entries: [], unresolvedCount: 0, tokenCount: 123, truncated: true });
    expect(JSON.stringify(detail)).not.toContain('Nombres completos');
  });

  it('no persiste constructorVisibility, factories, signature ni glosario de las entradas', () => {
    const entry = {
      typeName: 'Money',
      fqcn: 'Brick\\Money\\Money',
      origin: 'CONSTRUCTOR' as const,
      resolvedBy: 'IMPORT' as const,
      final: true as const,
      signature: '(int $a)',
      constructorVisibility: 'private',
      factories: ['of(): static'],
    };
    const context = buildWithImports({
      entries: [entry],
      unresolvedCount: 0,
      tokenCount: 50,
      truncated: false,
      text: 'texto',
    } as never);

    const detail = makeRagDetail(context) as unknown as { dependencyContext: { entries: unknown[] } };

    expect(detail.dependencyContext.entries).toEqual([
      { typeName: 'Money', fqcn: 'Brick\\Money\\Money', origin: 'CONSTRUCTOR', resolvedBy: 'IMPORT', final: true },
    ]);
    expect(JSON.stringify(detail)).not.toContain('factories');
    expect(JSON.stringify(detail)).not.toContain('constructorVisibility');
  });

  it('sin entradas, sin no resueltos y sin tokens no persiste la sección', () => {
    const detail = makeRagDetail(
      buildWithImports({ entries: [], unresolvedCount: 0, tokenCount: 0, truncated: false, text: '' }),
    ) as unknown as Record<string, unknown>;

    expect(detail).not.toHaveProperty('dependencyContext');
  });
});
