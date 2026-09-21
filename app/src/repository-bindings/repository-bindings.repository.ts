import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  BindingDisabledReason,
  Project,
  RepositoryBinding,
  RepositoryBindingStatus,
} from '../generated/prisma/client.js';
import { accessibleProject } from '../common/persistence/accessible-project.filter.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

export interface CreateRepositoryBindingInput {
  installationId: string;
  repositoryId: string;
  repositoryName: string;
  integrationBranch: string;
}

/** Binding con el workspace de su Project (lo que la reconciliación compara con el propietario del repositorio). */
export type BindingWithWorkspace = RepositoryBinding & {
  project: Pick<Project, 'id' | 'ownerUserId' | 'githubOrgId'>;
};

const WORKSPACE_SELECT = { id: true, ownerUserId: true, githubOrgId: true } as const;

@Injectable()
export class RepositoryBindingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HU56: el insert corre en una transacción que primero toma `FOR SHARE` sobre
   * el Project vivo. `ProjectsRepository.softDelete` actualiza esa misma fila,
   * así que un DELETE concurrente se serializa: o el binding se inserta antes
   * y el borrado lo elimina, o el Project ya está borrado y esto responde 404.
   * Sin esto un POST lento (3 llamadas a GitHub) podía dejar un binding
   * huérfano que retenía el `repositoryId` para siempre.
   */
  create(projectId: string, input: CreateRepositoryBindingInput): Promise<RepositoryBinding> {
    return this.prisma.$transaction(async (tx) => {
      const alive = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "projects" WHERE "id" = ${projectId} AND "deletedAt" IS NULL FOR SHARE
      `;

      if (alive.length === 0) {
        throw new AppException(
          ErrorCode.PROJECT_NOT_FOUND,
          `No existe un proyecto con id "${projectId}".`,
          HttpStatus.NOT_FOUND,
        );
      }

      return tx.repositoryBinding.create({
        data: {
          projectId,
          installationId: input.installationId,
          repositoryId: input.repositoryId,
          repositoryName: input.repositoryName,
          integrationBranch: input.integrationBranch,
        },
      });
    });
  }

  findByProjectForOwner(
    projectId: string,
    userId: string,
  ): Promise<RepositoryBinding | null> {
    return this.prisma.repositoryBinding.findFirst({
      where: { projectId, project: accessibleProject(userId) },
    });
  }

  /** `disabledReason` solo tiene sentido en `DISABLED`; en cualquier otro estado se limpia. */
  updateStatus(
    id: string,
    status: RepositoryBindingStatus,
    disabledReason: BindingDisabledReason = 'USER',
  ): Promise<RepositoryBinding> {
    return this.prisma.repositoryBinding.update({
      where: { id },
      data: { status, disabledReason: status === 'DISABLED' ? disabledReason : null },
    });
  }

  /** HU57: reactivación explícita; refresca la instalación resuelta por Core. */
  reactivate(id: string, installationId: string): Promise<RepositoryBinding> {
    return this.prisma.repositoryBinding.update({
      where: { id },
      data: { status: 'ENABLED', disabledReason: null, installationId },
    });
  }

  /**
   * Sin scope de owner: la usa el ingress de GitHub, que identifica el
   * binding por el repositoryId del webhook, no por un usuario autenticado.
   * HU56 (defensa en profundidad): un binding cuyo Project está borrado se
   * trata como inexistente, aunque el borrado ya elimina la fila.
   */
  findByRepositoryId(repositoryId: string): Promise<RepositoryBinding | null> {
    return this.prisma.repositoryBinding.findFirst({
      where: { repositoryId, project: { deletedAt: null } },
    });
  }

  /**
   * HU56: binding con el que un job puede operar sobre un Run. Exige que el
   * binding siga perteneciendo al Project del Run y que el Project no esté
   * borrado: así un repositorio re-vinculado a otro Project no procesa ni
   * publica Runs del Project anterior.
   */
  findForRun(run: { repositoryId: string; projectId: string }): Promise<RepositoryBinding | null> {
    return this.prisma.repositoryBinding.findFirst({
      where: { repositoryId: run.repositoryId, projectId: run.projectId, project: { deletedAt: null } },
    });
  }

  /** `installation.suspend`: solo pausa los `ENABLED`; no pisa `REVOKED` ni una pausa del usuario. */
  async suspendByInstallation(installationId: string): Promise<void> {
    await this.prisma.repositoryBinding.updateMany({
      where: { installationId, status: 'ENABLED' },
      data: { status: 'DISABLED', disabledReason: 'INSTALLATION_SUSPENDED' },
    });
  }

  /** `installation.unsuspend`: solo rehabilita lo que la suspensión deshabilitó, no lo pausado por el usuario. */
  async unsuspendByInstallation(installationId: string): Promise<void> {
    await this.prisma.repositoryBinding.updateMany({
      where: { installationId, status: 'DISABLED', disabledReason: 'INSTALLATION_SUSPENDED' },
      data: { status: 'ENABLED', disabledReason: null },
    });
  }

  /** Bindings de una instalación (los eventos `installation` afectan a todos los de ella). */
  findByInstallation(installationId: string): Promise<RepositoryBinding[]> {
    return this.prisma.repositoryBinding.findMany({ where: { installationId } });
  }

  /** Binding de un repositorio con el workspace de su Project (eventos `repository`). */
  findByRepositoryIdWithWorkspace(repositoryId: string): Promise<BindingWithWorkspace | null> {
    return this.prisma.repositoryBinding.findFirst({
      where: { repositoryId, project: { deletedAt: null } },
      include: { project: { select: WORKSPACE_SELECT } },
    });
  }

  /** HU61: el renombre de un repositorio solo actualiza `repositoryName`; el estado no cambia. */
  updateRepositoryName(id: string, repositoryName: string): Promise<RepositoryBinding> {
    return this.prisma.repositoryBinding.update({ where: { id }, data: { repositoryName } });
  }

  /**
   * Página (por id ascendente, tras `afterId`) de los bindings que la reconciliación
   * revalida: Projects vivos con binding no `REVOKED` (uno `REVOKED` ya perdió el acceso de
   * la App y solo un Admin lo reactiva con `enable`, que revalida).
   */
  findLiveForReconciliation(afterId: string | null, take: number): Promise<BindingWithWorkspace[]> {
    return this.prisma.repositoryBinding.findMany({
      where: {
        status: { not: 'REVOKED' },
        project: { deletedAt: null },
        ...(afterId === null ? {} : { id: { gt: afterId } }),
      },
      orderBy: { id: 'asc' },
      take,
      include: { project: { select: WORKSPACE_SELECT } },
    });
  }

  /**
   * Bindings `REVOKED` de Projects vivos que aún conservan registros Maintainer/Reader
   * (una revocación interrumpida a mitad): la reconciliación termina el borrado. El
   * predicado de acceso ya los deniega mientras tanto.
   */
  findRevokedWithLeftoverRecords(take: number): Promise<RepositoryBinding[]> {
    return this.prisma.repositoryBinding.findMany({
      where: {
        status: 'REVOKED',
        project: { deletedAt: null, access: { some: { role: { not: 'ADMIN' } } } },
      },
      take,
    });
  }
}
