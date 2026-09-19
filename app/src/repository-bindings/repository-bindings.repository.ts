import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RepositoryBinding, RepositoryBindingStatus } from '../generated/prisma/client.js';

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
      where: { projectId, project: { ownerUserId } },
    });
  }

  updateStatus(id: string, status: RepositoryBindingStatus): Promise<RepositoryBinding> {
    return this.prisma.repositoryBinding.update({ where: { id }, data: { status } });
  }

  /**
   * Sin scope de owner: la usa el ingress de GitHub, que identifica el
   * binding por el repositoryId del webhook, no por un usuario autenticado.
   */
  findByRepositoryId(repositoryId: string): Promise<RepositoryBinding | null> {
    return this.prisma.repositoryBinding.findUnique({ where: { repositoryId } });
  }

  /**
   * HU31 (revocación): una instalación cubre potencialmente varios bindings
   * (uno por repositorio). `ENABLED` nunca reactiva un binding `REVOKED`
   * -`REVOKED` es más fuerte que un `unsuspend` de la instalación completa,
   * ya sea porque la App se desinstaló (`installation.deleted`) o porque
   * GitHub retiró el acceso a ese repo puntual
   * (`installation_repositories.removed`)-.
   */
  async updateStatusByInstallation(installationId: string, status: RepositoryBindingStatus): Promise<void> {
    await this.prisma.repositoryBinding.updateMany({
      where: { installationId, ...(status === 'ENABLED' ? { status: { not: 'REVOKED' } } : {}) },
      data: { status },
    });
  }
}
