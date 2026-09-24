import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';
import type {
  Project,
  ProjectAccess,
  ProjectRole,
  RepositoryBinding,
  RepositoryBindingStatus,
} from '../generated/prisma/client.js';
import {
  ACCESS_LOCK_MAX_WAIT_MS,
  ACCESS_LOCK_TIMEOUT_MS,
} from './project-access.constants.js';
import type { ProjectResourceKind } from './project-access.errors.js';

export type ProjectWithBinding = Project & {
  repositoryBinding: RepositoryBinding | null;
};

/** Project visible para el usuario, con su registro de acceso (0..1 fila; un Project personal no tiene). */
export type ProjectWithAccess = Project & { access: ProjectAccess[] };

/**
 * Vista del alcance de UN `(projectId, userId)` mientras se sostiene su advisory lock
 * transaccional: las lecturas y escrituras van por la misma transacción, así que una
 * verificación viva y el upsert del registro no pueden intercalarse con una revocación.
 */
export interface AccessLockScope {
  findProject(): Promise<ProjectWithBinding | null>;
  findRecord(): Promise<ProjectAccess | null>;
  upsertRecord(role: ProjectRole): Promise<ProjectAccess>;
  deleteRecord(): Promise<void>;
  /**
   * Estado actual del binding del Project leído con `FOR SHARE`: una transición concurrente a
   * `REVOKED` (evento `repository`/`installation`, reconciliación) espera a que esta
   * transacción termine, y una ya confirmada se ve aquí. `null` = sin binding.
   */
  lockBindingStatus(): Promise<RepositoryBindingStatus | null>;
}

/** Par `(Project, usuario)` de un registro de acceso que una reverificación recalcula. */
export interface AccessRecordKey {
  projectId: string;
  userId: string;
}

/**
 * Selección de registros a reverificar (`INTEROP-2.4` §6.9): siempre Projects de organización
 * vivos. `userId` acota a un usuario; `repositoryId`, a los Projects vinculados a ese repositorio;
 * `organizationId`, a los de esa organización (`withRepositoryOnly`: solo los que tienen
 * repositorio vinculado, porque el rol de un Project sin repositorio solo es Admin y no depende
 * de Teams ni de permisos de repositorio); `projectId`, a uno solo.
 */
export interface AccessRecordFilter {
  userId?: string;
  repositoryId?: string;
  organizationId?: string;
  withRepositoryOnly?: boolean;
  projectId?: string;
}

export interface RegisteredOrganization {
  organizationId: string;
  /** `githubOrgLogin` guardado: solo presentación. */
  login: string;
  /** `true` si el usuario tiene algún registro `ADMIN` en la organización. */
  hasAdmin: boolean;
}

/** `where` de los Projects de organización vivos que señala un filtro (sin los campos `userId`/`projectId`, propios del registro). */
function liveOrganizationProjects(filter: AccessRecordFilter) {
  return {
    deletedAt: null,
    githubOrgId: filter.organizationId ?? { not: null },
    ...(filter.repositoryId !== undefined
      ? { repositoryBinding: { is: { repositoryId: filter.repositoryId } } }
      : filter.withRepositoryOnly
        ? { repositoryBinding: { isNot: null } }
        : {}),
  };
}

@Injectable()
export class ProjectAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Project visible para `userId` (predicado `accessibleProject`) con su registro de acceso. */
  findVisible(
    projectId: string,
    userId: string,
  ): Promise<ProjectWithAccess | null> {
    return this.prisma.project.findFirst({
      where: { id: projectId, ...accessibleProject(userId) },
      include: { access: { where: { userId } } },
    });
  }

  /** Usuarios con registro Maintainer o Reader (no Admin) sobre el Project: los que borra un binding `REVOKED`. */
  async findNonAdminUserIds(projectId: string): Promise<string[]> {
    const records = await this.prisma.projectAccess.findMany({
      where: { projectId, role: { not: 'ADMIN' } },
      select: { userId: true },
    });

    return records.map((record) => record.userId);
  }

  /** Todos los usuarios con registro (Admin incluido) sobre el Project: los que borra ocultar la organización. */
  async findAllUserIds(projectId: string): Promise<string[]> {
    const records = await this.prisma.projectAccess.findMany({
      where: { projectId },
      select: { userId: true },
    });

    return records.map((record) => record.userId);
  }

  /** Registros de acceso a reverificar según `filter` (siempre Projects de organización vivos). */
  async findRecords(filter: AccessRecordFilter): Promise<AccessRecordKey[]> {
    const rows = await this.prisma.projectAccess.findMany({
      where: {
        ...(filter.userId === undefined ? {} : { userId: filter.userId }),
        ...(filter.projectId === undefined
          ? {}
          : { projectId: filter.projectId }),
        project: liveOrganizationProjects(filter),
      },
      select: { projectId: true, userId: true },
    });

    return rows.map((row) => ({
      projectId: row.projectId,
      userId: row.userId,
    }));
  }

  /**
   * Projects de organización vivos que `filter` señala, con o sin registros. Los eventos de UN
   * usuario reverifican por `(Project, usuario)` sobre estos Projects, no solo sobre sus registros
   * existentes: así una reverificación se serializa (advisory lock) DESPUÉS de un alta en vuelo
   * de ese usuario, que aún no ha creado su registro, y la verifica en vivo.
   */
  async findCandidateProjectIds(filter: AccessRecordFilter): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: liveOrganizationProjects(filter),
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }

  /** ¿Hay Projects de organización vivos vinculados a este repositorio? (los eventos de otros repositorios no encolan nada). */
  async hasLiveOrganizationProjectForRepository(
    repositoryId: string,
  ): Promise<boolean> {
    const count = await this.prisma.project.count({
      where: {
        deletedAt: null,
        githubOrgId: { not: null },
        repositoryBinding: { is: { repositoryId } },
      },
    });

    return count > 0;
  }

  /** Ids de los Projects vivos de la organización (con o sin repositorio). */
  async findLiveProjectIdsOfOrganization(
    organizationId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: { deletedAt: null, githubOrgId: organizationId },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }

  /** `organization.renamed`: el `login` guardado es solo presentación (los accesos se verifican por id). */
  async updateOrganizationLogin(
    organizationId: string,
    login: string,
  ): Promise<void> {
    await this.prisma.project.updateMany({
      where: { githubOrgId: organizationId },
      data: { githubOrgLogin: login },
    });
  }

  /** Organizaciones (id y login guardado) con al menos un Project vivo que tiene registros de acceso: la parte (a) de la reconciliación. */
  async findOrganizationsWithRecords(): Promise<
    Array<{ organizationId: string; login: string | null }>
  > {
    const rows = await this.prisma.project.findMany({
      where: {
        deletedAt: null,
        githubOrgId: { not: null },
        access: { some: {} },
      },
      select: { githubOrgId: true, githubOrgLogin: true },
    });
    const organizations = new Map<string, string | null>();

    for (const row of rows) {
      if (row.githubOrgId !== null) {
        organizations.set(row.githubOrgId, row.githubOrgLogin);
      }
    }

    return [...organizations].map(([organizationId, login]) => ({
      organizationId,
      login,
    }));
  }

  /** Página (por id ascendente, tras `afterProjectId`) de Projects de organización vivos con registros: la parte (b) de la reconciliación. */
  async findProjectIdsWithRecords(
    afterProjectId: string | null,
    take: number,
  ): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        deletedAt: null,
        githubOrgId: { not: null },
        access: { some: {} },
        ...(afterProjectId === null ? {} : { id: { gt: afterProjectId } }),
      },
      orderBy: { id: 'asc' },
      take,
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }

  /** Project vivo (no borrado) sin filtro de usuario: solo para decidir si aplica una verificación viva. */
  findLive(projectId: string): Promise<Project | null> {
    return this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
    });
  }

  /**
   * `projectId` del Project dueño de un recurso descendiente, SIN filtro de visibilidad: el
   * alta por deep link necesita el Project para verificar el acceso del usuario en vivo
   * antes de que las consultas con `accessibleProject` puedan encontrar el recurso. Solo
   * devuelve el id; nunca el recurso. `null` si el recurso no existe.
   */
  async findProjectIdOf(
    resource: Exclude<ProjectResourceKind, 'project'>,
    id: string,
  ): Promise<string | null> {
    switch (resource) {
      case 'analysisRun':
        return (
          (
            await this.prisma.analysisRun.findUnique({
              where: { id },
              select: { projectId: true },
            })
          )?.projectId ?? null
        );
      case 'projectVersion':
        return (
          (
            await this.prisma.projectVersion.findUnique({
              where: { id },
              select: { projectId: true },
            })
          )?.projectId ?? null
        );
      case 'experiment':
        return (
          (
            await this.prisma.experimentRun.findUnique({
              where: { id },
              select: { projectId: true },
            })
          )?.projectId ?? null
        );
      case 'contextTrace':
        return (
          (
            await this.prisma.contextTrace.findUnique({
              where: { id },
              select: { experiment: { select: { projectId: true } } },
            })
          )?.experiment.projectId ?? null
        );
      case 'functionalQuestion':
        return (
          (
            await this.prisma.functionalQuestion.findUnique({
              where: { id },
              select: { projectId: true },
            })
          )?.projectId ?? null
        );
      case 'testPublication':
        return (
          (
            await this.prisma.testPublication.findUnique({
              where: { id },
              select: { analysisRun: { select: { projectId: true } } },
            })
          )?.analysisRun.projectId ?? null
        );
      case 'testTarget':
        return (
          (
            await this.prisma.testTarget.findUnique({
              where: { id },
              select: { projectVersion: { select: { projectId: true } } },
            })
          )?.projectVersion.projectId ?? null
        );
    }
  }

  /**
   * Serializa con UN advisory lock transaccional por `(projectId, userId)` el alta, las
   * reverificaciones y las revocaciones de un mismo registro (`DEC-ORG-002` (t)). El lock
   * se libera al terminar la transacción. Retiene una conexión de base de datos durante
   * las llamadas a GitHub del callback, acotado por el presupuesto de verificaciones.
   */
  withAccessLock<T>(
    projectId: string,
    userId: string,
    work: (scope: AccessLockScope) => Promise<T>,
  ): Promise<T> {
    const lockKey = `project_access:${projectId}:${userId}`;

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`;

        return work({
          findProject: () =>
            tx.project.findFirst({
              where: { id: projectId, deletedAt: null },
              include: { repositoryBinding: true },
            }),
          findRecord: () =>
            tx.projectAccess.findUnique({
              where: { projectId_userId: { projectId, userId } },
            }),
          upsertRecord: (role) => {
            const verifiedAt = new Date();
            return tx.projectAccess.upsert({
              where: { projectId_userId: { projectId, userId } },
              create: { projectId, userId, role, verifiedAt },
              update: { role, verifiedAt },
            });
          },
          deleteRecord: async () => {
            await tx.projectAccess.deleteMany({ where: { projectId, userId } });
          },
          lockBindingStatus: async () => {
            const rows = await tx.$queryRaw<
              Array<{ status: RepositoryBindingStatus }>
            >`
              SELECT "status" FROM "repository_bindings" WHERE "projectId" = ${projectId} FOR SHARE
            `;
            return rows[0]?.status ?? null;
          },
        });
      },
      { maxWait: ACCESS_LOCK_MAX_WAIT_MS, timeout: ACCESS_LOCK_TIMEOUT_MS },
    );
  }

  /**
   * Organizaciones donde `userId` ya ve algún Project por su registro de acceso (o es su
   * Admin): el respaldo de `GET /workspaces` ante una caída de GitHub. Los Projects
   * personales no cuentan.
   */
  async findRegisteredOrganizations(
    userId: string,
  ): Promise<RegisteredOrganization[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        AND: [accessibleProject(userId), { githubOrgId: { not: null } }],
      },
      select: {
        githubOrgId: true,
        githubOrgLogin: true,
        access: { where: { userId }, select: { role: true } },
      },
    });
    const organizations = new Map<string, RegisteredOrganization>();

    for (const row of rows) {
      if (row.githubOrgId === null || row.githubOrgLogin === null) {
        continue;
      }
      const current = organizations.get(row.githubOrgId) ?? {
        organizationId: row.githubOrgId,
        login: row.githubOrgLogin,
        hasAdmin: false,
      };
      current.hasAdmin ||= row.access.some((record) => record.role === 'ADMIN');
      organizations.set(row.githubOrgId, current);
    }

    return [...organizations.values()];
  }

  /**
   * Projects vivos de organizaciones del usuario que hoy NO ve (sin registro suficiente),
   * los candidatos del alta de `GET /projects`. En una organización donde es solo
   * miembro un Project sin repositorio o con binding `REVOKED` solo lo ve un Admin, así
   * que no se verifica (ahorra presupuesto; la verificación sigue decidiendo).
   */
  async findUnseenOrganizationProjects(
    userId: string,
    adminOrganizationIds: string[],
    memberOrganizationIds: string[],
    take: number,
  ): Promise<Array<Pick<Project, 'id' | 'githubOrgId'>>> {
    if (
      adminOrganizationIds.length === 0 &&
      memberOrganizationIds.length === 0
    ) {
      return [];
    }

    return this.prisma.project.findMany({
      where: {
        deletedAt: null,
        NOT: accessibleProject(userId),
        OR: [
          { githubOrgId: { in: adminOrganizationIds } },
          {
            githubOrgId: { in: memberOrganizationIds },
            repositoryBinding: { is: { status: { not: 'REVOKED' } } },
          },
        ],
      },
      select: { id: true, githubOrgId: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }
}
