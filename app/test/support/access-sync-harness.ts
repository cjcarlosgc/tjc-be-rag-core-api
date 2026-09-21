import { vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { AccessReverifyService } from '../../src/access-sync/access-reverify.service.js';
import { BindingLifecycleService } from '../../src/access-sync/binding-lifecycle.service.js';
import { OrganizationLifecycleService } from '../../src/access-sync/organization-lifecycle.service.js';
import { JobsService } from '../../src/jobs/jobs.service.js';
import type { JobsRepository } from '../../src/jobs/jobs.repository.js';
import { OrganizationAccessResolver } from '../../src/project-access/organization-access.resolver.js';
import { ProjectAccessRepository } from '../../src/project-access/project-access.repository.js';
import { ProjectAccessService } from '../../src/project-access/project-access.service.js';
import { ProjectSubscriptionsService } from '../../src/realtime/project-subscriptions.service.js';
import { RepositoryBindingsRepository } from '../../src/repository-bindings/repository-bindings.repository.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { FakeGithubAccessPort } from './fake-github-access.port.js';
import { InMemoryJobsRepository } from './in-memory-jobs.repository.js';
import { InMemoryPrisma } from './in-memory-prisma.js';
import { InMemoryUserGithubIdentitiesRepository } from './in-memory-user-github-identities.repository.js';

export const ORG_ID = '42';
export const ORG_LOGIN = 'acme';
export const INSTALLATION_ID = 'inst-42';

export const socketOf = (id: string) => ({ id, leave: vi.fn().mockResolvedValue(undefined) });

/**
 * Piezas REALES de la sincronización de acceso (repositorios, `ProjectAccessService` con su
 * advisory lock y sus reglas de rol, `ProjectSubscriptionsService`, `BindingLifecycleService`,
 * `OrganizationLifecycleService`, `AccessReverifyService` y la cola con su modelo en memoria)
 * sobre `InMemoryPrisma` y el fake de GitHub: ningún test toca GitHub ni Supabase.
 */
export function buildAccessSyncHarness() {
  const db = new InMemoryPrisma();
  const prisma = db as unknown as PrismaService;
  const github = new FakeGithubAccessPort();
  const identities = new InMemoryUserGithubIdentitiesRepository();
  const accessRepository = new ProjectAccessRepository(prisma);
  const bindings = new RepositoryBindingsRepository(prisma);
  // La identidad de una petición no interviene aquí: solo el `githubUserId` persistido de cada usuario.
  const githubIdentity = { resolve: (userId: string) => Promise.resolve(identities.rows.get(userId)?.githubUserId as string) };
  const access = new ProjectAccessService(accessRepository, new OrganizationAccessResolver(github), githubIdentity as never, github);
  const subscriptions = new ProjectSubscriptionsService(accessRepository);
  const lifecycle = new BindingLifecycleService(bindings, accessRepository, access, subscriptions, identities as never);
  const organizations = new OrganizationLifecycleService(lifecycle, accessRepository, github);
  const queue = new InMemoryJobsRepository();
  const jobs = new JobsService(queue as unknown as JobsRepository, { get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService);
  const reverify = new AccessReverifyService(jobs, access, accessRepository, identities as never, subscriptions);

  /** Organización `42` instalada con un owner y usuarios de Core enlazados a su `githubUserId` (`gh-<usuario>`). */
  const seedOrganization = (members: Record<string, 'owner' | 'member'> = {}) => {
    github.addOrganization({ installationId: INSTALLATION_ID, organizationId: ORG_ID, organizationLogin: ORG_LOGIN, avatarUrl: null, suspended: false });
    const owners: Array<{ githubUserId: string; login: string }> = [];
    for (const [userId, role] of Object.entries(members)) {
      void identities.create(userId, `gh-${userId}`, null);
      github.setMembership(ORG_LOGIN, `gh-${userId}`, { role: role === 'owner' ? 'admin' : 'member', state: 'active' });
      if (role === 'owner') {
        owners.push({ githubUserId: `gh-${userId}`, login: userId });
      }
    }
    github.setOwners(ORG_LOGIN, owners);
  };

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
    organizations,
    queue,
    jobs,
    reverify,
    seedOrganization,
    seedOrgProject,
    seedPersonalProject,
    grant,
    recordsOf,
    bindingOf,
  };
}
