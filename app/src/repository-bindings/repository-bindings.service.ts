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
      throw this.bindingAlreadyExists(projectId);
    }

    const installationId = await this.githubRepositoryAccessService.requireInstallation(
      input.repositoryName,
    );

    // El `repositoryId` del cliente no es autoridad: se resuelve contra GitHub.
    const repositoryId = await this.githubRepositoryAccessService.resolveRepositoryId(
      input.repositoryName,
      installationId,
    );

    if (repositoryId !== input.repositoryId) {
      throw new AppException(
        ErrorCode.GITHUB_REPOSITORY_NOT_FOUND,
        `El repositorio "${input.repositoryName}" no corresponde al repositoryId indicado.`,
        HttpStatus.NOT_FOUND,
      );
    }

    const boundElsewhere = await this.repositoryBindingsRepository.findByRepositoryId(repositoryId);

    if (boundElsewhere) {
      throw this.repositoryAlreadyBound();
    }

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

    try {
      return await this.repositoryBindingsRepository.create(projectId, {
        installationId,
        repositoryId,
        repositoryName: input.repositoryName,
        integrationBranch: input.integrationBranch,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      // Carrera con otro POST: la violación de unicidad nunca sale como 500.
      const sameProject = await this.repositoryBindingsRepository.findByProjectForOwner(
        projectId,
        ownerUserId,
      );
      throw sameProject ? this.bindingAlreadyExists(projectId) : this.repositoryAlreadyBound();
    }
  }

  async get(projectId: string, ownerUserId: string): Promise<RepositoryBinding> {
    return this.findBindingOrThrow(projectId, ownerUserId);
  }

  /**
   * Desconectar es una pausa reversible (`DISABLED`, motivo `USER`). Sobre un
   * binding `REVOKED` no cambia nada: nunca se degrada a `DISABLED`.
   */
  async disable(projectId: string, ownerUserId: string): Promise<RepositoryBinding> {
    const binding = await this.findBindingOrThrow(projectId, ownerUserId);

    if (binding.status === 'REVOKED') {
      return binding;
    }

    return this.repositoryBindingsRepository.updateStatus(binding.id, 'DISABLED', 'USER');
  }

  /**
   * HU57: reactiva `DISABLED` y también `REVOKED`, siempre tras revalidar que
   * la App sigue teniendo acceso (sin acceso: 403 y el estado no cambia).
   * Idempotente: un binding ya `ENABLED` se devuelve sin revalidar.
   */
  async enable(projectId: string, ownerUserId: string): Promise<RepositoryBinding> {
    const binding = await this.findBindingOrThrow(projectId, ownerUserId);

    if (binding.status === 'ENABLED') {
      return binding;
    }

    const installationId = await this.githubRepositoryAccessService.requireInstallation(
      binding.repositoryName,
    );

    return this.repositoryBindingsRepository.reactivate(binding.id, installationId);
  }

  private bindingAlreadyExists(projectId: string): AppException {
    return new AppException(
      ErrorCode.REPOSITORY_BINDING_ALREADY_EXISTS,
      `El proyecto "${projectId}" ya tiene un repositorio vinculado.`,
      HttpStatus.CONFLICT,
    );
  }

  /** Mensaje genérico a propósito: no revela el Project ni el usuario que ya usa el repositorio. */
  private repositoryAlreadyBound(): AppException {
    return new AppException(
      ErrorCode.REPOSITORY_ALREADY_BOUND,
      'El repositorio ya está vinculado a otro proyecto.',
      HttpStatus.CONFLICT,
    );
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
