import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Project, ProjectRole } from '../generated/prisma/client.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';
import type { ProjectWithAccess } from '../project-access/project-access.repository.js';

/** Runs que un borrado de Project debe cerrar: los que aún pueden avanzar. */
const IN_FLIGHT_RUN_STATUSES = ['QUEUED', 'PROCESSING', 'ACTION_REQUIRED'] as const;
const PROJECT_DELETED_MESSAGE = 'PROJECT_DELETED';

@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Project del workspace personal: solo lo ve su creador (Admin), sin registro de acceso. */
  create(name: string, ownerUserId: string): Promise<Project> {
    return this.prisma.project.create({ data: { name, ownerUserId } });
  }

  /**
   * HU63: Project de una organización. Inserta el registro `ADMIN` del creador en la MISMA
   * transacción: el Project nace sin repositorio y solo lo ven sus Admin, así que sin ese
   * registro el propio creador no lo vería hasta una verificación posterior. `login` es el
   * vigente de la instalación (el workspace no cambia tras crear el Project).
   */
  createInOrganization(
    name: string,
    ownerUserId: string,
    organization: { id: string; login: string },
  ): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { name, ownerUserId, githubOrgId: organization.id, githubOrgLogin: organization.login },
      });
      await tx.projectAccess.create({
        data: { projectId: project.id, userId: ownerUserId, role: 'ADMIN', verifiedAt: new Date() },
      });
      return project;
    });
  }

  findById(id: string, userId: string, minRole: ProjectRole = 'READER'): Promise<Project | null> {
    return this.prisma.project.findFirst({ where: { id, ...accessibleProject(userId, minRole) } });
  }

  /** HU63: renombra (solo Admin). `false` si el Project no existe o el usuario no es su Admin. */
  async rename(id: string, name: string, userId: string): Promise<boolean> {
    const updated = await this.prisma.project.updateMany({
      where: { id, ...accessibleProject(userId, 'ADMIN') },
      data: { name },
    });
    return updated.count > 0;
  }

  /**
   * HU25: página de proyectos visibles (personales del usuario más los de organización con
   * registro suficiente), más recientes primero. Se pide `take + 1` para saber si hay una
   * página siguiente sin una segunda consulta; el cursor es el id del último proyecto
   * devuelto. `workspace` limita a un workspace: `null` = personal, un id = esa organización.
   */
  findAll(
    take: number,
    userId: string,
    cursor?: string,
    workspace?: { githubOrgId: string | null },
  ): Promise<ProjectWithAccess[]> {
    return this.prisma.project.findMany({
      where: { ...accessibleProject(userId), ...(workspace ? { githubOrgId: workspace.githubOrgId } : {}) },
      include: { access: { where: { userId } } },
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
   * Project no existe, no es visible para el usuario como Admin o ya estaba borrado
   * (mismo `404`); solo un Admin borra (HU63).
   */
  softDelete(id: string, userId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const marked = await tx.project.updateMany({
        where: { id, ...accessibleProject(userId, 'ADMIN') },
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
