import { Injectable } from '@nestjs/common';
import { GithubIntegrationClient } from './github-integration.client.js';
import type {
  GithubAccessPort,
  GithubLookup,
  OrganizationInstallation,
  OrganizationMembership,
  OrganizationOwner,
  OrganizationRef,
  RepositoryDetails,
  RepositoryOwner,
  RepositoryPermissionLevel,
  RepositoryRef,
} from './github-access.port.js';

/**
 * Adaptador de `GithubAccessPort` a GitHub Integration. La autenticación de
 * App, la resolución de login desde IDs y todas las llamadas directas a GitHub
 * permanecen en ese servicio; Core conserva la semántica `GithubLookup`.
 */
@Injectable()
export class GithubAccessHttpAdapter implements GithubAccessPort {
  constructor(
    private readonly githubIntegrationClient: GithubIntegrationClient,
  ) {}

  async getRepositoryOwner(
    repository: RepositoryRef,
  ): Promise<GithubLookup<RepositoryOwner>> {
    const result = await this.lookup<RepositoryOwner>(
      '/repositories/owner',
      {
        installationId: repository.installationId,
        repositoryName: repository.repositoryName,
      },
      isRepositoryOwner,
    );
    return result;
  }

  async getRepositoryById(
    installationId: string,
    repositoryId: string,
  ): Promise<GithubLookup<RepositoryDetails>> {
    return this.lookup<RepositoryDetails>(
      '/repositories/by-id',
      { installationId, repositoryId },
      isRepositoryDetails,
    );
  }

  async getRepositoryPermission(
    repository: RepositoryRef,
    githubUserId: string,
  ): Promise<GithubLookup<RepositoryPermissionLevel>> {
    return this.lookup<RepositoryPermissionLevel>(
      '/repositories/permission',
      {
        installationId: repository.installationId,
        repositoryName: repository.repositoryName,
        githubUserId,
      },
      isRepositoryPermissionLevel,
    );
  }

  async listOrganizationInstallations(): Promise<
    GithubLookup<OrganizationInstallation[]>
  > {
    const result = await this.lookup<OrganizationInstallation[]>(
      '/organizations/installations',
      {},
      isOrganizationInstallations,
    );

    // A missing App installation endpoint is not proof that there are no
    // organization installs; the old App-JWT lookup treated it conservatively.
    if (result.status === 'NOT_FOUND' || result.status === 'NOT_INSTALLED') {
      return { status: 'UNVERIFIABLE' };
    }

    return result;
  }

  async getOrganizationMembership(
    organization: OrganizationRef,
    githubUserId: string,
  ): Promise<GithubLookup<OrganizationMembership>> {
    return this.lookup<OrganizationMembership>(
      '/organizations/membership',
      {
        installationId: organization.installationId,
        organizationLogin: organization.organizationLogin,
        githubUserId,
      },
      isOrganizationMembership,
    );
  }

  async listOrganizationOwners(
    organization: OrganizationRef,
  ): Promise<GithubLookup<OrganizationOwner[]>> {
    const result = await this.lookup<OrganizationOwner[]>(
      '/organizations/owners',
      {
        installationId: organization.installationId,
        organizationLogin: organization.organizationLogin,
      },
      isOrganizationOwners,
    );

    // Una organización de GitHub no puede tener cero owners. Mantener esta
    // salvaguarda local evita convertir una respuesta vacía en una revocación.
    if (result.status === 'OK' && result.value.length === 0) {
      return { status: 'UNVERIFIABLE' };
    }

    return result;
  }

  private async lookup<T>(
    path: string,
    request: unknown,
    isValue: (value: unknown) => value is T,
  ): Promise<GithubLookup<T>> {
    try {
      const result = await this.githubIntegrationClient.post<unknown>(
        path,
        request,
      );
      return toGithubLookup(result, isValue);
    } catch {
      // Service auth/config/upstream failures cannot prove absence or revoke
      // persisted access; return the conservative port result without leaking
      // internal error text or response bodies.
      return { status: 'UNVERIFIABLE' };
    }
  }
}

function toGithubLookup<T>(
  value: unknown,
  isValue: (value: unknown) => value is T,
): GithubLookup<T> {
  if (!isRecord(value)) return { status: 'UNVERIFIABLE' };

  switch (value.status) {
    case 'NOT_FOUND':
    case 'NOT_INSTALLED':
    case 'UNVERIFIABLE':
      return { status: value.status };
    case 'OK':
      return isValue(value.value)
        ? { status: 'OK', value: value.value }
        : { status: 'UNVERIFIABLE' };
    default:
      return { status: 'UNVERIFIABLE' };
  }
}

function isRepositoryOwner(value: unknown): value is RepositoryOwner {
  return (
    isRecord(value) &&
    isNonEmptyString(value.repositoryId) &&
    isNonEmptyString(value.ownerId) &&
    isNonEmptyString(value.ownerLogin) &&
    (value.ownerType === 'User' || value.ownerType === 'Organization')
  );
}

function isRepositoryDetails(value: unknown): value is RepositoryDetails {
  return (
    isRecord(value) &&
    isNonEmptyString(value.repositoryId) &&
    isNonEmptyString(value.ownerId) &&
    isNonEmptyString(value.ownerLogin) &&
    (value.ownerType === 'User' || value.ownerType === 'Organization') &&
    isNonEmptyString(value.repositoryName)
  );
}

function isRepositoryPermissionLevel(
  value: unknown,
): value is RepositoryPermissionLevel {
  return (
    value === 'admin' ||
    value === 'maintain' ||
    value === 'write' ||
    value === 'triage' ||
    value === 'read'
  );
}

function isOrganizationInstallations(
  value: unknown,
): value is OrganizationInstallation[] {
  return (
    Array.isArray(value) &&
    value.every(
      (installation) =>
        isRecord(installation) &&
        isNonEmptyString(installation.installationId) &&
        isNonEmptyString(installation.organizationId) &&
        isNonEmptyString(installation.organizationLogin) &&
        (installation.avatarUrl === null ||
          typeof installation.avatarUrl === 'string') &&
        typeof installation.suspended === 'boolean',
    )
  );
}

function isOrganizationMembership(
  value: unknown,
): value is OrganizationMembership {
  return (
    isRecord(value) &&
    (value.role === 'admin' || value.role === 'member') &&
    (value.state === 'active' || value.state === 'pending')
  );
}

function isOrganizationOwners(value: unknown): value is OrganizationOwner[] {
  return (
    Array.isArray(value) &&
    value.every(
      (owner) =>
        isRecord(owner) &&
        isNonEmptyString(owner.githubUserId) &&
        isNonEmptyString(owner.login),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
