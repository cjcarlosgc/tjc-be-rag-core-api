import { describe, expect, it, vi } from 'vitest';
import {
  ActiveKnowledgeConflictError,
  FunctionalKnowledgeRepository,
  type CreateFunctionalKnowledgeInput,
} from './functional-knowledge.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FunctionalKnowledge } from '../generated/prisma/client.js';

const provenanceInput: CreateFunctionalKnowledgeInput = {
  projectId: 'project-1',
  scope: 'METHOD',
  targetRef: 'src/thing.ts::Thing.doIt',
  originalQuestion: '¿Qué hace?',
  originalAnswer: 'sí',
  normalizedRule: 'sí',
  confirmedByUserId: 'user-1',
  confirmedRole: 'MAINTAINER',
  originHeadSha: 'head-sha',
  scenarioKind: 'EXPECTED_RESULT',
  scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
};

const BOUNDARY_INPUT: CreateFunctionalKnowledgeInput = {
  ...provenanceInput,
  scenarioKind: 'BOUNDARY',
  scenarioKey: 'BOUNDARY:bbbbbbbbbbbbbbbb',
};

/** Error con la forma que Prisma lanza ante una violación de índice único. */
function uniqueViolation(): Error & { code: string } {
  return Object.assign(new Error('Unique constraint failed on the constraint: functional_knowledge_active_scenario_key'), {
    code: 'P2002',
  });
}

function activeRow(overrides: Partial<FunctionalKnowledge> = {}): FunctionalKnowledge {
  return {
    id: 'knowledge-winner',
    projectId: 'project-1',
    scope: 'METHOD',
    targetRef: 'src/thing.ts::Thing.doIt',
    originalQuestion: '¿Qué hace?',
    originalAnswer: 'sí',
    normalizedRule: 'sí',
    source: 'HUMAN_ANSWER',
    status: 'ACTIVE',
    supersedesId: null,
    confirmedByUserId: 'user-2',
    confirmedRole: 'ADMIN',
    originHeadSha: 'head-sha',
    sourceRef: null,
    scenarioKind: 'EXPECTED_RESULT',
    scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as FunctionalKnowledge;
}

function setup() {
  const prisma = {
    functionalKnowledge: {
      create: vi.fn().mockResolvedValue({ id: 'knowledge-new' }),
      update: vi.fn().mockResolvedValue({ id: 'knowledge-old' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const repository = new FunctionalKnowledgeRepository(prisma as unknown as PrismaService);

  return { repository, prisma };
}

describe('FunctionalKnowledgeRepository scenarios (WI-CORE-020)', () => {
  it('findActive filters by project, scope, targetRef, scenarioKey and ACTIVE status', async () => {
    const { repository, prisma } = setup();

    await repository.findActive('project-1', 'METHOD', 'src/thing.ts::Thing.doIt', 'BOUNDARY:bbbbbbbbbbbbbbbb');

    expect(prisma.functionalKnowledge.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        scope: 'METHOD',
        targetRef: 'src/thing.ts::Thing.doIt',
        scenarioKey: 'BOUNDARY:bbbbbbbbbbbbbbbb',
        status: 'ACTIVE',
      },
    });
  });

  it('findActive with a null targetRef matches the null target (PROJECT scope)', async () => {
    const { repository, prisma } = setup();

    await repository.findActive('project-1', 'PROJECT', null, 'LEGACY');

    expect(prisma.functionalKnowledge.findFirst).toHaveBeenCalledWith({
      where: { projectId: 'project-1', scope: 'PROJECT', targetRef: null, scenarioKey: 'LEGACY', status: 'ACTIVE' },
    });
  });

  it('create persists scenarioKind and scenarioKey on the new row', async () => {
    const { repository, prisma } = setup();

    await repository.create(BOUNDARY_INPUT);

    expect(prisma.functionalKnowledge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scenarioKind: 'BOUNDARY', scenarioKey: 'BOUNDARY:bbbbbbbbbbbbbbbb' }),
    });
  });

  it('supersede persists the scenario of the new row and retires only the given previous row', async () => {
    const { repository, prisma } = setup();

    await repository.supersede('knowledge-old', BOUNDARY_INPUT);

    expect(prisma.functionalKnowledge.update).toHaveBeenCalledWith({
      where: { id: 'knowledge-old' },
      data: { status: 'SUPERSEDED' },
    });
    expect(prisma.functionalKnowledge.create).toHaveBeenCalledWith({
      data: { ...BOUNDARY_INPUT, supersedesId: 'knowledge-old' },
    });
  });

  it('create turns a unique violation (P2002) into ActiveKnowledgeConflictError carrying the winning ACTIVE rule', async () => {
    const { repository, prisma } = setup();
    const winner = activeRow();
    prisma.functionalKnowledge.create.mockRejectedValueOnce(uniqueViolation());
    prisma.functionalKnowledge.findFirst.mockResolvedValueOnce(winner);

    const error = await repository.create(provenanceInput).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ActiveKnowledgeConflictError);
    expect((error as ActiveKnowledgeConflictError).winner).toBe(winner);
    expect(prisma.functionalKnowledge.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        scope: 'METHOD',
        targetRef: 'src/thing.ts::Thing.doIt',
        scenarioKey: 'EXPECTED_RESULT:aaaaaaaaaaaaaaaa',
        status: 'ACTIVE',
      },
    });
  });

  it('supersede turns a unique violation into ActiveKnowledgeConflictError and the transaction rolls back the retirement', async () => {
    const { repository, prisma } = setup();
    const winner = activeRow({ id: 'knowledge-other-winner' });
    prisma.functionalKnowledge.create.mockRejectedValueOnce(uniqueViolation());
    prisma.functionalKnowledge.findFirst.mockResolvedValueOnce(winner);

    const error = await repository.supersede('knowledge-old', provenanceInput).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ActiveKnowledgeConflictError);
    expect((error as ActiveKnowledgeConflictError).winner.id).toBe('knowledge-other-winner');
    // Un único $transaction: si el create falla, el retiro de la anterior se revierte con él.
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('keeps the original error when a unique violation has no ACTIVE winner to report', async () => {
    const { repository, prisma } = setup();
    const original = uniqueViolation();
    prisma.functionalKnowledge.create.mockRejectedValueOnce(original);
    prisma.functionalKnowledge.findFirst.mockResolvedValueOnce(null);

    await expect(repository.create(provenanceInput)).rejects.toBe(original);
  });

  it('propagates errors that are not unique violations without looking up a winner', async () => {
    const { repository, prisma } = setup();
    const connectionError = new Error('connection lost');
    prisma.functionalKnowledge.create.mockRejectedValueOnce(connectionError);

    await expect(repository.create(provenanceInput)).rejects.toBe(connectionError);
    expect(prisma.functionalKnowledge.findFirst).not.toHaveBeenCalled();
  });

  it('a rule with a different scenarioKey does not conflict: the create is attempted with its own key', async () => {
    const { repository, prisma } = setup();

    await repository.create(BOUNDARY_INPUT);

    // La unicidad la decide el índice por clave; el repositorio no compara contra reglas de otra clave.
    expect(prisma.functionalKnowledge.findFirst).not.toHaveBeenCalled();
    expect(prisma.functionalKnowledge.create).toHaveBeenCalledOnce();
  });
});

describe('FunctionalKnowledgeRepository provenance', () => {
  it('create passes the procedencia through to the new row', async () => {
    const { repository, prisma } = setup();

    await repository.create(provenanceInput);

    expect(prisma.functionalKnowledge.create).toHaveBeenCalledWith({ data: provenanceInput });
  });

  it('create accepts historical-shaped input with null procedencia', async () => {
    const { repository, prisma } = setup();

    await repository.create({
      ...provenanceInput,
      confirmedByUserId: null,
      confirmedRole: null,
      originHeadSha: null,
      sourceRef: null,
    });

    expect(prisma.functionalKnowledge.create).toHaveBeenCalledOnce();
  });

  it('create rejects sourceRef when source defaults to HUMAN_ANSWER and writes nothing', async () => {
    const { repository, prisma } = setup();

    await expect(repository.create({ ...provenanceInput, sourceRef: 'import://batch-1' })).rejects.toThrow(
      'sourceRef solo se admite para FunctionalKnowledge con source APPROVED_IMPORT.',
    );
    expect(prisma.functionalKnowledge.create).not.toHaveBeenCalled();
  });

  it('create rejects sourceRef when source is explicitly HUMAN_ANSWER', async () => {
    const { repository, prisma } = setup();

    await expect(
      repository.create({ ...provenanceInput, source: 'HUMAN_ANSWER', sourceRef: 'import://batch-1' }),
    ).rejects.toThrow('sourceRef solo se admite');
    expect(prisma.functionalKnowledge.create).not.toHaveBeenCalled();
  });

  it('create accepts sourceRef for an APPROVED_IMPORT rule', async () => {
    const { repository, prisma } = setup();

    await repository.create({ ...provenanceInput, source: 'APPROVED_IMPORT', sourceRef: 'import://batch-1' });

    expect(prisma.functionalKnowledge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: 'APPROVED_IMPORT', sourceRef: 'import://batch-1' }),
    });
  });

  it('supersede persists the procedencia on the new row and retires the previous one atomically', async () => {
    const { repository, prisma } = setup();

    await repository.supersede('knowledge-old', provenanceInput);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.functionalKnowledge.update).toHaveBeenCalledWith({
      where: { id: 'knowledge-old' },
      data: { status: 'SUPERSEDED' },
    });
    expect(prisma.functionalKnowledge.create).toHaveBeenCalledWith({
      data: { ...provenanceInput, supersedesId: 'knowledge-old' },
    });
  });

  it('supersede rejects sourceRef without APPROVED_IMPORT before touching the previous rule', async () => {
    const { repository, prisma } = setup();

    await expect(repository.supersede('knowledge-old', { ...provenanceInput, sourceRef: 'import://x' })).rejects.toThrow(
      'sourceRef solo se admite',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.functionalKnowledge.update).not.toHaveBeenCalled();
  });

  it('findActive selects only by project, scope, targetRef, scenarioKey and ACTIVE status, never by procedencia', async () => {
    const { repository, prisma } = setup();

    await repository.findActive('project-1', 'METHOD', 'src/thing.ts::Thing.doIt', 'LEGACY');

    expect(prisma.functionalKnowledge.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        scope: 'METHOD',
        targetRef: 'src/thing.ts::Thing.doIt',
        scenarioKey: 'LEGACY',
        status: 'ACTIVE',
      },
    });
  });
});
