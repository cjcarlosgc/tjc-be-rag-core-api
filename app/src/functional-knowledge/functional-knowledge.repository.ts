import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ConfirmingRole,
  FunctionalKnowledge,
  FunctionalKnowledgeSource,
  FunctionalKnowledgeStatus,
  FunctionalScope,
} from '../generated/prisma/client.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';

export interface CreateFunctionalKnowledgeInput {
  projectId: string;
  scope: FunctionalScope;
  targetRef: string | null;
  originalQuestion: string;
  originalAnswer: string;
  normalizedRule: string;
  source?: FunctionalKnowledgeSource;
  supersedesId?: string;
  /** Procedencia (INTEROP-2.7, WI-CORE-019). Usuario que respondió; nulo en reglas históricas. */
  confirmedByUserId?: string | null;
  /** Rol del AccessGrant de quien respondió (ADMIN o MAINTAINER). */
  confirmedRole?: ConfirmingRole | null;
  /** `headSha` del AnalysisRun de la pregunta respondida. Procedencia: no vence la regla. */
  originHeadSha?: string | null;
  /** Referencia de origen; solo admisible si `source` es `APPROVED_IMPORT`. */
  sourceRef?: string | null;
}

/**
 * Invariante de procedencia: `sourceRef` solo existe para reglas `APPROVED_IMPORT`.
 * Violarla es un error de programación, no una respuesta de API, por eso es un `Error` plano.
 */
function assertSourceRefAllowed(input: CreateFunctionalKnowledgeInput): void {
  const source = input.source ?? 'HUMAN_ANSWER';

  if (input.sourceRef != null && source !== 'APPROVED_IMPORT') {
    throw new Error('sourceRef solo se admite para FunctionalKnowledge con source APPROVED_IMPORT.');
  }
}

@Injectable()
export class FunctionalKnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(
    projectId: string,
    scope: FunctionalScope,
    targetRef: string | null,
  ): Promise<FunctionalKnowledge | null> {
    // La vigencia depende solo de status/scope/targetRef: `originHeadSha` es procedencia, no vencimiento.
    return this.prisma.functionalKnowledge.findFirst({
      where: { projectId, scope, targetRef, status: 'ACTIVE' },
    });
  }

  findById(id: string): Promise<FunctionalKnowledge | null> {
    return this.prisma.functionalKnowledge.findUnique({ where: { id } });
  }

  async create(input: CreateFunctionalKnowledgeInput): Promise<FunctionalKnowledge> {
    assertSourceRefAllowed(input);
    return this.prisma.functionalKnowledge.create({ data: input });
  }

  /** Superseder es atómico: la nueva regla ACTIVE y el retiro de la anterior nunca quedan a medias. */
  async supersede(
    existingId: string,
    input: CreateFunctionalKnowledgeInput,
  ): Promise<FunctionalKnowledge> {
    assertSourceRefAllowed(input);
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
    userId: string,
    status: FunctionalKnowledgeStatus | undefined,
    take: number,
    cursor: string | undefined,
  ): Promise<FunctionalKnowledge[]> {
    return this.prisma.functionalKnowledge.findMany({
      where: { projectId, project: accessibleProject(userId), ...(status ? { status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
