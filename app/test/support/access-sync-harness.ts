import { vi } from 'vitest';
import { BindingLifecycleService } from '../../src/access-sync/binding-lifecycle.service.js';
import { ProjectAccessRepository } from '../../src/project-access/project-access.repository.js';
import { ProjectAccessService } from '../../src/project-access/project-access.service.js';
import { ProjectSubscriptionsService } from '../../src/realtime/project-subscriptions.service.js';
import { RepositoryBindingsRepository } from '../../src/repository-bindings/repository-bindings.repository.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { FakeGithubAccessPort } from './fake-github-access.port.js';
import { InMemoryPrisma } from './in-memory-prisma.js';
import { InMemoryUserGithubIdentitiesRepository } from './in-memory-user-github-identities.repository.js';

export const ORG_ID = '42';
export const ORG_LOGIN = 'acme';
export const INSTALLATION_ID = 'inst-42';

export const socketOf = (id: string) => ({ id, leave: vi.fn().mockResolvedValue(undefined) });

/**
 * Piezas REALES de la sincronización de acceso (repositorios, `ProjectAccessService.revoke`
 * con su advisory lock, `ProjectSubscriptionsService`, `BindingLifecycleService`) sobre
 * `InMemoryPrisma` y el fake de GitHub: ningún test toca GitHub ni Supabase.
 */
export function buildAccessSyncHarness() {
  const db = new InMemoryPrisma();
  const prisma = db as unknown as PrismaService;
  const github = new FakeGithubAccessPort();
  const identities = new InMemoryUserGithubIdentitiesRepository();
  const accessRepository = new ProjectAccessRepository(prisma);
  const bindings = new RepositoryBindingsRepository(prisma);
  // `revoke` solo usa el repositorio (advisory lock); el resto de dependencias no interviene.
  const access = new ProjectAccessService(accessRepository, {} as never, {} as never, github);
  const subscriptions = new ProjectSubscriptionsService(accessRepository);
  const lifecycle = new BindingLifecycleService(bindings, accessRepository, access, subscriptions, identities as never);

  const seedOrgProject = (id: string, binding: { status?: string; repositoryId?: string; repositoryName?: string } | null = {}) => {
    db.insert('project', { id, name: id, ownerUserId: 'owner', githubOrgId: ORG_ID, githubOrgLogin: ORG_LOGIN });
    if (binding) {
      return db.insert('repositoryBinding', {
        projectId: id,
        installationId: INSTALLATION_ID,
        status: binding.status ?? 'ENABLED',
        repositoryId: binding.repositoryId ?? `repo-${id}`,
        repositoryName: binding.repositoryName ?? `acme/${id}`,
        integrationBranch: 'main',
        disabledReason: null,
      });
    }
    return null;
  };

  const seedPersonalProject = (id: string, creator: string, githubUserId: string | null, binding: { status?: string; repositoryId?: string; repositoryName?: string } = {}) => {
    db.insert('project', { id, name: id, ownerUserId: creator, githubOrgId: null, githubOrgLogin: null });
    if (githubUserId !== null) {
      void identities.create(creator, githubUserId, null);
    }
    return db.insert('repositoryBinding', {
      projectId: id,
      installationId: 'inst-personal',
      status: binding.status ?? 'ENABLED',
      repositoryId: binding.repositoryId ?? `repo-${id}`,
      repositoryName: binding.repositoryName ?? `creator/${id}`,
      integrationBranch: 'main',
      disabledReason: null,
    });
  };

  const grant = (projectId: string, userId: string, role: 'ADMIN' | 'MAINTAINER' | 'READER') =>
    db.insert('projectAccess', { projectId, userId, role, verifiedAt: new Date() });

  const recordsOf = (projectId: string) =>
    db.tables.projectAccess
      .filter((row) => row.projectId === projectId)
      .map((row) => `${row.userId}:${row.role}`)
      .sort();

  const bindingOf = (projectId: string) =>
    db.tables.repositoryBinding.find((row) => row.projectId === projectId) as {
      id: string;
      status: string;
      repositoryName: string;
      disabledReason: string | null;
    };

  return {
    db,
    prisma,
    github,
    identities,
    accessRepository,
    bindings,
    access,
    subscriptions,
    lifecycle,
    seedOrgProject,
    seedPersonalProject,
    grant,
    recordsOf,
    bindingOf,
  };
}
