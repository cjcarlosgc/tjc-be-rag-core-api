import { describe, expect, it, vi } from 'vitest';
import { ContextTracesRepository } from './context-traces.repository.js';

function makeRepository(overrides: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    experimentRepetition: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'repetition-1', attempt: 1 }),
    },
    contextTrace: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: 'trace-1', attempt: 1 }),
    },
    discoveredFile: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    contextTrace: {
      update: vi.fn(),
    },
    experimentRepetition: {
      update: vi.fn(),
    },
    discoveredFile: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };

  return { repository: new ContextTracesRepository(prisma as never), prisma, tx };
}

const input = {
  experimentId: 'experiment-1',
  projectId: 'project-1',
  projectVersionId: 'version-1',
  targetId: 'target-1',
  strategy: 'RAG' as const,
  kind: 'RAG' as const,
  repetition: 2,
};

describe('ContextTracesRepository', () => {
  it('creates the first attempt and trace atomically', async () => {
    const { repository, prisma, tx } = makeRepository();

    const result = await repository.beginAttempt(input);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.experimentRepetition.create).toHaveBeenCalledWith({
      data: {
        experimentId: 'experiment-1',
        strategy: 'RAG',
        repetition: 2,
        attempt: 1,
        state: 'RUNNING',
      },
    });
    expect(tx.contextTrace.updateMany).toHaveBeenCalledWith({
      where: {
        experimentId: 'experiment-1',
        strategy: 'RAG',
        repetition: 2,
        current: true,
      },
      data: { current: false },
    });
    expect(result).toMatchObject({
      repetition: { id: 'repetition-1', attempt: 1 },
      trace: { id: 'trace-1', attempt: 1 },
    });
  });

  it('increments attempt and retires the previous current trace', async () => {
    const { repository, tx } = makeRepository();
    tx.experimentRepetition.findFirst.mockResolvedValue({ attempt: 3 });
    tx.experimentRepetition.create.mockResolvedValue({ id: 'repetition-4', attempt: 4 });
    tx.contextTrace.create.mockResolvedValue({ id: 'trace-4', attempt: 4 });

    const result = await repository.beginAttempt(input);

    expect(tx.experimentRepetition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ attempt: 4, state: 'RUNNING' }),
    });
    expect(tx.contextTrace.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ experimentRepetitionId: 'repetition-4', attempt: 4, current: true }),
    });
    expect(result.trace.id).toBe('trace-4');
  });

  it('deduplicates discovered paths and rejects non-relative or traversal paths', async () => {
    const { repository, prisma, tx } = makeRepository();

    await repository.insertDiscoveredFiles('trace-1', 1, ['src/a.ts', 'src/a.ts', 'src/b.ts']);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.discoveredFile.createMany).toHaveBeenCalledWith({
      data: [
        { contextTraceId: 'trace-1', step: 1, filePath: 'src/a.ts' },
        { contextTraceId: 'trace-1', step: 1, filePath: 'src/b.ts' },
      ],
      skipDuplicates: true,
    });
    await expect(repository.insertDiscoveredFiles('trace-1', 1, ['src/safe.ts', '../secret.txt'])).rejects.toThrow(
      'DiscoveredFile requiere rutas relativas POSIX seguras.',
    );
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.discoveredFile.createMany).toHaveBeenCalledOnce();
  });

  it('inserts large discovered-file sets in bounded batches within one transaction', async () => {
    const { repository, prisma, tx } = makeRepository();
    const paths = Array.from({ length: 2_001 }, (_, index) => `src/file-${index}.ts`);
    paths.push(paths[0], paths[999]);

    await repository.insertDiscoveredFiles('trace-1', 4, paths);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.discoveredFile.createMany).toHaveBeenCalledTimes(3);
    expect(tx.discoveredFile.createMany.mock.calls.map(([args]) => args.data.length)).toEqual([1_000, 1_000, 1]);
    const firstBatch = tx.discoveredFile.createMany.mock.calls[0][0];
    expect(firstBatch.data.slice(0, 2)).toEqual([
      { contextTraceId: 'trace-1', step: 4, filePath: 'src/file-0.ts' },
      { contextTraceId: 'trace-1', step: 4, filePath: 'src/file-1.ts' },
    ]);
    expect(firstBatch.skipDuplicates).toBe(true);
    expect(tx.discoveredFile.createMany.mock.calls[2][0]).toEqual({
      data: [{ contextTraceId: 'trace-1', step: 4, filePath: 'src/file-2000.ts' }],
      skipDuplicates: true,
    });
    expect(prisma.discoveredFile.createMany).not.toHaveBeenCalled();
  });

  it('propagates a failed batch so the surrounding transaction can roll back all batches', async () => {
    const { repository, prisma, tx } = makeRepository();
    const failure = new Error('batch insert failed');
    tx.discoveredFile.createMany.mockResolvedValueOnce({ count: 1_000 }).mockRejectedValueOnce(failure);

    await expect(
      repository.insertDiscoveredFiles(
        'trace-1',
        1,
        Array.from({ length: 1_001 }, (_, index) => `src/file-${index}.ts`),
      ),
    ).rejects.toBe(failure);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.discoveredFile.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.discoveredFile.createMany).not.toHaveBeenCalled();
  });

  it('uses a stable id cursor and returns one extra row to detect the next page', async () => {
    const { repository, prisma } = makeRepository();
    prisma.discoveredFile.findMany.mockResolvedValue([
      { id: 'file-2', filePath: 'src/b.ts' },
      { id: 'file-3', filePath: 'src/c.ts' },
      { id: 'file-4', filePath: 'src/d.ts' },
    ]);

    const page = await repository.listDiscoveredFiles('trace-1', 3, 'file-1', 2);

    expect(prisma.discoveredFile.findMany).toHaveBeenCalledWith({
      where: { contextTraceId: 'trace-1', step: 3, id: { gt: 'file-1' } },
      orderBy: { id: 'asc' },
      take: 3,
      select: { id: true, filePath: true },
    });
    expect(page).toEqual({
      items: [
        { id: 'file-2', filePath: 'src/b.ts' },
        { id: 'file-3', filePath: 'src/c.ts' },
      ],
      hasMore: true,
    });
  });
});
