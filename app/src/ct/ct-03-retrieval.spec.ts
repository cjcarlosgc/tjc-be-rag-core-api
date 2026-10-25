import { describe, expect, it, vi } from 'vitest';
import { RetrievalService, type RetrievalResult } from '../retrieval/retrieval.service.js';
import type { RetrievalTarget } from '../retrieval/generation-context.js';
import type { CodeChunk } from '../generated/prisma/client.js';

/**
 * CT-03 (C-03, recuperación): fronteras de `RetrievalService`.
 *
 * Cubierto aparte (no se duplica): CT-03-A1/A2 (UNRESOLVABLE_TARGET, resolución METHOD/CONSTRUCTOR y modos SE/SEM)
 * en `retrieval.service.spec.ts`; CT-03-A5/A6 en `ct-03-retrieval.pg.spec.ts`.
 */
function chunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id: 'chunk-id',
    projectVersionId: 'version-1',
    filePath: 'src/foo.ts',
    symbolKind: 'FUNCTION',
    symbolName: 'foo',
    parentSymbolName: null,
    startLine: 1,
    endLine: 5,
    content: 'function foo() {}',
    importsUsed: [],
    tokenCount: 10,
    partIndex: 1,
    partsTotal: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as CodeChunk;
}

const TARGET: RetrievalTarget = {
  filePath: 'src/greeter.ts',
  symbolName: 'Greeter',
  methodName: 'greet',
  targetType: 'METHOD',
};

const ANCHOR = chunk({
  id: 'anchor',
  filePath: 'src/greeter.ts',
  symbolKind: 'METHOD',
  symbolName: 'greet',
  parentSymbolName: 'Greeter',
  importsUsed: ['./helper'],
});

function service(options: {
  similar?: Array<CodeChunk & { semanticScore: number }>;
  project?: CodeChunk[];
}) {
  const repository = {
    findBySymbol: vi.fn().mockResolvedValue([ANCHOR]),
    findSimilarByEmbedding: vi.fn().mockResolvedValue(options.similar ?? []),
    findByProjectVersion: vi.fn().mockResolvedValue(options.project ?? [ANCHOR]),
  };
  return { repository, retrieval: new RetrievalService(repository as never) };
}

describe('CT-03-A3: el conjunto vacío es un resultado explícito', () => {
  it('CT-03-A3: sin candidatos semánticos ni estructurales devuelve lista vacía con el target resuelto y sin excepción', async () => {
    const { retrieval } = service({ similar: [], project: [ANCHOR] });

    const result = await retrieval.retrieve('version-1', TARGET);

    expect(result.candidates).toEqual([]);
    expect(result.targetChunks).toEqual([ANCHOR]);
  });

  it('CT-03-A3: un proyecto con otros chunks sin relación con el target tampoco produce candidatos ni error', async () => {
    const unrelated = chunk({ id: 'unrelated', filePath: 'src/unrelated.ts', symbolName: 'unrelated', importsUsed: ['./other'] });
    const { retrieval } = service({ similar: [], project: [ANCHOR, unrelated] });

    await expect(retrieval.retrieve('version-1', TARGET)).resolves.toEqual({ targetChunks: [ANCHOR], candidates: [] });
  });

  it('CT-03-A3: en modo SEM el conjunto vacío también es una lista vacía explícita', async () => {
    const { retrieval, repository } = service({ similar: [] });

    await expect(retrieval.retrieve('version-1', TARGET, 20, 'SEM')).resolves.toEqual({ targetChunks: [ANCHOR], candidates: [] });
    expect(repository.findByProjectVersion).not.toHaveBeenCalled();
  });

  it('CT-03-A3: el ancla y sus partes hermanas no cuentan como candidatos: si solo hay esas, el resultado es vacío', async () => {
    const sibling = chunk({
      id: 'anchor-part-2', filePath: ANCHOR.filePath, symbolKind: 'METHOD', symbolName: 'greet',
      parentSymbolName: 'Greeter', partIndex: 2, partsTotal: 2,
    });
    const { retrieval } = service({ similar: [{ ...sibling, semanticScore: 0.99 }], project: [ANCHOR, sibling] });

    const result: RetrievalResult = await retrieval.retrieve('version-1', TARGET);

    expect(result.candidates).toEqual([]);
  });
});

describe('CT-03-A4: candidatos con score y orden determinista', () => {
  const semanticHigh = chunk({ id: 'sem-high', filePath: 'src/a.ts', symbolName: 'a' });
  const semanticLow = chunk({ id: 'sem-low', filePath: 'src/b.ts', symbolName: 'b' });
  const importedOnly = chunk({ id: 'imported', filePath: 'src/helper.ts', symbolName: 'helper' });
  const importsAnchorOnly = chunk({ id: 'imports-anchor', filePath: 'src/caller.ts', symbolName: 'caller', importsUsed: ['./greeter'] });
  // Orden del repositorio de proyecto: el candidato solo estructural IMPORTED_BY va antes que el IMPORTS.
  const project = [ANCHOR, semanticHigh, importsAnchorOnly, semanticLow, importedOnly];
  const similar = [
    { ...semanticHigh, semanticScore: 0.91 },
    { ...semanticLow, semanticScore: 0.42 },
  ];

  it('CT-03-A4: cada candidato trae su score semántico o su relación estructural, y el score semántico está en [0, 1]', async () => {
    const { retrieval } = service({ similar, project });

    const { candidates } = await retrieval.retrieve('version-1', TARGET);

    expect(candidates).toHaveLength(4);
    for (const candidate of candidates) {
      expect(candidate.semanticScore !== null || candidate.structuralMatch !== null).toBe(true);
      if (candidate.semanticScore !== null) {
        expect(candidate.semanticScore).toBeGreaterThanOrEqual(0);
        expect(candidate.semanticScore).toBeLessThanOrEqual(1);
      }
    }
    const byId = new Map(candidates.map((c) => [c.chunk.id, c]));
    expect(byId.get('sem-high')).toMatchObject({ semanticScore: 0.91, structuralMatch: null });
    expect(byId.get('sem-low')).toMatchObject({ semanticScore: 0.42, structuralMatch: null });
    expect(byId.get('imported')).toMatchObject({ semanticScore: null, structuralMatch: 'IMPORTS' });
    expect(byId.get('imports-anchor')).toMatchObject({ semanticScore: null, structuralMatch: 'IMPORTED_BY' });
  });

  it('CT-03-A4: el orden es determinista: primero los semánticos en el orden de similitud recibido (score descendente), luego los estructurales en orden del proyecto', async () => {
    const { retrieval } = service({ similar, project });

    const first = await retrieval.retrieve('version-1', TARGET);
    const second = await retrieval.retrieve('version-1', TARGET);

    const ids = first.candidates.map((c) => c.chunk.id);
    expect(ids).toEqual(['sem-high', 'sem-low', 'imports-anchor', 'imported']);
    expect(second.candidates.map((c) => c.chunk.id)).toEqual(ids);
    const semanticScores = first.candidates.filter((c) => c.semanticScore !== null).map((c) => c.semanticScore as number);
    expect(semanticScores).toEqual([...semanticScores].sort((a, b) => b - a));
  });

  it('CT-03-A4: un chunk hallado por señal semántica y estructural es un solo candidato con ambos valores', async () => {
    const both = chunk({ id: 'both', filePath: 'src/helper.ts', symbolName: 'helper' });
    const { retrieval } = service({ similar: [{ ...both, semanticScore: 0.77 }], project: [ANCHOR, both] });

    const { candidates } = await retrieval.retrieve('version-1', TARGET);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ semanticScore: 0.77, structuralMatch: 'IMPORTS' });
    expect(candidates[0].chunk.id).toBe('both');
  });
});
