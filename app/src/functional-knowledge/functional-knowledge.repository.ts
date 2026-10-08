import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ConfirmingRole,
  FunctionalKnowledge,
  FunctionalKnowledgeSource,
  FunctionalKnowledgeStatus,
  FunctionalScope,
  ScenarioKind,
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
  /** WI-CORE-020 (DEC-FK-004): heredado de la pregunta por el servicio; la respuesta nunca lo calcula. */
  scenarioKind: ScenarioKind;
  scenarioKey: string;
}

/**
 * Violación del índice único parcial ACTIVE (`functional_knowledge_active_scenario_key`, WI-CORE-020):
 * otra respuesta confirmó primero una regla ACTIVE con el mismo target y `scenarioKey`. Lleva esa regla
 * ganadora para que el servicio responda `409 FUNCTIONAL_KNOWLEDGE_CONFLICT` con su forma habitual.
 */
export class ActiveKnowledgeConflictError extends Error {
  constructor(readonly winner: FunctionalKnowledge) {
    super('Ya existe una regla funcional ACTIVE con el mismo target y scenarioKey.');
    this.name = 'ActiveKnowledgeConflictError';
  }
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

/** Prisma reporta la violación de un índice único con código `P2002`. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

@Injectable()
export class FunctionalKnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Regla ACTIVE de un target para una clave de escenario (WI-CORE-020). La vigencia depende solo de
   * status/scope/targetRef/scenarioKey: `originHeadSha` es procedencia, no vencimiento.
   */
  findActive(
    projectId: string,
    scope: FunctionalScope,
    targetRef: string | null,
    scenarioKey: string,
  ): Promise<FunctionalKnowledge | null> {
    return this.prisma.functionalKnowledge.findFirst({
      where: { projectId, scope, targetRef, scenarioKey, status: 'ACTIVE' },
    });
  }

  findById(id: string): Promise<FunctionalKnowledge | null> {
    return this.prisma.functionalKnowledge.findUnique({ where: { id } });
  }

  async create(input: CreateFunctionalKnowledgeInput): Promise<FunctionalKnowledge> {
    assertSourceRefAllowed(input);

    try {
      return await this.prisma.functionalKnowledge.create({ data: input });
    } catch (error) {
      throw await this.translateActiveConflict(error, input);
    }
  }

  /**
   * Superseder es atómico: la nueva regla ACTIVE y el retiro de la anterior nunca quedan a medias.
   * Si la nueva regla viola el índice ACTIVE, la transacción revierte el retiro de la anterior.
   */
  async supersede(
    existingId: string,
    input: CreateFunctionalKnowledgeInput,
  ): Promise<FunctionalKnowledge> {
    assertSourceRefAllowed(input);

    try {
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
    } catch (error) {
      throw await this.translateActiveConflict(error, input);
    }
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

  /**
   * P2002 sobre el índice ACTIVE: se devuelve la regla ganadora. Si no hay ganadora localizable
   * (no debería ocurrir: una regla que deja de ser ACTIVE la sustituye otra en la misma transacción),
   * se conserva el error original.
   */
  private async translateActiveConflict(error: unknown, input: CreateFunctionalKnowledgeInput): Promise<unknown> {
    if (!isUniqueViolation(error)) {
      return error;
    }

    const winner = await this.findActive(input.projectId, input.scope, input.targetRef, input.scenarioKey);

    return winner ? new ActiveKnowledgeConflictError(winner) : error;
  }
}
