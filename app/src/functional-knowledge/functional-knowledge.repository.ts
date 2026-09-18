import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  FunctionalKnowledge,
  FunctionalKnowledgeSource,
  FunctionalKnowledgeStatus,
  FunctionalScope,
} from '../generated/prisma/client.js';

export interface CreateFunctionalKnowledgeInput {
  projectId: string;
  scope: FunctionalScope;
  targetRef: string | null;
  originalQuestion: string;
  originalAnswer: string;
  normalizedRule: string;
  source?: FunctionalKnowledgeSource;
  supersedesId?: string;
}

@Injectable()
export class FunctionalKnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(
    projectId: string,
    scope: FunctionalScope,
    targetRef: string | null,
  ): Promise<FunctionalKnowledge | null> {
    return this.prisma.functionalKnowledge.findFirst({
      where: { projectId, scope, targetRef, status: 'ACTIVE' },
    });
  }

  findById(id: string): Promise<FunctionalKnowledge | null> {
    return this.prisma.functionalKnowledge.findUnique({ where: { id } });
  }

  create(input: CreateFunctionalKnowledgeInput): Promise<FunctionalKnowledge> {
    return this.prisma.functionalKnowledge.create({ data: input });
  }

  /** Superseder es atómico: la nueva regla ACTIVE y el retiro de la anterior nunca quedan a medias. */
  async supersede(
    existingId: string,
    input: CreateFunctionalKnowledgeInput,
  ): Promise<FunctionalKnowledge> {
    const [, created] = await this.prisma.$transaction([
      this.prisma.functionalKnowledge.update({
        where: { id: existingId },
        data: { status: 'SUPERSEDED' },
      }),
      this.prisma.functionalKnowledge.create({
        data: { ...input, supersedesId: existingId },
      }),
    ]);

    return created;
  }

  findByProjectForOwner(
    projectId: string,
    ownerUserId: string,
    status: FunctionalKnowledgeStatus | undefined,
    take: number,
    cursor: string | undefined,
  ): Promise<FunctionalKnowledge[]> {
    return this.prisma.functionalKnowledge.findMany({
      where: { projectId, project: { ownerUserId }, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
