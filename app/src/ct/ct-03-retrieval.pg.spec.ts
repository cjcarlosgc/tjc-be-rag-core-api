import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AnalysisRunTraceService } from '../analysis-runs/analysis-run-trace.service.js';
import { toRetrievalEvidence } from '../analysis-runs/analysis-trace-evidence.util.js';
import { AnalysisTraceRepository } from '../analysis-runs/persistence/analysis-trace.repository.js';
import { CodeChunksRepository, type ChunkToPersist } from '../project-versions/persistence/code-chunks.repository.js';
import { DEFAULT_VECTOR_TOP_K, RetrievalService } from '../retrieval/retrieval.service.js';

/**
 * CT-03-A5 y CT-03-A6 contra un PostgreSQL LOCAL descartable con pgvector y las migraciones aplicadas.
 * Sin `CT_TEST_DATABASE_URL` se omite; la URL debe apuntar a localhost. Cada caso usa ids únicos
 * (`randomUUID()`) y al final borra solo las filas que creó, en orden de FK; no vacía ninguna tabla.
 *
 *   CT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/rag_core_ct?schema=public npx vitest run src/ct/ct-03-retrieval.pg.spec.ts
 */
const url = process.env.CT_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

const DIMENSIONS = 1536;

/**
 * Embedding unitario determinista: componente 0 = cos(theta), componente 1 = sin(theta). La similitud
 * coseno contra el ancla (theta = 0) es exactamente cos(theta), decreciente en theta.
 */
function embeddingAt(theta: number): number[] {
  const vector = Array.from({ length: DIMENSIONS }, () => 0);
  vector[0] = Math.cos(theta);
  vector[1] = Math.sin(theta);
  return vector;
}

function parsed(overrides: Partial<ChunkToPersist> & { symbolName: string; embedding: number[] }): ChunkToPersist {
  return {
    filePath: `src/${overrides.symbolName}.ts`,
    symbolKind: 'FUNCTION',
    parentSymbolName: null,
    startLine: 1,
    endLine: 3,
    content: `export function ${overrides.symbolName}() {}`,
    importsUsed: [],
    tokenCount: 8,
    partIndex: 1,
    partsTotal: 1,
    ...overrides,
  } as ChunkToPersist;
}

describe.skipIf(!url)('CT-03 recuperación contra PostgreSQL con pgvector real', () => {
  let prisma: PrismaClient;
  let chunks: CodeChunksRepository;
  let trace: AnalysisTraceRepository;

  const projectIds: string[] = [];
  const versionIds: string[] = [];
  const runIds: string[] = [];

  beforeAll(() => {
    if (!isLocal) {
      throw new Error('CT_TEST_DATABASE_URL debe apuntar a localhost.');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    chunks = new CodeChunksRepository(prisma as unknown as PrismaService);
    trace = new AnalysisTraceRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    if (!prisma) return;
    // Solo lo creado por esta suite, en orden de FK.
    await prisma.analysisRetrieval.deleteMany({ where: { analysisRunId: { in: runIds } } });
    await prisma.analysisSymbol.deleteMany({ where: { analysisRunId: { in: runIds } } });
    await prisma.analysisRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.codeChunk.deleteMany({ where: { projectVersionId: { in: versionIds } } });
    await prisma.projectVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.$disconnect();
  });

  async function createProject() {
    const project = await prisma.project.create({ data: { name: `ct-03-${randomUUID()}` } });
    projectIds.push(project.id);
    return project;
  }

  async function createVersion(projectId: string) {
    const version = await prisma.projectVersion.create({ data: { projectId } });
    versionIds.push(version.id);
    return version;
  }

  async function anchorOf(projectVersionId: string, symbolName: string) {
    const [anchor] = await chunks.findBySymbol(projectVersionId, `src/${symbolName}.ts`, 'FUNCTION', symbolName, null);
    return anchor;
  }

  it('CT-03-A6: la búsqueda vectorial real ordena por similitud, excluye el ancla y sus partes hermanas y no devuelve chunks de otra versión', async () => {
    const project = await createProject();
    const versionA = await createVersion(project.id);
    const versionB = await createVersion(project.id);

    await chunks.insertMany(versionA.id, [
      parsed({ symbolName: 'anchor', embedding: embeddingAt(0) }),
      // Parte hermana del ancla: mismo símbolo, embedding idéntico (similitud 1) pero excluida.
      parsed({ symbolName: 'anchor', partIndex: 2, partsTotal: 2, embedding: embeddingAt(0) }),
      // Insertados fuera de orden de similitud a propósito.
      parsed({ symbolName: 'far', embedding: embeddingAt(0.9) }),
      parsed({ symbolName: 'near', embedding: embeddingAt(0.1) }),
      parsed({ symbolName: 'mid', embedding: embeddingAt(0.5) }),
    ]);
    // La versión B contiene una coincidencia PERFECTA con el ancla y otra cercana: nunca deben aparecer.
    await chunks.insertMany(versionB.id, [
      parsed({ symbolName: 'otherVersionPerfect', embedding: embeddingAt(0) }),
      parsed({ symbolName: 'otherVersionNear', embedding: embeddingAt(0.05) }),
    ]);
    // Un chunk sin embedding de la versión A no entra en la búsqueda vectorial.
    await prisma.codeChunk.create({
      data: {
        projectVersionId: versionA.id, filePath: 'src/noEmbedding.ts', symbolKind: 'FUNCTION', symbolName: 'noEmbedding',
        startLine: 1, endLine: 2, content: 'x',
      },
    });

    const anchor = await anchorOf(versionA.id, 'anchor');
    const similar = await chunks.findSimilarByEmbedding(versionA.id, anchor.id, 10);

    // Orden por similitud descendente y solo chunks de la versión A distintos del ancla y de su parte hermana.
    expect(similar.map((c) => c.symbolName)).toEqual(['near', 'mid', 'far']);
    expect(similar.every((c) => c.projectVersionId === versionA.id)).toBe(true);
    expect(similar.map((c) => c.id)).not.toContain(anchor.id);
    // Score = similitud coseno real calculada por pgvector.
    expect(similar[0].semanticScore).toBeCloseTo(Math.cos(0.1), 5);
    expect(similar[1].semanticScore).toBeCloseTo(Math.cos(0.5), 5);
    expect(similar[2].semanticScore).toBeCloseTo(Math.cos(0.9), 5);
    const scores = similar.map((c) => c.semanticScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    // El límite recorta tras ordenar por similitud.
    const limited = await chunks.findSimilarByEmbedding(versionA.id, anchor.id, 2);
    expect(limited.map((c) => c.symbolName)).toEqual(['near', 'mid']);

    // Consulta simétrica: desde la versión B tampoco se ve nada de la versión A.
    const anchorB = await anchorOf(versionB.id, 'otherVersionPerfect');
    const fromB = await chunks.findSimilarByEmbedding(versionB.id, anchorB.id, 10);
    expect(fromB.map((c) => c.symbolName)).toEqual(['otherVersionNear']);
  });

  it('CT-03-A6: RetrievalService con el repositorio real devuelve candidatos con score pgvector y filtrados por projectVersionId', async () => {
    const project = await createProject();
    const versionA = await createVersion(project.id);
    const versionB = await createVersion(project.id);
    await chunks.insertMany(versionA.id, [
      parsed({ symbolName: 'target', embedding: embeddingAt(0) }),
      parsed({ symbolName: 'sibling', embedding: embeddingAt(0.2) }),
    ]);
    await chunks.insertMany(versionB.id, [parsed({ symbolName: 'foreign', embedding: embeddingAt(0) })]);

    const retrieval = new RetrievalService(chunks);
    const result = await retrieval.retrieve(versionA.id, {
      filePath: 'src/target.ts', symbolName: 'target', methodName: null, targetType: 'FUNCTION',
    });

    expect(result.targetChunks.map((c) => c.symbolName)).toEqual(['target']);
    expect(result.candidates.map((c) => c.chunk.symbolName)).toEqual(['sibling']);
    expect(result.candidates[0].semanticScore).toBeCloseTo(Math.cos(0.2), 5);
    expect(result.candidates.every((c) => c.chunk.projectVersionId === versionA.id)).toBe(true);
  });

  it('CT-03-A5: cada retrieval persistido tiene un retrieval_id consultable en el trace del Run, estable al reintentar', async () => {
    const project = await createProject();
    const version = await createVersion(project.id);
    await chunks.insertMany(version.id, [
      parsed({ symbolName: 'alpha', embedding: embeddingAt(0) }),
      parsed({ symbolName: 'beta', embedding: embeddingAt(0.3) }),
      parsed({ symbolName: 'gamma', embedding: embeddingAt(0.6) }),
    ]);
    const run = await prisma.analysisRun.create({
      data: {
        projectId: project.id, repositoryId: 'repo-ct-03', repositoryName: 'owner/repo', prNumber: 1, prTitle: 'ct-03',
        baseRef: 'main', headRef: 'feature', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
        changesetBaseSha: 'a'.repeat(40), changesetHeadSha: 'b'.repeat(40), projectVersionId: version.id,
        status: 'SUCCESS',
      },
    });
    runIds.push(run.id);
    const symbols = await Promise.all(
      ['alpha', 'beta'].map((name) =>
        prisma.analysisSymbol.create({
          data: {
            analysisRunId: run.id, language: 'TYPESCRIPT', kind: 'FUNCTION', qualifiedName: name,
            filePath: `src/${name}.ts`, changeKind: 'DIRECTLY_CHANGED',
          },
        }),
      ),
    );

    const retrievalService = new RetrievalService(chunks);
    const persist = async (symbol: (typeof symbols)[number]) => {
      const result = await retrievalService.retrieve(version.id, {
        filePath: symbol.filePath, symbolName: symbol.qualifiedName, methodName: null, targetType: 'FUNCTION',
      });
      const evidence = toRetrievalEvidence(result, DEFAULT_VECTOR_TOP_K);
      return trace.upsertRetrieval({
        analysisRunId: run.id,
        analysisSymbolId: symbol.id,
        mode: evidence.config.mode,
        config: evidence.config,
        candidates: evidence.candidates,
      });
    };

    const stored = await Promise.all(symbols.map((symbol) => persist(symbol)));
    const retry = await persist(symbols[0]);

    // Cada retrieval tiene un id propio y distinto; el reintento del mismo target conserva el suyo.
    expect(stored[0].id).toBeTruthy();
    expect(stored[1].id).toBeTruthy();
    expect(stored[0].id).not.toBe(stored[1].id);
    expect(retry.id).toBe(stored[0].id);
    expect(await prisma.analysisRetrieval.count({ where: { analysisRunId: run.id } })).toBe(2);

    // Consultable por id en la base y en la lectura del audit del Run.
    const row = await prisma.analysisRetrieval.findUniqueOrThrow({ where: { id: stored[0].id } });
    expect(row).toMatchObject({ analysisRunId: run.id, analysisSymbolId: symbols[0].id, mode: 'SE' });
    expect(JSON.stringify(row.candidates)).toContain('beta');

    const service = new AnalysisRunTraceService(
      { getById: async () => prisma.analysisRun.findUniqueOrThrow({ where: { id: run.id } }) } as never,
      { findByAnalysisRun: (id: string) => prisma.analysisSymbol.findMany({ where: { analysisRunId: id } }) } as never,
      trace as never,
    );
    const auditTrace = await service.getTrace(run.id, 'user-ct-03');
    const retrievalIds = new Map(auditTrace.targets.map((target) => [target.symbol.qualifiedName, target.retrieval]));
    expect(retrievalIds.get('alpha')).toEqual({ status: 'PRESENT', retrievalId: stored[0].id });
    expect(retrievalIds.get('beta')).toEqual({ status: 'PRESENT', retrievalId: stored[1].id });
  });
});
