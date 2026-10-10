import { describe, expect, it, vi } from 'vitest';
import { FunctionalQuestionsRepository } from './functional-questions.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const input = {
  analysisRunId: 'run-1',
  projectId: 'project-1',
  symbolLanguage: 'TYPESCRIPT' as const,
  symbolKind: 'METHOD' as const,
  qualifiedName: 'Thing.doIt',
  filePath: 'src/thing.ts',
  question: 'Expected behavior?',
  rationale: 'No active rule.',
};

const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }];

function setup(updateCount = 1, existing: object | null = null) {
  const question = { id: 'question-1', ...input };
  const analysisRun = { id: 'run-1', status: 'ACTION_REQUIRED', current: true };
  const tx = {
    analysisRun: {
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(analysisRun),
    },
    functionalQuestion: {
      findFirst: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue(question),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
  };
  const repository = new FunctionalQuestionsRepository(prisma as unknown as PrismaService);

  return { repository, prisma, tx, question, analysisRun };
}

describe('FunctionalQuestionsRepository.createForCurrentRun', () => {
  it('atomically transitions a current PROCESSING run and creates its pending question', async () => {
    const { repository, prisma, tx, question, analysisRun } = setup();

    const result = await repository.createForCurrentRun(input, 'PROCESSING');

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.analysisRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'PROCESSING', current: true },
      data: { status: 'ACTION_REQUIRED', actionRequiredCount: { increment: 1 } },
    });
    expect(tx.functionalQuestion.create).toHaveBeenCalledWith({ data: input });
    expect(result).toEqual({ question, analysisRun });
  });

  it('creates no question when the run stopped being current before the conditional write', async () => {
    const { repository, tx } = setup(0);

    await expect(repository.createForCurrentRun(input, 'PROCESSING')).resolves.toBeNull();

    expect(tx.functionalQuestion.findFirst).not.toHaveBeenCalled();
    expect(tx.functionalQuestion.create).not.toHaveBeenCalled();
  });

  it('keeps ACTION_REQUIRED during continuation while serializing the question write', async () => {
    const { repository, tx } = setup();

    await repository.createForCurrentRun(input, 'ACTION_REQUIRED');

    expect(tx.analysisRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'ACTION_REQUIRED', current: true },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('reuses an already-created question instead of duplicating a concurrent evaluation', async () => {
    const existing = { id: 'question-existing', status: 'PENDING' };
    const { repository, tx } = setup(1, existing);

    const result = await repository.createForCurrentRun(input, 'ACTION_REQUIRED');

    expect(result?.question).toBe(existing);
    expect(tx.functionalQuestion.create).not.toHaveBeenCalled();
  });

  it('without scenarioKey keeps the target-wide dedupe over non-OBSOLETE questions', async () => {
    const { repository, tx } = setup();

    await repository.createForCurrentRun(input, 'ACTION_REQUIRED');

    expect(tx.functionalQuestion.findFirst).toHaveBeenCalledWith({
      where: {
        analysisRunId: 'run-1',
        filePath: 'src/thing.ts',
        qualifiedName: 'Thing.doIt',
        status: { not: 'OBSOLETE' },
      },
    });
  });

  it('with scenarioKey dedupes by (run, file, qualifiedName, scenarioKey) and by a historical target question', async () => {
    const existing = { id: 'question-existing', status: 'PENDING', scenarioKey: 'EXCEPTION:abc' };
    const { repository, tx } = setup(1, existing);
    const scenarioInput = { ...input, scenarioKind: 'EXCEPTION' as const, scenarioKey: 'EXCEPTION:abc' };

    const result = await repository.createForCurrentRun(scenarioInput, 'ACTION_REQUIRED');

    expect(tx.functionalQuestion.findFirst).toHaveBeenCalledWith({
      where: {
        analysisRunId: 'run-1',
        filePath: 'src/thing.ts',
        qualifiedName: 'Thing.doIt',
        status: { not: 'OBSOLETE' },
        OR: [{ scenarioKey: 'EXCEPTION:abc' }, { scenarioKey: null }],
      },
    });
    expect(result?.question).toBe(existing);
    expect(tx.functionalQuestion.create).not.toHaveBeenCalled();
  });

  it('with scenarioKey creates a separate question for another scenario of the same target', async () => {
    const { repository, tx } = setup(1, null);
    const scenarioInput = { ...input, scenarioKind: 'BOUNDARY' as const, scenarioKey: 'BOUNDARY:def' };

    await repository.createForCurrentRun(scenarioInput, 'ACTION_REQUIRED');

    expect(tx.functionalQuestion.create).toHaveBeenCalledWith({ data: scenarioInput });
  });
});

describe('FunctionalQuestionsRepository.answer', () => {
  function answerSetup(updateCount: number) {
    const row = { id: 'question-1', status: 'ANSWERED' };
    const tx = {
      functionalQuestion: {
        updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      },
    };
    const prisma = { $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)) };
    const repository = new FunctionalQuestionsRepository(prisma as unknown as PrismaService);

    return { repository, tx, row };
  }

  it('writes only while the question is PENDING and returns the stored row', async () => {
    const { repository, tx, row } = answerSetup(1);

    const result = await repository.answer('question-1', {
      answerChoice: 'YES',
      answerText: 'sí',
      knowledgeId: 'knowledge-1',
    });

    expect(tx.functionalQuestion.updateMany).toHaveBeenCalledWith({
      where: { id: 'question-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'ANSWERED', answerChoice: 'YES', knowledgeId: 'knowledge-1' }),
    });
    expect(result).toBe(row);
  });

  it('returns null without reading or writing again when the question is no longer PENDING', async () => {
    const { repository, tx } = answerSetup(0);

    const result = await repository.answer('question-1', {
      answerChoice: 'YES',
      answerText: null,
      knowledgeId: null,
    });

    expect(result).toBeNull();
    expect(tx.functionalQuestion.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

/**
 * Doble en memoria de las abstenciones. Las transacciones se ejecutan una a una, como lo haría
 * el bloqueo `FOR UPDATE` de la pregunta: el fake verifica la lógica de conteo bajo serialización.
 */
function abstentionFake(options: { open: boolean }) {
  const rows: Array<{ id: string; questionId: string; userId: string; role: string; createdAt: Date }> = [];
  let clock = 0;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    functionalQuestion: {
      findFirst: vi.fn(async () => (options.open ? { id: 'question-1' } : null)),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    analysisRun: { update: vi.fn(), updateMany: vi.fn() },
    functionalQuestionAbstention: {
      create: vi.fn(async ({ data }: { data: { questionId: string; userId: string; role: string } }) => {
        clock += 1;
        const row = { id: `abstention-${clock}`, ...data, createdAt: new Date(clock * 1000) };
        rows.push(row);
        return row;
      }),
      findMany: vi.fn(async () =>
        [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.id > a.id ? 1 : -1)),
      ),
    },
  };
  let queue: Promise<unknown> = Promise.resolve();
  const prisma = {
    $transaction: vi.fn((callback: (transaction: typeof tx) => Promise<unknown>) => {
      const run = queue.then(() => callback(tx));
      queue = run.catch(() => undefined);
      return run;
    }),
  };
  const repository = new FunctionalQuestionsRepository(prisma as unknown as PrismaService);

  return { repository, tx, rows };
}

describe('FunctionalQuestionsRepository.recordAbstention', () => {
  it('locks the question row, verifies it is PENDING under a current ACTION_REQUIRED run, and inserts the abstention', async () => {
    const { repository, tx } = abstentionFake({ open: true });

    const summary = await repository.recordAbstention('question-1', 'user-1', 'MAINTAINER');

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.functionalQuestion.findFirst.mock.invocationCallOrder[0]);
    expect(tx.functionalQuestion.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'question-1',
        status: 'PENDING',
        analysisRun: { status: 'ACTION_REQUIRED', current: true },
      },
      select: { id: true },
    });
    expect(tx.functionalQuestionAbstention.create).toHaveBeenCalledWith({
      data: { questionId: 'question-1', userId: 'user-1', role: 'MAINTAINER' },
    });
    expect(summary).toEqual({
      count: 1,
      lastAt: new Date(1000).toISOString(),
      lastByUserId: 'user-1',
      lastByRole: 'MAINTAINER',
    });
  });

  it('a repeated UNKNOWN inserts another row, counts it, and does not change the question or the run', async () => {
    const { repository, tx } = abstentionFake({ open: true });

    await repository.recordAbstention('question-1', 'user-1', 'MAINTAINER');
    const summary = await repository.recordAbstention('question-1', 'user-2', 'ADMIN');

    expect(summary).toEqual({
      count: 2,
      lastAt: new Date(2000).toISOString(),
      lastByUserId: 'user-2',
      lastByRole: 'ADMIN',
    });
    expect(tx.functionalQuestion.update).not.toHaveBeenCalled();
    expect(tx.functionalQuestion.updateMany).not.toHaveBeenCalled();
    expect(tx.analysisRun.update).not.toHaveBeenCalled();
    expect(tx.analysisRun.updateMany).not.toHaveBeenCalled();
  });

  it('two concurrent UNKNOWN submissions count 1 and then 2 without mutating state', async () => {
    const { repository, tx, rows } = abstentionFake({ open: true });

    const [first, second] = await Promise.all([
      repository.recordAbstention('question-1', 'user-1', 'MAINTAINER'),
      repository.recordAbstention('question-1', 'user-2', 'ADMIN'),
    ]);

    expect(first?.count).toBe(1);
    expect(second?.count).toBe(2);
    expect(rows).toHaveLength(2);
    expect(tx.functionalQuestion.update).not.toHaveBeenCalled();
    expect(tx.functionalQuestion.updateMany).not.toHaveBeenCalled();
    expect(tx.analysisRun.updateMany).not.toHaveBeenCalled();
  });

  it('returns null and inserts nothing when the question is no longer PENDING or its run is not current', async () => {
    const { repository, tx } = abstentionFake({ open: false });

    await expect(repository.recordAbstention('question-1', 'user-1', 'MAINTAINER')).resolves.toBeNull();

    expect(tx.functionalQuestionAbstention.create).not.toHaveBeenCalled();
  });
});

describe('FunctionalQuestionsRepository classified runs', () => {
  it('hides direct pending-question reads for unclassified or pre-binding runs', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new FunctionalQuestionsRepository({
      functionalQuestion: { findFirst },
    } as unknown as PrismaService);

    await repository.findPendingByAnalysisRun('run-1');

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        analysisRunId: 'run-1',
        status: 'PENDING',
        analysisRun: {
          pullRequestCreatedAt: { not: null },
          repositoryBindingEligible: true,
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { abstentions: { orderBy: NEWEST_FIRST } },
    });
  });

  it('includes the abstentions, newest first, in findById', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const repository = new FunctionalQuestionsRepository({
      functionalQuestion: { findUnique },
    } as unknown as PrismaService);

    await repository.findById('question-1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'question-1' },
      include: { abstentions: { orderBy: NEWEST_FIRST } },
    });
  });

  it('filters the cross-project inbox before pagination', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new FunctionalQuestionsRepository({
      functionalQuestion: { findMany },
    } as unknown as PrismaService);

    await repository.findActionRequired('user-1', undefined, 'PENDING', 20, undefined);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        analysisRun: {
          status: 'ACTION_REQUIRED',
          current: true,
          pullRequestCreatedAt: { not: null },
          repositoryBindingEligible: true,
        },
      }),
      include: { analysisRun: true, abstentions: { orderBy: NEWEST_FIRST } },
      take: 21,
    }));
  });
});
