import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionAuthService } from '../common/auth/session-auth.service.js';
import { InvalidTokenError } from '../common/auth/token-verifier.port.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import { issueGithubBindingEvidence } from '../repository-bindings/github-binding-evidence.js';
import type { GithubAuthorizationDecisionDto, GithubRepositoryFactDto } from './dto/github-authorization-decision.dto.js';

const ROLE_RANK = { READER: 1, MAINTAINER: 2, ADMIN: 3 } as const;
const BINDING_PERMISSIONS = new Set(['admin', 'maintain', 'write']);

export interface GithubAuthorizationDecision {
  decision: 'ALLOW' | 'DENY';
  repositoryOwnerId?: string;
  repositoryOwnerType?: 'User' | 'Organization';
  githubUserId?: string;
  authorizationEvidence?: string | null;
}

@Injectable()
export class GithubUiAuthorizationService {
  constructor(
    private readonly sessions: SessionAuthService,
    private readonly projects: ProjectAccessRepository,
    private readonly config: ConfigService,
  ) {}

  async decide(userToken: string, request: GithubAuthorizationDecisionDto): Promise<GithubAuthorizationDecision> {
    let identity;
    try {
      identity = await this.sessions.authenticate(userToken);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new AppException(ErrorCode.INVALID_ACCESS_TOKEN, 'El access token es inválido o expiró.', HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }

    if (request.action === 'VIEW_APP_INFO') return { decision: 'ALLOW' };
    if (!request.projectId) return { decision: 'DENY' };
    const bindingVerification = request.action === 'VERIFY_REPOSITORY_ACCESS' && request.githubUserId === undefined &&
      request.repositories === undefined && !!request.repositoryId && !!request.repositoryName;
    if (request.githubUserId !== identity.githubUserId && !bindingVerification) return { decision: 'DENY' };

    const project = await this.projects.findLiveForGithubAuthorization(request.projectId, identity.userId);
    if (!project) {
      throw new AppException(ErrorCode.PROJECT_NOT_FOUND, 'El proyecto solicitado no existe.', HttpStatus.NOT_FOUND);
    }

    const role = roleForUser(project, identity.userId);
    const minimumRole = request.action === 'DISCOVER_REPOSITORIES' ? 'READER' : 'MAINTAINER';
    if (!role || ROLE_RANK[role] < ROLE_RANK[minimumRole]) return { decision: 'DENY' };

    const repositoryOwnerId = project.githubOrgId ?? identity.githubUserId;
    const repositoryOwnerType = project.githubOrgId === null ? 'User' : 'Organization';

    const facts = request.repositories ?? [];
    if (request.action === 'DISCOVER_REPOSITORIES') {
      return {
        decision: 'ALLOW',
        repositoryOwnerId,
        repositoryOwnerType,
      };
    }

    if (facts.length === 0) {
      if (bindingVerification) {
        const binding = project.repositoryBinding;
        if (!binding || binding.repositoryId !== request.repositoryId || binding.repositoryName !== request.repositoryName) return { decision: 'DENY' };
        return { decision: 'ALLOW', repositoryOwnerId, repositoryOwnerType, githubUserId: identity.githubUserId };
      }
      return { decision: 'ALLOW', repositoryOwnerId, repositoryOwnerType };
    }
    if (facts.length !== 1) return { decision: 'DENY' };
    const fact = facts[0];
    if (!repositoryMatchesProject(project, identity.githubUserId, fact)) return { decision: 'DENY' };

    if (request.action === 'VERIFY_REPOSITORY_ACCESS') {
      if (!request.integrationBranch) return { decision: 'ALLOW', repositoryOwnerId, repositoryOwnerType, authorizationEvidence: null };
      if (!hasVerifiedBindingAccess(project, fact)) return { decision: 'DENY' };

      const secret = this.config.get<string>('GITHUB_BINDING_EVIDENCE_SECRET');
      if (!secret || secret.length < 32 || /\s/.test(secret)) {
        throw new AppException(
          ErrorCode.GITHUB_INTEGRATION_UNAVAILABLE,
          'La autorización de GitHub no está configurada.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      return {
        decision: 'ALLOW',
        repositoryOwnerId,
        repositoryOwnerType,
        authorizationEvidence: issueGithubBindingEvidence(secret, {
          sub: identity.userId,
          githubUserId: identity.githubUserId,
          projectId: project.id,
          repositoryId: fact.repositoryId,
          repositoryName: fact.repositoryName,
          ownerId: fact.ownerId,
          installationId: fact.installationId as string,
          integrationBranch: request.integrationBranch,
        }),
      };
    }

    return hasVerifiedBindingAccess(project, fact) ? { decision: 'ALLOW', repositoryOwnerId, repositoryOwnerType } : { decision: 'DENY' };
  }
}

function roleForUser(project: NonNullable<Awaited<ReturnType<ProjectAccessRepository['findLiveForGithubAuthorization']>>>, userId: string): 'ADMIN' | 'MAINTAINER' | 'READER' | null {
  if (project.githubOrgId === null) return project.ownerUserId === userId ? 'ADMIN' : null;
  const role = project.access[0]?.role;
  if (role === 'ADMIN') return role;
  if (role && project.repositoryBinding?.status !== 'REVOKED') return role;
  return null;
}

function repositoryMatchesProject(
  project: NonNullable<Awaited<ReturnType<ProjectAccessRepository['findLiveForGithubAuthorization']>>>,
  githubUserId: string,
  fact: GithubRepositoryFactDto,
): boolean {
  if (project.githubOrgId !== null) {
    return fact.ownerType === 'Organization' && fact.ownerId === project.githubOrgId &&
      (!fact.organizationMembership || fact.organizationMembership.state === 'active');
  }
  return project.ownerUserId !== null && fact.ownerType === 'User' && fact.ownerId === githubUserId;
}

function hasVerifiedBindingAccess(
  project: NonNullable<Awaited<ReturnType<ProjectAccessRepository['findLiveForGithubAuthorization']>>>,
  fact: GithubRepositoryFactDto,
): boolean {
  return fact.installationActive && !!fact.installationId && BINDING_PERMISSIONS.has(fact.permission) &&
    (project.githubOrgId === null || fact.organizationMembership?.state === 'active');
}
