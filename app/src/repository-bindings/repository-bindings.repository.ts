import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  BindingDisabledReason,
  RepositoryBinding,
  RepositoryBindingStatus,
} from '../generated/prisma/client.js';
import { ownedProject } from '../common/persistence/owned-project.filter.js';

export interface CreateRepositoryBindingInput {
  installationId: string;
  repositoryId: string;
  repositoryName: string;
  integrationBranch: string;
}

@Injectable()
export class RepositoryBindingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(projectId: string, input: CreateRepositoryBindingInput): Promise<RepositoryBinding> {
    return this.prisma.repositoryBinding.create({
      data: {
        projectId,
        installationId: input.installationId,
        repositoryId: input.repositoryId,
        repositoryName: input.repositoryName,
        integrationBranch: input.integrationBranch,
      },
    });
  }

  findByProjectForOwner(
    projectId: string,
    ownerUserId: string,
  ): Promise<RepositoryBinding | null> {
    return this.prisma.repositoryBinding.findFirst({
      where: { projectId, project: ownedProject(ownerUserId) },
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
   */
  findByRepositoryId(repositoryId: string): Promise<RepositoryBinding | null> {
    return this.prisma.repositoryBinding.findUnique({ where: { repositoryId } });
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

  /**
   * HU31 (revocación): una instalación cubre potencialmente varios bindings
   * (uno por repositorio). `REVOKED` es más fuerte que cualquier otro estado:
   * `suspend`/`unsuspend` nunca lo tocan; solo el usuario lo reactiva
   * explícitamente (HU57) tras revalidar el acceso de la App.
   */
  async revokeByInstallation(installationId: string): Promise<void> {
    await this.prisma.repositoryBinding.updateMany({
      where: { installationId },
      data: { status: 'REVOKED', disabledReason: null },
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
}
