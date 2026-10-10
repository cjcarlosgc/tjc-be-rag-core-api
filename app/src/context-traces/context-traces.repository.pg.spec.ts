import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ContextTracesRepository } from './context-traces.repository.js';

/**
 * WI-CORE-027 (corrección P1 de concurrencia/persistencia): `beginAttempt` contra PostgreSQL REAL. El
 * `pg_advisory_xact_lock` devuelve `void`; con `$queryRaw` Prisma falla con «Failed to deserialize column of
 * type 'void'». Esta suite llama a `beginAttempt` de verdad (no siembra filas) y verifica numeración de
 * intentos, traza `current` y serialización concurrente bajo el lock.
 *
 * Necesita un PostgreSQL LOCAL descartable con las migraciones aplicadas. Sin
 * `CONTEXT_TRACES_TEST_DATABASE_URL` se omite; la URL debe apuntar a localhost y la suite nunca toca Supabase ni
 * una base compartida. Cada caso crea su propio proyecto; no borra filas.
 *
 *   CONTEXT_TRACES_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/ctx_test npx vitest run src/context-traces/context-traces.repository.pg.spec.ts
 */
const url = process.env.CONTEXT_TRACES_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

describe.skipIf(!url)('ContextTracesRepository.beginAttempt sobre PostgreSQL local (WI-CORE-027)', () => {
  let prisma: PrismaClient;
  let repository: ContextTracesRepository;

  beforeAll(() => {
    if (!isLocal) {
      throw new Error('CONTEXT_TRACES_TEST_DATABASE_URL debe apuntar a localhost.');
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    repository = new ContextTracesRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createExperiment() {
    const project = await prisma.project.create({ data: { name: `pg-context-trace-${crypto.randomUUID()}` } });
    const version = await prisma.projectVersion.create({ data: { projectId: project.id } });
    const target = await prisma.testTarget.create({
      data: {
        projectVersionId: version.id,
        filePath: 'src/thing.ts',
        symbolName: 'Thing',
        methodName: 'doIt',
        targetType: 'METHOD',
        startLine: 1,
        endLine: 3,
      },
    });
    const run = await prisma.experimentRun.create({
      data: {
        projectId: project.id,
        projectVersionId: version.id,
        targetId: target.id,
        totalRepetitions: 6,
      },
    });

    return { projectId: project.id, projectVersionId: version.id, targetId: target.id, experimentId: run.id };
  }

  function attemptInput(ids: Awaited<ReturnType<typeof createExperiment>>, repetition = 1) {
    return {
      experimentId: ids.experimentId,
      projectId: ids.projectId,
      projectVersionId: ids.projectVersionId,
      targetId: ids.targetId,
      strategy: 'RAG' as const,
      kind: 'RAG' as const,
      repetition,
    };
  }

  it('creates the first attempt and its current trace without a deserialization error', async () => {
    const ids = await createExperiment();

    const begun = await repository.beginAttempt(attemptInput(ids));

    expect(begun.repetition).toMatchObject({ repetition: 1, attempt: 1, state: 'RUNNING' });
    expect(begun.trace).toMatchObject({ attempt: 1, current: true, state: 'CAPTURING', kind: 'RAG' });
    const stored = await prisma.contextTrace.findMany({ where: { experimentId: ids.experimentId } });
    expect(stored).toHaveLength(1);
  });

  it('numbers a sequential replay of the same repetition and retires the previous trace', async () => {
    const ids = await createExperiment();
    const first = await repository.beginAttempt(attemptInput(ids));
    const second = await repository.beginAttempt(attemptInput(ids));

    expect(second.repetition.attempt).toBe(2);
    expect(second.trace).toMatchObject({ attempt: 2, current: true });
    const previous = await prisma.contextTrace.findUniqueOrThrow({ where: { id: first.trace.id } });
    expect(previous.current).toBe(false);
    const currentTraces = await prisma.contextTrace.findMany({
      where: { experimentId: ids.experimentId, strategy: 'RAG', repetition: 1, current: true },
    });
    expect(currentTraces.map((trace) => trace.attempt)).toEqual([2]);
  });

  it('serializes concurrent attempts of one logical repetition: distinct attempts and one current trace', async () => {
    const ids = await createExperiment();

    const results = await Promise.all([
      repository.beginAttempt(attemptInput(ids)),
      repository.beginAttempt(attemptInput(ids)),
      repository.beginAttempt(attemptInput(ids)),
    ]);

    expect(results.map((result) => result.repetition.attempt).sort()).toEqual([1, 2, 3]);
    const repetitions = await prisma.experimentRepetition.findMany({
      where: { experimentId: ids.experimentId, strategy: 'RAG', repetition: 1 },
      orderBy: { attempt: 'asc' },
    });
    expect(repetitions.map((row) => row.attempt)).toEqual([1, 2, 3]);
    const currentTraces = await prisma.contextTrace.findMany({
      where: { experimentId: ids.experimentId, strategy: 'RAG', repetition: 1, current: true },
    });
    expect(currentTraces).toHaveLength(1);
    expect(currentTraces[0].attempt).toBe(3);
  });

  it('keeps the attempt numbering of one repetition independent from another repetition', async () => {
    const ids = await createExperiment();

    await repository.beginAttempt(attemptInput(ids, 1));
    const other = await repository.beginAttempt(attemptInput(ids, 2));

    expect(other.repetition).toMatchObject({ repetition: 2, attempt: 1 });
    expect(other.trace).toMatchObject({ repetition: 2, attempt: 1, current: true });
  });
});
