import { describe, expect, it, vi } from 'vitest';
import { issueGithubBindingEvidence } from './github-binding-evidence.js';
import { VerifiedRepositoryBindingService } from './verified-repository-binding.service.js';

const secret = 'test-only-github-binding-evidence-secret';
const projectId = '10000000-0000-4000-8000-000000000001';

function setup() {
  const project = {
    id: projectId, ownerUserId: 'user-1', githubOrgId: null,
    access: [], repositoryBinding: null,
  };
  const projects = { findLiveForGithubAuthorization: vi.fn().mockResolvedValue(project) };
  const bindings = {
    findByProjectId: vi.fn().mockResolvedValue(null),
    findByRepositoryId: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'binding-1', projectId, repositoryId: '456', repositoryName: 'octo/repo' }),
  };
  const config = { get: vi.fn((key: string) => key === 'GITHUB_BINDING_EVIDENCE_SECRET' ? secret : undefined) };
  return {
    service: new VerifiedRepositoryBindingService(projects as never, bindings as never, config as never),
    projects,
    bindings,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  const authorizationEvidence = issueGithubBindingEvidence(secret, {
    sub: 'user-1', githubUserId: '123', projectId, repositoryId: '456', repositoryName: 'octo/repo',
    ownerId: '123', installationId: '55', integrationBranch: 'main',
  });
  return { repositoryId: '456', repositoryName: 'octo/repo', integrationBranch: 'main', authorizationEvidence, ...overrides } as never;
}

describe('VerifiedRepositoryBindingService', () => {
  it('persists only the installation and scope bound into valid Core-signed evidence', async () => {
    const { service, bindings } = setup();
    await expect(service.create(projectId, body(), 'user-1', '123')).resolves.toMatchObject({ repositoryId: '456' });
    expect(bindings.create).toHaveBeenCalledWith(projectId, {
      installationId: '55', repositoryId: '456', repositoryName: 'octo/repo', integrationBranch: 'main',
    });
  });

  it('rejects a proof scoped to a different branch or user before persistence', async () => {
    const { service, bindings } = setup();
    await expect(service.create(projectId, body({ integrationBranch: 'develop' }), 'user-1', '123')).rejects.toMatchObject({ status: 400 });
    await expect(service.create(projectId, body(), 'other-user', '123')).rejects.toMatchObject({ status: 400 });
    expect(bindings.create).not.toHaveBeenCalled();
  });
});
