import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';
import type { Project, ProjectAccess, ProjectRole, RepositoryBinding } from '../generated/prisma/client.js';
import { ACCESS_LOCK_MAX_WAIT_MS, ACCESS_LOCK_TIMEOUT_MS } from './project-access.constants.js';

export type ProjectWithBinding = Project & { repositoryBinding: RepositoryBinding | null };

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
}

export interface RegisteredOrganization {
  organizationId: string;
  /** `githubOrgLogin` guardado: solo presentación. */
  login: string;
  /** `true` si el usuario tiene algún registro `ADMIN` en la organización. */
  hasAdmin: boolean;
}

@Injectable()
export class ProjectAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Project visible para `userId` (predicado `accessibleProject`) con su registro de acceso. */
  findVisible(projectId: string, userId: string): Promise<ProjectWithAccess | null> {
    return this.prisma.project.findFirst({
      where: { id: projectId, ...accessibleProject(userId) },
      include: { access: { where: { userId } } },
    });
  }

  /** Project vivo (no borrado) sin filtro de usuario: solo para decidir si aplica una verificación viva. */
  findLive(projectId: string): Promise<Project | null> {
    return this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null } });
  }

  /**
   * Serializa con UN advisory lock transaccional por `(projectId, userId)` el alta, las
   * reverificaciones y las revocaciones de un mismo registro (`DEC-ORG-002` (t)). El lock
   * se libera al terminar la transacción. Retiene una conexión de base de datos durante
   * las llamadas a GitHub del callback, acotado por el presupuesto de verificaciones.
   */
  withAccessLock<T>(projectId: string, userId: string, work: (scope: AccessLockScope) => Promise<T>): Promise<T> {
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
          findRecord: () => tx.projectAccess.findUnique({ where: { projectId_userId: { projectId, userId } } }),
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
  async findRegisteredOrganizations(userId: string): Promise<RegisteredOrganization[]> {
    const rows = await this.prisma.project.findMany({
      where: { AND: [accessibleProject(userId), { githubOrgId: { not: null } }] },
      select: { githubOrgId: true, githubOrgLogin: true, access: { where: { userId }, select: { role: true } } },
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
    if (adminOrganizationIds.length === 0 && memberOrganizationIds.length === 0) {
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
