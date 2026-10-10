import { describe, expect, it, vi } from 'vitest';
import { issueGithubBindingEvidence } from './github-binding-evidence.js';
import { VerifiedRepositoryBindingService } from './verified-repository-binding.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

const secret = 'test-only-github-binding-evidence-secret';
const projectId = '10000000-0000-4000-8000-000000000001';

function setup(overrides: Record<string, unknown> = {}) {
  const project = {
    id: projectId, ownerUserId: 'user-1', githubOrgId: null,
    access: [], repositoryBinding: null, ...overrides,
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

  // INTEROP-2.7 §6.13 (WI-CORE-019, corte B): vincular exige Writer o superior; un binding REVOKED solo lo
  // conserva un Admin, como en el predicado de visibilidad.
  describe('role on an organization project (Writer minimum, INTEROP-2.7 §6.13)', () => {
    const orgOverrides = (role: string | null, status?: string) => ({
      githubOrgId: '99',
      access: role ? [{ role }] : [],
      repositoryBinding: status ? { status } : null,
    });
    const orgBody = () => ({
      repositoryId: '456',
      repositoryName: 'octo/repo',
      integrationBranch: 'main',
      authorizationEvidence: issueGithubBindingEvidence(secret, {
        sub: 'user-1', githubUserId: '123', projectId, repositoryId: '456', repositoryName: 'octo/repo',
        ownerId: '99', installationId: '55', integrationBranch: 'main',
      }),
    }) as never;

    it.each(['WRITER', 'MAINTAINER'] as const)('a %s record persists the binding (the minimum is Writer)', async (role) => {
      const { service, bindings } = setup(orgOverrides(role));
      await expect(service.create(projectId, orgBody(), 'user-1', '123')).resolves.toMatchObject({ repositoryId: '456' });
      expect(bindings.create).toHaveBeenCalledOnce();
    });

    it('a Reader record is answered 403 PROJECT_ROLE_INSUFFICIENT and nothing is persisted', async () => {
      const { service, bindings } = setup(orgOverrides('READER'));
      await expect(service.create(projectId, orgBody(), 'user-1', '123')).rejects.toMatchObject({
        code: ErrorCode.PROJECT_ROLE_INSUFFICIENT,
        status: 403,
      });
      expect(bindings.create).not.toHaveBeenCalled();
    });

    it('a Writer record on a REVOKED binding is answered 403 (only an Admin keeps the operation)', async () => {
      const { service, bindings } = setup(orgOverrides('WRITER', 'REVOKED'));
      await expect(service.create(projectId, orgBody(), 'user-1', '123')).rejects.toMatchObject({
        code: ErrorCode.PROJECT_ROLE_INSUFFICIENT,
        status: 403,
      });
      expect(bindings.create).not.toHaveBeenCalled();
    });
  });
});
