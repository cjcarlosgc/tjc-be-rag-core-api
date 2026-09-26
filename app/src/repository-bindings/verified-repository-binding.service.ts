import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { ProjectRole } from '../generated/prisma/client.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import { verifyGithubBindingEvidence } from './github-binding-evidence.js';
import { RepositoryBindingsRepository } from './repository-bindings.repository.js';
import type { CreateVerifiedRepositoryBindingDto } from './dto/create-verified-repository-binding.dto.js';

@Injectable()
export class VerifiedRepositoryBindingService {
  constructor(
    private readonly projects: ProjectAccessRepository,
    private readonly bindings: RepositoryBindingsRepository,
    private readonly config: ConfigService,
  ) {}

  async create(projectId: string, input: CreateVerifiedRepositoryBindingDto, userId: string, githubUserId: string) {
    const secret = this.config.get<string>('GITHUB_BINDING_EVIDENCE_SECRET');
    if (!secret || secret.length < 32 || /\s/.test(secret)) {
      throw new AppException(
        ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE,
        'La autorización de GitHub no está configurada.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const claims = verifyGithubBindingEvidence(secret, input.authorizationEvidence);
    if (!claims || claims.sub !== userId || claims.githubUserId !== githubUserId ||
      claims.projectId !== projectId || claims.repositoryId !== input.repositoryId ||
      claims.repositoryName !== input.repositoryName || claims.integrationBranch !== input.integrationBranch) {
      throw new AppException(ErrorCode.INVALID_REQUEST, 'La evidencia de autorización expiró o no corresponde a esta vinculación.', HttpStatus.BAD_REQUEST);
    }

    const project = await this.projects.findLiveForGithubAuthorization(projectId, userId);
    if (!project) {
      throw new AppException(ErrorCode.PROJECT_NOT_FOUND, `El proyecto "${projectId}" no existe.`, HttpStatus.NOT_FOUND);
    }

    const role = project.githubOrgId === null
      ? project.ownerUserId === userId ? 'ADMIN' : null
      : project.access[0]?.role ?? null;
    if (!role || !hasMaintainerRole(role, project.repositoryBinding?.status)) {
      throw new AppException(ErrorCode.PROJECT_ROLE_INSUFFICIENT, 'Se requiere el rol Maintainer o Admin para vincular el repositorio.', HttpStatus.FORBIDDEN);
    }

    const expectedOwnerId = project.githubOrgId ?? githubUserId;
    if (claims.ownerId !== expectedOwnerId || !claims.installationId) {
      throw new AppException(ErrorCode.INVALID_REQUEST, 'La evidencia de autorización no corresponde al workspace del proyecto.', HttpStatus.BAD_REQUEST);
    }

    if (await this.bindings.findByProjectId(projectId)) {
      throw new AppException(ErrorCode.REPOSITORY_BINDING_ALREADY_EXISTS, `El proyecto "${projectId}" ya tiene un repositorio vinculado.`, HttpStatus.CONFLICT);
    }
    if (await this.bindings.findByRepositoryId(input.repositoryId)) {
      throw new AppException(ErrorCode.REPOSITORY_ALREADY_BOUND, 'El repositorio ya está vinculado a otro proyecto.', HttpStatus.CONFLICT);
    }

    try {
      return await this.bindings.create(projectId, {
        installationId: claims.installationId,
        repositoryId: input.repositoryId,
        repositoryName: input.repositoryName,
        integrationBranch: input.integrationBranch,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const sameProject = await this.bindings.findByProjectId(projectId);
        throw new AppException(
          sameProject ? ErrorCode.REPOSITORY_BINDING_ALREADY_EXISTS : ErrorCode.REPOSITORY_ALREADY_BOUND,
          sameProject ? `El proyecto "${projectId}" ya tiene un repositorio vinculado.` : 'El repositorio ya está vinculado a otro proyecto.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }
}

function hasMaintainerRole(role: ProjectRole, bindingStatus: string | undefined): boolean {
  return (role === 'ADMIN' || role === 'MAINTAINER') && (role === 'ADMIN' || bindingStatus !== 'REVOKED');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
