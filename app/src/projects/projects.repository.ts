import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Project } from '../generated/prisma/client.js';
import { ownedProject } from '../common/persistence/owned-project.filter.js';

/** Runs que un borrado de Project debe cerrar: los que aún pueden avanzar. */
const IN_FLIGHT_RUN_STATUSES = ['QUEUED', 'PROCESSING', 'ACTION_REQUIRED'] as const;
const PROJECT_DELETED_MESSAGE = 'PROJECT_DELETED';

@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(name: string, ownerUserId: string): Promise<Project> {
    return this.prisma.project.create({ data: { name, ownerUserId } });
  }

  findById(id: string, ownerUserId: string): Promise<Project | null> {
    return this.prisma.project.findFirst({ where: { id, ...ownedProject(ownerUserId) } });
  }

  /**
   * HU25: página de proyectos, más recientes primero. Se pide `take + 1`
   * para saber si hay una página siguiente sin una segunda consulta; el
   * cursor es el id del último proyecto devuelto.
   */
  findAll(take: number, ownerUserId: string, cursor?: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: ownedProject(ownerUserId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  /**
   * HU56: borrado lógico en una única transacción. Marca `deletedAt`, borra el
   * binding (libera el `repositoryId`) y cierra lo que estaba en curso: Runs
   * no terminales -> OBSOLETE, publicaciones pendientes -> FAILED y jobs
   * PENDING de esos Runs/publicaciones/experimentos -> FAILED. Runs, versiones
   * y Functional Knowledge se conservan como evidencia. Devuelve `false` si el
   * Project no existe, es ajeno o ya estaba borrado (mismo `404`).
   */
  softDelete(id: string, ownerUserId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const marked = await tx.project.updateMany({
        where: { id, ...ownedProject(ownerUserId) },
        data: { deletedAt: new Date() },
      });

      if (marked.count === 0) {
        return false;
      }

      await tx.repositoryBinding.deleteMany({ where: { projectId: id } });

      const inFlightRuns = await tx.analysisRun.findMany({
        where: { projectId: id, status: { in: [...IN_FLIGHT_RUN_STATUSES] } },
        select: { id: true },
      });
      const runIds = inFlightRuns.map((run) => run.id);

      if (runIds.length > 0) {
        await tx.analysisRun.updateMany({
          where: { id: { in: runIds } },
          data: { status: 'OBSOLETE', current: false, completedAt: new Date() },
        });
      }

      const pendingPublications = await tx.testPublication.findMany({
        where: { analysisRun: { projectId: id }, status: { in: ['PENDING', 'PUBLISHING'] } },
        select: { id: true },
      });
      const publicationIds = pendingPublications.map((publication) => publication.id);

      if (publicationIds.length > 0) {
        await tx.testPublication.updateMany({
          where: { id: { in: publicationIds } },
          data: { status: 'FAILED', failureMessage: PROJECT_DELETED_MESSAGE },
        });
      }

      await tx.$executeRaw`
        UPDATE "jobs"
        SET "status" = 'FAILED', "lastError" = ${PROJECT_DELETED_MESSAGE}, "updatedAt" = now()
        WHERE "status" = 'PENDING'
          AND (
            "payload"->>'analysisRunId' = ANY(${runIds}::text[])
            OR "payload"->>'publicationId' = ANY(${publicationIds}::text[])
            OR "payload"->>'projectId' = ${id}
          )
      `;

      return true;
    });
  }
}
