import { Injectable } from '@nestjs/common';
import { GithubIdentityService } from '../common/auth/github-identity.service.js';
import {
  OrganizationAccessResolver,
  byLogin,
  type OrganizationContext,
} from '../project-access/organization-access.resolver.js';
import { ProjectAccessRepository, type RegisteredOrganization } from '../project-access/project-access.repository.js';
import type { OrganizationInstallation } from '../github-app/github-access.port.js';
import type { WorkspaceListResponse, WorkspaceRefResponse, WorkspaceResponse } from './dto/workspace.response.js';

/**
 * HU58: workspaces del usuario. La cuenta personal siempre (su id es el
 * `githubUserId` de la sesión); las organizaciones salen de listar las
 * instalaciones de la App y verificar la membresía activa con el token de la App
 * (nunca el token OAuth del usuario ni `read:org`).
 */
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly organizations: OrganizationAccessResolver,
    private readonly projectAccessRepository: ProjectAccessRepository,
    private readonly githubIdentity: GithubIdentityService,
  ) {}

  /**
   * Cuenta personal primero y luego las organizaciones (orden por `login`, sin
   * paginar). Con GitHub caído, o sin poder verificar una organización (instalación
   * suspendida, `Members: read` sin aceptar, presupuesto agotado), se conservan solo las
   * organizaciones donde el usuario ya tiene acceso registrado a algún Project (`role:
   * ADMIN` si tiene algún registro Admin, si no `MEMBER`); no se ofrecen organizaciones
   * nuevas. Una organización con la App desinstalada o donde ya no es miembro no se ofrece.
   */
  async list(userId: string, githubUserId: string): Promise<WorkspaceListResponse> {
    const personal = await this.personalWorkspace(userId, githubUserId);
    const organizations = await this.organizationWorkspaces(userId, githubUserId);
    return { items: [personal, ...organizations] };
  }

  /** Referencia del workspace personal del usuario (la que lleva un `ProjectResponse` personal). */
  async personalRef(userId: string, githubUserId: string): Promise<WorkspaceRefResponse> {
    return {
      kind: 'PERSONAL',
      id: githubUserId,
      login: await this.githubIdentity.findGithubLogin(userId),
    };
  }

  private async personalWorkspace(userId: string, githubUserId: string): Promise<WorkspaceResponse> {
    return {
      ...(await this.personalRef(userId, githubUserId)),
      avatarUrl: avatarOf(githubUserId),
      role: 'ADMIN',
    };
  }

  private async organizationWorkspaces(userId: string, githubUserId: string): Promise<WorkspaceResponse[]> {
    const memberships = await this.organizations.listMemberOrganizations(githubUserId);

    if (memberships.status === 'UNVERIFIABLE') {
      const registered = await this.projectAccessRepository.findRegisteredOrganizations(userId);
      return registered.map((organization) => registeredWorkspace(organization)).sort(byWorkspaceLogin);
    }

    const workspaces = memberships.member.map(memberWorkspace);

    if (memberships.unverifiable.length > 0) {
      const registered = await this.projectAccessRepository.findRegisteredOrganizations(userId);
      const byId = new Map(registered.map((organization) => [organization.organizationId, organization]));

      for (const installation of memberships.unverifiable) {
        const known = byId.get(installation.organizationId);

        if (known) {
          workspaces.push(registeredWorkspace(known, installation));
        }
      }
    }

    return workspaces.sort(byWorkspaceLogin);
  }
}

function avatarOf(githubId: string): string {
  return `https://avatars.githubusercontent.com/u/${encodeURIComponent(githubId)}`;
}

function memberWorkspace(organization: OrganizationContext): WorkspaceResponse {
  return {
    kind: 'ORGANIZATION',
    id: organization.organizationId,
    login: organization.login,
    avatarUrl: organization.avatarUrl,
    role: organization.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
  };
}

/** Respaldo con lo registrado; el login y el avatar vigentes de la instalación se prefieren si se conocen. */
function registeredWorkspace(
  organization: RegisteredOrganization,
  installation?: OrganizationInstallation,
): WorkspaceResponse {
  return {
    kind: 'ORGANIZATION',
    id: organization.organizationId,
    login: installation?.organizationLogin ?? organization.login,
    avatarUrl: installation?.avatarUrl ?? avatarOf(organization.organizationId),
    role: organization.hasAdmin ? 'ADMIN' : 'MEMBER',
  };
}

function byWorkspaceLogin(a: WorkspaceResponse, b: WorkspaceResponse): number {
  return byLogin(
    { organizationLogin: a.login ?? '', organizationId: a.id },
    { organizationLogin: b.login ?? '', organizationId: b.id },
  );
}
