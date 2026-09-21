import { HttpStatus, Injectable } from '@nestjs/common';
import { RepositoryBindingsRepository } from './repository-bindings.repository.js';
import {
  GithubRepositoryAccessService,
  isSufficientRepositoryPermission,
} from './github/github-repository-access.service.js';
import { ProjectAccessService } from '../project-access/project-access.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Project, RepositoryBinding } from '../generated/prisma/client.js';

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
 *
 * HU64: `create` y `enable` sobre `REVOKED` validan propietario y permiso con la
 * identidad GitHub de la sesión. El propietario esperado es el workspace del Project:
 * la organización (`githubOrgId`) o, en un Project personal, la cuenta de su creador
 * (que es quien llama, el único que lo ve). HU60: vincular, pausar y reactivar exigen
 * Maintainer (que incluye a Admin); un Project sin repositorio o con binding `REVOKED`
 * solo lo ve un Admin, así que el primer vínculo y la reactivación de un `REVOKED` los
 * hace un Admin sin regla adicional.
 */
@Injectable()
export class RepositoryBindingsService {
  constructor(
    private readonly repositoryBindingsRepository: RepositoryBindingsRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly githubRepositoryAccessService: GithubRepositoryAccessService,
  ) {}

  /**
   * Orden de validación de `INTEROP-2.4` §6.8: Project no visible (404), rol menor que
   * Maintainer (403), binding existente (409), App sin acceso (403), repositorio inexistente, `repositoryId`
   * distinto o sin ningún permiso del usuario (404, un solo paso), propietario
   * ajeno (400), permiso `read`/`triage` (403), repositorio ya vinculado (409)
   * y rama inexistente (404). Las validaciones de propietario y permiso van
   * antes de `REPOSITORY_ALREADY_BOUND` para que nadie sondee repositorios ajenos.
   */
  async create(
    projectId: string,
    input: CreateRepositoryBindingByOwnerInput,
    userId: string,
    githubUserId: string,
  ): Promise<RepositoryBinding> {
    const { project } = await this.projectAccess.require(userId, projectId, 'MAINTAINER');

    const existing = await this.repositoryBindingsRepository.findByProjectForOwner(
      projectId,
      userId,
    );

    if (existing) {
      throw this.bindingAlreadyExists(projectId);
    }

    const installationId = await this.githubRepositoryAccessService.requireInstallation(
      input.repositoryName,
    );

    // El `repositoryId` del cliente no es autoridad: se resuelve contra GitHub.
    const owner = await this.githubRepositoryAccessService.requireRepositoryOwner(
      input.repositoryName,
      installationId,
    );

    if (owner.repositoryId !== input.repositoryId) {
      // Mismo 404 (código, HTTP y mensaje) que "no existe" y "sin permiso": no distingue los tres casos.
      throw this.githubRepositoryAccessService.repositoryNotFound(input.repositoryName);
    }

    const repositoryId = owner.repositoryId;
    const permission = await this.githubRepositoryAccessService.getUserPermission(
      input.repositoryName,
      installationId,
      githubUserId,
    );

    if (permission === 'NONE') {
      // Sin ningún permiso el caso colapsa aquí, antes de REPOSITORY_OUTSIDE_WORKSPACE.
      throw this.githubRepositoryAccessService.repositoryNotFound(input.repositoryName);
    }

    if (permission === 'APP_NOT_INSTALLED') {
      throw this.githubRepositoryAccessService.appAccessRequired(input.repositoryName);
    }

    // El propietario real del repositorio debe ser el workspace del Project: la organización o,
    // en un Project personal, la cuenta de su creador.
    if (owner.ownerId !== expectedOwnerId(project, githubUserId)) {
      throw this.githubRepositoryAccessService.outsideWorkspace();
    }

    if (!isSufficientRepositoryPermission(permission)) {
      throw this.githubRepositoryAccessService.permissionInsufficient();
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
        userId,
      );
      throw sameProject ? this.bindingAlreadyExists(projectId) : this.repositoryAlreadyBound();
    }
  }

  /** Reader basta: un Reader consulta el estado del binding aquí (no en `verify-app-access`). */
  async get(projectId: string, userId: string): Promise<RepositoryBinding> {
    await this.projectAccess.require(userId, projectId, 'READER');
    return this.findBindingOrThrow(projectId, userId);
  }

  /**
   * Desconectar es una pausa reversible (`DISABLED`, motivo `USER`). Sobre un
   * binding `REVOKED` no cambia nada: nunca se degrada a `DISABLED`.
   */
  async disable(projectId: string, userId: string): Promise<RepositoryBinding> {
    await this.projectAccess.require(userId, projectId, 'MAINTAINER');
    const binding = await this.findBindingOrThrow(projectId, userId);

    if (binding.status === 'REVOKED') {
      return binding;
    }

    return this.repositoryBindingsRepository.updateStatus(binding.id, 'DISABLED', 'USER');
  }

  /**
   * HU57: reactiva `DISABLED` y también `REVOKED`, siempre tras revalidar que
   * la App sigue teniendo acceso (sin acceso: 403 y el estado no cambia).
   * Idempotente: un binding ya `ENABLED` se devuelve sin revalidar.
   *
   * HU64: reactivar un `REVOKED` valida además el `repositoryId` y el
   * propietario (la organización del Project o la cuenta del creador) como `create`
   * (repositorio eliminado y recreado con el mismo nombre: 404; transferido fuera
   * del workspace: 400); en ambos casos sigue `REVOKED`. Un `REVOKED` solo lo ve un
   * Admin (predicado de acceso), que es quien lo reactiva.
   */
  async enable(projectId: string, userId: string, githubUserId: string): Promise<RepositoryBinding> {
    const { project } = await this.projectAccess.require(userId, projectId, 'MAINTAINER');
    const binding = await this.findBindingOrThrow(projectId, userId);

    if (binding.status === 'ENABLED') {
      return binding;
    }

    const installationId = await this.githubRepositoryAccessService.requireInstallation(
      binding.repositoryName,
    );

    if (binding.status === 'REVOKED') {
      const owner = await this.githubRepositoryAccessService.requireRepositoryOwner(
        binding.repositoryName,
        installationId,
      );

      if (owner.repositoryId !== binding.repositoryId) {
        throw this.githubRepositoryAccessService.repositoryNotFound(binding.repositoryName);
      }

      if (owner.ownerId !== expectedOwnerId(project, githubUserId)) {
        throw this.githubRepositoryAccessService.outsideWorkspace();
      }
    }

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

  private async findBindingOrThrow(
    projectId: string,
    userId: string,
  ): Promise<RepositoryBinding> {
    const binding = await this.repositoryBindingsRepository.findByProjectForOwner(
      projectId,
      userId,
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

/** Id de GitHub del propietario esperado del repositorio: la organización, o la cuenta del creador en un Project personal. */
function expectedOwnerId(project: Pick<Project, 'githubOrgId'>, githubUserId: string): string {
  return project.githubOrgId ?? githubUserId;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
