import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ContextBuilder } from '../retrieval/context-builder.service.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import type { CodeChunk } from '../generated/prisma/client.js';
import type { RetrievalTarget } from '../retrieval/generation-context.js';

/**
 * CT-05-A3: el contexto de generación no contiene candidatos duplicados (mismo chunk). La unicidad la fija el
 * `RetrievalService` (fusión de candidatos semánticos y estructurales por `chunk.id`) y el `ContextBuilder` la
 * conserva en `relatedChunks` y en la auditoría de candidatos. Se prueba la cadena real recuperación → contexto.
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
  filePath: 'src/a.ts',
  symbolName: 'alpha',
  methodName: null,
  targetType: 'FUNCTION',
};

describe('CT-05 contexto de generación', () => {
  it('CT-05-A3: un chunk hallado por vía semántica y estructural (y repetido por la búsqueda vectorial) aparece una sola vez en el contexto', async () => {
    const anchor = chunk({ id: 'anchor', filePath: 'src/a.ts', symbolName: 'alpha', importsUsed: ['./b'] });
    // `beta` es a la vez el destino de un import del target (estructural) y un vecino semántico (dos veces).
    const beta = chunk({ id: 'beta', filePath: 'src/b.ts', symbolName: 'beta', content: 'function beta() {}' });
    const gamma = chunk({ id: 'gamma', filePath: 'src/c.ts', symbolName: 'gamma', content: 'function gamma() {}' });
    const repository = {
      findBySymbol: vi.fn().mockResolvedValue([anchor]),
      findSimilarByEmbedding: vi.fn().mockResolvedValue([
        { ...beta, semanticScore: 0.9 },
        { ...gamma, semanticScore: 0.8 },
        { ...beta, semanticScore: 0.9 },
        // El propio target nunca es candidato de su contexto.
        { ...anchor, semanticScore: 1 },
      ]),
      findByProjectVersion: vi.fn().mockResolvedValue([anchor, beta, gamma]),
    };

    const retrieval = await new RetrievalService(repository as never).retrieve('version-1', TARGET);
    const context = new ContextBuilder(new ConfigService()).build(retrieval, TARGET, { framework: 'VITEST' });

    const candidateIds = retrieval.candidates.map((candidate) => candidate.chunk.id);
    expect(candidateIds).toHaveLength(new Set(candidateIds).size);
    expect([...candidateIds].sort()).toEqual(['beta', 'gamma']);
    // La fusión conserva ambas señales del mismo chunk en lugar de duplicarlo.
    expect(retrieval.candidates.find((candidate) => candidate.chunk.id === 'beta')).toMatchObject({
      semanticScore: 0.9,
      structuralMatch: 'IMPORTS',
    });

    const related = context.relatedChunks.map((entry) => `${entry.filePath}::${entry.symbolName}`);
    expect(related).toHaveLength(new Set(related).size);
    expect(related.sort()).toEqual(['src/b.ts::beta', 'src/c.ts::gamma']);
    expect(context.retrievedChunks).toBe(2);
    expect(context.selectedChunks).toBe(2);
    const auditedIds = (context.audit?.candidates ?? []).map((entry) => entry.chunkId);
    expect(auditedIds).toHaveLength(new Set(auditedIds).size);
    expect(context.relatedChunks.map((entry) => entry.content)).not.toContain(anchor.content);
  });

  it('CT-05-A3: en modo SEM (solo semántico) los vecinos repetidos tampoco duplican candidatos', async () => {
    const anchor = chunk({ id: 'anchor', filePath: 'src/a.ts', symbolName: 'alpha' });
    const beta = chunk({ id: 'beta', filePath: 'src/b.ts', symbolName: 'beta' });
    const repository = {
      findBySymbol: vi.fn().mockResolvedValue([anchor]),
      findSimilarByEmbedding: vi.fn().mockResolvedValue([
        { ...beta, semanticScore: 0.7 },
        { ...beta, semanticScore: 0.7 },
      ]),
      findByProjectVersion: vi.fn(),
    };

    const retrieval = await new RetrievalService(repository as never).retrieve('version-1', TARGET, 20, 'SEM');
    const context = new ContextBuilder(new ConfigService()).build(retrieval, TARGET, { framework: 'VITEST' });

    expect(retrieval.candidates.map((candidate) => candidate.chunk.id)).toEqual(['beta']);
    expect(context.relatedChunks).toHaveLength(1);
  });
});
