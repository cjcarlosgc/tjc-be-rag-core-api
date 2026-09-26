import { describe, expect, it, vi } from 'vitest';
import { verifyGithubBindingEvidence } from '../repository-bindings/github-binding-evidence.js';
import { GithubUiAuthorizationService } from './github-ui-authorization.service.js';
import type { GithubAuthorizationDecisionDto } from './dto/github-authorization-decision.dto.js';

const evidenceSecret = 'test-only-github-binding-evidence-secret';
const identity = { userId: 'platform-user-1', githubUserId: '123' };

function setup(project: Record<string, unknown> | null) {
  const sessions = { authenticate: vi.fn().mockResolvedValue(identity) };
  const projects = { findLiveForGithubAuthorization: vi.fn().mockResolvedValue(project) };
  const config = { get: vi.fn((key: string) => key === 'GITHUB_BINDING_EVIDENCE_SECRET' ? evidenceSecret : undefined) };
  return {
    service: new GithubUiAuthorizationService(sessions as never, projects as never, config as never),
    sessions,
    projects,
  };
}

function organizationProject(role: 'ADMIN' | 'MAINTAINER' | 'READER' = 'ADMIN') {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    ownerUserId: null,
    githubOrgId: '99',
    access: [{ role }],
    repositoryBinding: null,
  };
}

const fact = {
  repositoryId: '456', repositoryName: 'acme/repo', ownerId: '99', ownerType: 'Organization' as const,
  permission: 'write' as const, installationId: '55', installationActive: true,
  organizationMembership: { state: 'active' as const, role: 'admin' as const },
};

describe('GitHub UI authorization decisions', () => {
  it('validates the platform session for App information without looking up a Project', async () => {
    const { service, projects } = setup(null);
    await expect(service.decide('jwt', { action: 'VIEW_APP_INFO' } as GithubAuthorizationDecisionDto)).resolves.toEqual({ decision: 'ALLOW' });
    expect(projects.findLiveForGithubAuthorization).not.toHaveBeenCalled();
  });

  it('limits discovery to the local Project workspace and denies a mismatched GitHub identity', async () => {
    const { service } = setup({ ...organizationProject(), repositoryBinding: { status: 'ENABLED' } });
    await expect(service.decide('jwt', {
      action: 'DISCOVER_REPOSITORIES', projectId: '10000000-0000-4000-8000-000000000001', githubUserId: '123',
    } as GithubAuthorizationDecisionDto)).resolves.toMatchObject({
      decision: 'ALLOW', repositoryOwnerId: '99', repositoryOwnerType: 'Organization',
    });
    await expect(service.decide('jwt', {
      action: 'DISCOVER_REPOSITORIES', projectId: '10000000-0000-4000-8000-000000000001', githubUserId: '999',
    } as GithubAuthorizationDecisionDto)).resolves.toEqual({ decision: 'DENY' });
  });

  it('issues a short-lived evidence token only for an authorized repo, active App, permission, and verified branch', async () => {
    const { service } = setup(organizationProject());
    const result = await service.decide('jwt', {
      action: 'VERIFY_REPOSITORY_ACCESS', projectId: '10000000-0000-4000-8000-000000000001',
      githubUserId: '123', repositories: [fact], integrationBranch: 'main',
    } as GithubAuthorizationDecisionDto);
    expect(result.decision).toBe('ALLOW');
    const claims = verifyGithubBindingEvidence(evidenceSecret, result.authorizationEvidence as string);
    expect(claims).toMatchObject({
      sub: identity.userId, githubUserId: identity.githubUserId, projectId: '10000000-0000-4000-8000-000000000001',
      repositoryId: '456', repositoryName: 'acme/repo', installationId: '55', integrationBranch: 'main',
    });

    const denied = await service.decide('jwt', {
      action: 'VERIFY_REPOSITORY_ACCESS', projectId: '10000000-0000-4000-8000-000000000001',
      githubUserId: '123', repositories: [{ ...fact, ownerId: '100' }], integrationBranch: 'main',
    } as GithubAuthorizationDecisionDto);
    expect(denied).toEqual({ decision: 'DENY' });
  });

  it('returns Core’s validated identity only for a repository already bound to the authorized Project', async () => {
    const project = { ...organizationProject('MAINTAINER'), repositoryBinding: { status: 'ENABLED', repositoryId: '456', repositoryName: 'acme/repo' } };
    const { service } = setup(project);
    await expect(service.decide('jwt', {
      action: 'VERIFY_REPOSITORY_ACCESS', projectId: '10000000-0000-4000-8000-000000000001',
      repositoryId: '456', repositoryName: 'acme/repo',
    } as GithubAuthorizationDecisionDto)).resolves.toMatchObject({ decision: 'ALLOW', githubUserId: '123', repositoryOwnerId: '99' });
    await expect(service.decide('jwt', {
      action: 'VERIFY_REPOSITORY_ACCESS', projectId: '10000000-0000-4000-8000-000000000001',
      repositoryId: '457', repositoryName: 'acme/other',
    } as GithubAuthorizationDecisionDto)).resolves.toEqual({ decision: 'DENY' });
  });
});
