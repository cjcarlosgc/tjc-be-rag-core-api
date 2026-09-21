import { Inject, Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../common/concurrency.util.js';
import { GithubIdentityService } from '../common/auth/github-identity.service.js';
import {
  GITHUB_ACCESS_PORT,
  type GithubAccessPort,
  type OrganizationInstallation,
} from '../github-app/github-access.port.js';
import type { WorkspaceListResponse, WorkspaceRefResponse, WorkspaceResponse } from './dto/workspace.response.js';
import { WORKSPACE_VERIFICATION_BUDGET, WORKSPACE_VERIFICATION_CONCURRENCY } from './workspaces.constants.js';

/**
 * HU58: workspaces del usuario. La cuenta personal siempre (su id es el
 * `githubUserId` de la sesión); las organizaciones salen de listar las
 * instalaciones de la App y verificar la membresía activa con el token de la App
 * (nunca el token OAuth del usuario ni `read:org`).
 */
@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    @Inject(GITHUB_ACCESS_PORT) private readonly github: GithubAccessPort,
    private readonly githubIdentity: GithubIdentityService,
  ) {}

  /**
   * Cuenta personal primero y luego las organizaciones (orden por `login`, sin
   * paginar). Con GitHub caído, o sin poder listar las instalaciones, degrada a
   * solo la cuenta personal: el respaldo de organizaciones con acceso registrado
   * llega con el corte 3 (`project_access`).
   */
  async list(userId: string, githubUserId: string): Promise<WorkspaceListResponse> {
    const personal = await this.personalWorkspace(userId, githubUserId);
    const organizations = await this.organizationWorkspaces(githubUserId);
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
      avatarUrl: `https://avatars.githubusercontent.com/u/${encodeURIComponent(githubUserId)}`,
      role: 'ADMIN',
    };
  }

  private async organizationWorkspaces(githubUserId: string): Promise<WorkspaceResponse[]> {
    const installations = await this.github.listOrganizationInstallations();

    if (installations.status !== 'OK') {
      this.logger.warn(`No se pudieron listar las instalaciones de la App (${installations.status}); solo el workspace personal.`);
      return [];
    }

    const candidates = uniqueByOrganization(installations.value.filter((installation) => !installation.suspended))
      .sort(byLogin);
    const verifiable = candidates.slice(0, WORKSPACE_VERIFICATION_BUDGET);

    if (verifiable.length < candidates.length) {
      this.logger.warn(
        `Presupuesto de verificaciones agotado: ${candidates.length - verifiable.length} organizaciones no se verifican en esta petición.`,
      );
    }

    const workspaces = await mapWithConcurrency(
      verifiable,
      WORKSPACE_VERIFICATION_CONCURRENCY,
      (installation) => this.organizationWorkspace(installation, githubUserId),
    );

    return workspaces.filter((workspace): workspace is WorkspaceResponse => workspace !== null);
  }

  /** `null` = no se ofrece: no es miembro activo, no es verificable o la App ya no está instalada. */
  private async organizationWorkspace(
    installation: OrganizationInstallation,
    githubUserId: string,
  ): Promise<WorkspaceResponse | null> {
    const membership = await this.github.getOrganizationMembership(
      { installationId: installation.installationId, organizationLogin: installation.organizationLogin },
      githubUserId,
    );

    if (membership.status !== 'OK') {
      if (membership.status === 'UNVERIFIABLE') {
        this.logger.warn(`Membresía de la organización "${installation.organizationLogin}" no verificable; no se ofrece.`);
      }
      return null;
    }

    if (membership.value.state !== 'active') {
      return null;
    }

    return {
      kind: 'ORGANIZATION',
      id: installation.organizationId,
      login: installation.organizationLogin,
      avatarUrl: installation.avatarUrl,
      role: membership.value.role === 'admin' ? 'ADMIN' : 'MEMBER',
    };
  }
}

function uniqueByOrganization(installations: OrganizationInstallation[]): OrganizationInstallation[] {
  return [...new Map(installations.map((installation) => [installation.organizationId, installation])).values()];
}

/** Los logins de GitHub no distinguen mayúsculas; el id desempata de forma estable. */
function byLogin(a: OrganizationInstallation, b: OrganizationInstallation): number {
  const left = a.organizationLogin.toLowerCase();
  const right = b.organizationLogin.toLowerCase();

  if (left !== right) {
    return left < right ? -1 : 1;
  }

  return a.organizationId < b.organizationId ? -1 : a.organizationId > b.organizationId ? 1 : 0;
}
