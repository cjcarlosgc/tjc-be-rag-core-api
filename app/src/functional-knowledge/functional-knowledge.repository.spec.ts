import { describe, expect, it, vi } from 'vitest';
import {
  FunctionalKnowledgeRepository,
  type CreateFunctionalKnowledgeInput,
} from './functional-knowledge.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';

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
};

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

  it('findActive selects only by project, scope, targetRef and ACTIVE status, never by procedencia', async () => {
    const { repository, prisma } = setup();

    await repository.findActive('project-1', 'METHOD', 'src/thing.ts::Thing.doIt');

    expect(prisma.functionalKnowledge.findFirst).toHaveBeenCalledWith({
      where: { projectId: 'project-1', scope: 'METHOD', targetRef: 'src/thing.ts::Thing.doIt', status: 'ACTIVE' },
    });
  });
});
