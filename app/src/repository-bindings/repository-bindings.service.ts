import { HttpStatus, Injectable } from '@nestjs/common';
import {
  RepositoryBindingsRepository,
  type CreateRepositoryBindingInput,
} from './repository-bindings.repository.js';
import { ProjectsRepository } from '../projects/projects.repository.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { RepositoryBinding } from '../generated/prisma/client.js';

/**
 * HU30 (dominio): CRUD del binding Project<->Repository ya validado.
 * Sin controller/HTTP todavía: la sesión de instalación y el callback reales
 * contra la GitHub App llegan con el corte de GitHub ingress.
 */
@Injectable()
export class RepositoryBindingsService {
  constructor(
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly projectsRepository: ProjectsRepository,
  ) {}

  async create(
    projectId: string,
    input: CreateRepositoryBindingInput,
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

    return this.repositoryBindingsRepository.create(projectId, input);
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
