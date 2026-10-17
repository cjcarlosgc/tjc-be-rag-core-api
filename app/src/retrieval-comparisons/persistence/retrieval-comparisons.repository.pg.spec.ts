import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { RetrievalComparisonsRepository } from './retrieval-comparisons.repository.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * WI-CORE-022: SQL real de `retrieval_comparisons` y `retrieval_comparison_results` (upsert por
 * `(comparisonId, mode)`, guardas de estado, listado con cursor, `DbNull` en JSON). Necesita un
 * PostgreSQL LOCAL descartable con el esquema y la migración `20261009130000_retrieval_comparisons`
 * aplicados. Sin `RETRIEVAL_COMPARISONS_TEST_DATABASE_URL` se omite; la suite nunca toca Supabase.
 * La URL debe apuntar a localhost: la suite borra solo sus tablas, no las de otros módulos.
 *
 *   RETRIEVAL_COMPARISONS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/rc_test npx vitest run src/retrieval-comparisons/persistence/retrieval-comparisons.repository.pg.spec.ts
 */
const url = process.env.RETRIEVAL_COMPARISONS_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

const SYMBOL = {
  language: 'TYPESCRIPT',
  kind: 'FUNCTION',
  qualifiedName: 'foo',
  filePath: 'src/foo.ts',
  changeKind: 'DIRECTLY_CHANGED',
};

describe.skipIf(!url)('RetrievalComparisonsRepository against a local PostgreSQL (WI-CORE-022)', () => {
  let prisma: PrismaClient;
  let repository: RetrievalComparisonsRepository;
  let analysisRunId: string;
  let projectId: string;
  let projectVersionId: string;

  beforeAll(async () => {
    if (!isLocal) {
      throw new Error('RETRIEVAL_COMPARISONS_TEST_DATABASE_URL debe apuntar a localhost (la suite vacía sus tablas).');
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    repository = new RetrievalComparisonsRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "retrieval_comparison_results", "retrieval_comparisons"`;

    const project = await prisma.project.create({ data: { name: 'pg-spec-retrieval' } });
    const version = await prisma.projectVersion.create({ data: { projectId: project.id } });
    const run = await prisma.analysisRun.create({
      data: {
        projectId: project.id,
        repositoryId: 'repo-1',
        repositoryName: 'owner/repo',
        prNumber: 1,
        prTitle: 'pg spec',
        baseRef: 'main',
        headRef: 'feature',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
        changesetBaseSha: 'a'.repeat(40),
        changesetHeadSha: 'b'.repeat(40),
        projectVersionId: version.id,
      },
    });
    projectId = project.id;
    projectVersionId = version.id;
    analysisRunId = run.id;
  });

  const createComparison = (groundTruth: Array<{ filePath: string; symbolQualifiedName: string }> | null = null) =>
    repository.create({
      analysisRunId,
      projectId,
      projectVersionId,
      symbol: SYMBOL,
      idempotencyKey: null,
      groundTruth,
    });

  it('stores the symbol snapshot and a null ground truth as SQL NULL, and reads them back', async () => {
    const created = await createComparison();
    const found = await repository.findById(created.id);

    expect(found).toMatchObject({ status: 'PENDING', failureCode: null, groundTruth: null, startedAt: null });
    expect(found?.symbol).toEqual(SYMBOL);
    const [raw] = await prisma.$queryRaw<Array<{ groundTruth: unknown }>>`SELECT "groundTruth" FROM "retrieval_comparisons" WHERE id = ${created.id}`;
    expect(raw.groundTruth).toBeNull();
  });

  it('keeps a provided ground truth as JSON', async () => {
    const created = await createComparison([{ filePath: 'src/a.ts', symbolQualifiedName: 'A.run' }]);

    expect((await repository.findById(created.id))?.groundTruth).toEqual([{ filePath: 'src/a.ts', symbolQualifiedName: 'A.run' }]);
  });

  it('markRunning moves to RUNNING once and a COMPLETED comparison is never reopened', async () => {
    const created = await createComparison();

    await expect(repository.markRunning(created.id)).resolves.toBe(true);
    expect((await repository.findById(created.id))?.status).toBe('RUNNING');

    await repository.saveResultsAndComplete(created.id, [{ mode: 'SE', config: {}, candidates: [], metrics: null }]);
    await expect(repository.markRunning(created.id)).resolves.toBe(false);
    expect((await repository.findById(created.id))?.status).toBe('COMPLETED');
  });

  it('saveResultsAndComplete persists both modes, marks COMPLETED and stores null metrics as SQL NULL', async () => {
    const created = await createComparison();
    await repository.markRunning(created.id);

    const saved = await repository.saveResultsAndComplete(created.id, [
      { mode: 'SE', config: { semanticTopK: 20, finalTopK: 10 }, candidates: [{ rank: 1 }], metrics: null },
      { mode: 'SEM', config: { semanticTopK: 20, finalTopK: 10 }, candidates: [], metrics: { precisionAt5: 0.2, recallAt5: 0.5, precisionAt10: 0.1, recallAt10: 0.25 } },
    ]);

    expect(saved).toBe(true);
    const comparison = await repository.findById(created.id);
    expect(comparison).toMatchObject({ status: 'COMPLETED' });
    expect(comparison?.completedAt).toBeInstanceOf(Date);

    const results = await repository.findResults(created.id);
    expect(results.map((result) => result.mode)).toEqual(['SE', 'SEM']);
    expect(results[0].metrics).toBeNull();
    expect(results[1].metrics).toEqual({ precisionAt5: 0.2, recallAt5: 0.5, precisionAt10: 0.1, recallAt10: 0.25 });
  });

  it('upserts by (comparisonId, mode): an existing result row is updated, not duplicated', async () => {
    const created = await createComparison();
    await repository.markRunning(created.id);
    await prisma.retrievalComparisonResult.create({
      data: { comparisonId: created.id, mode: 'SE', config: {}, candidates: [], metrics: Prisma.DbNull },
    });

    await repository.saveResultsAndComplete(created.id, [
      { mode: 'SE', config: { semanticTopK: 20 }, candidates: [{ rank: 1 }], metrics: null },
      { mode: 'SEM', config: {}, candidates: [], metrics: null },
    ]);

    const results = await repository.findResults(created.id);
    expect(results).toHaveLength(2);
    expect(results[0].config).toEqual({ semanticTopK: 20 });
  });

  it('a FAILED comparison is not overwritten by a late result and writes no result rows', async () => {
    const created = await createComparison();
    await repository.markRunning(created.id);
    await expect(repository.markFailed(created.id, 'RETRIEVAL_COMPARISON_WORKER_LOST', 'Worker caído.')).resolves.toBe(true);

    const saved = await repository.saveResultsAndComplete(created.id, [{ mode: 'SE', config: {}, candidates: [], metrics: null }]);

    expect(saved).toBe(false);
    const comparison = await repository.findById(created.id);
    expect(comparison).toMatchObject({ status: 'FAILED', failureCode: 'RETRIEVAL_COMPARISON_WORKER_LOST' });
    expect(await repository.findResults(created.id)).toEqual([]);
  });

  it('a retry from FAILED clears the failure and the completion timestamp', async () => {
    const created = await createComparison();
    await repository.markRunning(created.id);
    await repository.markFailed(created.id, 'RETRIEVAL_TARGET_UNRESOLVABLE', 'Sin chunk.');

    await expect(repository.markRunning(created.id)).resolves.toBe(true);

    expect(await repository.findById(created.id)).toMatchObject({ status: 'RUNNING', failureCode: null, failureMessage: null, completedAt: null });
  });

  it('listByAnalysisRun returns the newest first and pages with a cursor', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await createComparison();
      await prisma.retrievalComparison.update({ where: { id: created.id }, data: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)) } });
      ids.push(created.id);
    }

    const firstPage = await repository.listByAnalysisRun(analysisRunId, 3);
    expect(firstPage.map((row) => row.id)).toEqual([ids[2], ids[1], ids[0]]);

    const afterCursor = await repository.listByAnalysisRun(analysisRunId, 2, ids[2]);
    expect(afterCursor.map((row) => row.id)).toEqual([ids[1], ids[0]]);
  });

  it('deleting a comparison cascades to its result rows', async () => {
    const created = await createComparison();
    await repository.markRunning(created.id);
    await repository.saveResultsAndComplete(created.id, [{ mode: 'SE', config: {}, candidates: [], metrics: null }]);

    await prisma.retrievalComparison.delete({ where: { id: created.id } });

    expect(await prisma.retrievalComparisonResult.count({ where: { comparisonId: created.id } })).toBe(0);
  });
});
