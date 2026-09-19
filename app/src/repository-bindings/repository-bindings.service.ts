import { HttpStatus, Injectable } from '@nestjs/common';
import { RepositoryBindingsRepository } from './repository-bindings.repository.js';
import { GithubRepositoryAccessService } from './github/github-repository-access.service.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';

export interface CreateRepositoryBindingByOwnerInput {
  repositoryId: string;
  repositoryName: string;
  integrationBranch: string;
}

/**
 * HU30: CRUD del binding Project<->Repository. `create` resuelve
 * `installationId` server-side contra la GitHub App y exige que
 * `integrationBranch` exista entre las ramas reales del repositorio;
 * el navegador nunca aporta la instalación como autoridad.
 */
@Injectable()
export class RepositoryBindingsService {
  constructor(
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly projectsRepository: ProjectsRepository,
    private readonly githubRepositoryAccessService: GithubRepositoryAccessService,
  ) {}

  async create(
    projectId: string,
    input: CreateRepositoryBindingByOwnerInput,
    ownerUserId: string,
  ): Promise<RepositoryBinding> {
    await this.findProjectOrThrow(projectId, ownerUserId);

    const existing = await this.repositoryBindingsRepository.findByProjectForOwner(
      projectId,
      ownerUserId,
    );

    if (existing) {
      throw new AppException(
        ErrorCode.REPOSITORY_BINDING_ALREADY_EXISTS,
        `El proyecto "${projectId}" ya tiene un repositorio vinculado.`,
        HttpStatus.CONFLICT,
      );
    }

    const installationId = await this.githubRepositoryAccessService.requireInstallation(
      input.repositoryName,
    );
    const branches = await this.githubRepositoryAccessService.listBranches(
      input.repositoryName,
      installationId,
    );

    if (!branches.some((branch) => branch.name === input.integrationBranch)) {
      throw new AppException(
        ErrorCode.INTEGRATION_BRANCH_NOT_FOUND,
        `La rama "${input.integrationBranch}" no existe en "${input.repositoryName}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    return this.repositoryBindingsRepository.create(projectId, {
      installationId,
      repositoryId: input.repositoryId,
      repositoryName: input.repositoryName,
      integrationBranch: input.integrationBranch,
    });
  }

  async get(projectId: string, ownerUserId: string): Promise<RepositoryBinding> {
    return this.findBindingOrThrow(projectId, ownerUserId);
  }

  async disable(projectId: string, ownerUserId: string): Promise<RepositoryBinding> {
    const binding = await this.findBindingOrThrow(projectId, ownerUserId);
    return this.repositoryBindingsRepository.updateStatus(binding.id, 'DISABLED');
  }

  async enable(projectId: string, ownerUserId: string): Promise<RepositoryBinding> {
    const binding = await this.findBindingOrThrow(projectId, ownerUserId);
    return this.repositoryBindingsRepository.updateStatus(binding.id, 'ENABLED');
  }

  private async findProjectOrThrow(projectId: string, ownerUserId: string): Promise<void> {
    const project = await this.projectsRepository.findById(projectId, ownerUserId);

    if (!project) {
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `No existe un proyecto con id "${projectId}".`,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async findBindingOrThrow(
    projectId: string,
    ownerUserId: string,
  ): Promise<RepositoryBinding> {
    const binding = await this.repositoryBindingsRepository.findByProjectForOwner(
      projectId,
      ownerUserId,
    );

    if (!binding) {
      throw new AppException(
        ErrorCode.REPOSITORY_BINDING_NOT_FOUND,
        `El proyecto "${projectId}" no tiene un repositorio vinculado.`,
        HttpStatus.NOT_FOUND,
      );
    }

    return binding;
  }
}
