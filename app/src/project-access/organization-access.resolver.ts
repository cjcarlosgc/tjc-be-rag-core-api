import { Inject, Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../common/concurrency.util.js';
import {
  GITHUB_ACCESS_PORT,
  type GithubAccessPort,
  type GithubLookup,
  type OrganizationInstallation,
} from '../github-app/github-access.port.js';
import { ACCESS_VERIFICATION_BUDGET, ACCESS_VERIFICATION_CONCURRENCY } from './project-access.constants.js';

/** Organización verificada en vivo para un usuario: miembro activo, con su rol de owner. */
export interface OrganizationContext {
  organizationId: string;
  /** Login VIGENTE de la instalación (no el `githubOrgLogin` guardado, que solo es presentación). */
  login: string;
  installationId: string;
  avatarUrl: string | null;
  /** `ADMIN` = owner activo; `MEMBER` = miembro activo que no es owner. */
  role: 'ADMIN' | 'MEMBER';
}

export type OrganizationResolution =
  | { status: 'OK'; organization: OrganizationContext }
  /** GitHub confirma que no es miembro activo (ni `pending`). */
  | { status: 'NOT_MEMBER' }
  /** La App ya no está instalada en la organización: no es una caída, oculta el workspace. */
  | { status: 'NOT_INSTALLED' }
  | { status: 'UNVERIFIABLE' };

export type WorkspaceResolution =
  | { status: 'PERSONAL' }
  | { status: 'ORGANIZATION'; organization: OrganizationContext }
  | { status: 'NOT_FOUND' }
  | { status: 'UNVERIFIABLE' };

export type MemberOrganizations =
  | {
      status: 'OK';
      /** Organizaciones donde el usuario es miembro activo, ordenadas por login. */
      member: OrganizationContext[];
      /** Instalaciones sin veredicto (suspendidas, sobre el presupuesto o `UNVERIFIABLE`). */
      unverifiable: OrganizationInstallation[];
    }
  | { status: 'UNVERIFIABLE' };

/**
 * Alcance de UNA petición: memoiza solo la lista de instalaciones de la App (una
 * lectura con el JWT de la App, sin datos del usuario) para no repetirla por cada
 * candidato de un listado. Nunca se comparte entre peticiones ni memoiza denegaciones.
 */
export class VerificationContext {
  private installations: Promise<GithubLookup<OrganizationInstallation[]>> | undefined;

  loadInstallations(github: GithubAccessPort): Promise<GithubLookup<OrganizationInstallation[]>> {
    this.installations ??= github.listOrganizationInstallations();
    return this.installations;
  }
}

const NUMERIC_GITHUB_ID = /^[1-9][0-9]*$/;

/**
 * Lecturas de organización con el installation token de la App (nunca el token del
 * usuario). El login que se pasa al puerto es el VIGENTE de la instalación: un
 * `githubOrgLogin` guardado puede haberse renombrado o reasignado.
 */
@Injectable()
export class OrganizationAccessResolver {
  private readonly logger = new Logger(OrganizationAccessResolver.name);

  constructor(@Inject(GITHUB_ACCESS_PORT) private readonly github: GithubAccessPort) {}

  /** Membresía activa y rol de owner de `githubUserId` en la organización `organizationId`. */
  async resolve(
    organizationId: string,
    githubUserId: string,
    context: VerificationContext = new VerificationContext(),
  ): Promise<OrganizationResolution> {
    const installations = await context.loadInstallations(this.github);

    if (installations.status !== 'OK') {
      this.logger.warn(`No se pudieron listar las instalaciones de la App (${installations.status}).`);
      return { status: 'UNVERIFIABLE' };
    }

    const installation = installations.value.find((candidate) => candidate.organizationId === organizationId);

    if (!installation) {
      return { status: 'NOT_INSTALLED' };
    }

    if (installation.suspended) {
      return { status: 'UNVERIFIABLE' };
    }

    return this.resolveFromInstallation(installation, githubUserId);
  }

  /**
   * Workspace de una ruta con `workspaceId`: omitido o el propio id numérico = personal
   * (sin GitHub); un valor no numérico no es un workspace (sin GitHub); cualquier otro se
   * verifica como organización. Una organización sin la App instalada, ajena o donde el
   * usuario no es miembro activo es indistinguible: `NOT_FOUND`.
   */
  async resolveWorkspace(
    workspaceId: string | undefined,
    githubUserId: string,
    context: VerificationContext = new VerificationContext(),
  ): Promise<WorkspaceResolution> {
    if (workspaceId === undefined || workspaceId === githubUserId) {
      return { status: 'PERSONAL' };
    }

    if (!NUMERIC_GITHUB_ID.test(workspaceId)) {
      return { status: 'NOT_FOUND' };
    }

    const resolution = await this.resolve(workspaceId, githubUserId, context);

    switch (resolution.status) {
      case 'OK':
        return { status: 'ORGANIZATION', organization: resolution.organization };
      case 'UNVERIFIABLE':
        return { status: 'UNVERIFIABLE' };
      default:
        return { status: 'NOT_FOUND' };
    }
  }

  /**
   * Organizaciones con la App instalada donde el usuario es miembro activo, con tope de
   * concurrencia y presupuesto por petición. Las suspendidas y las que exceden el
   * presupuesto no se verifican; una membresía `UNVERIFIABLE` no se ofrece como nueva.
   */
  async listMemberOrganizations(
    githubUserId: string,
    context: VerificationContext = new VerificationContext(),
  ): Promise<MemberOrganizations> {
    const installations = await context.loadInstallations(this.github);

    if (installations.status !== 'OK') {
      this.logger.warn(`No se pudieron listar las instalaciones de la App (${installations.status}).`);
      return { status: 'UNVERIFIABLE' };
    }

    const all = uniqueByOrganization(installations.value).sort(byLogin);
    const suspended = all.filter((installation) => installation.suspended);
    const candidates = all.filter((installation) => !installation.suspended);
    const verifiable = candidates.slice(0, ACCESS_VERIFICATION_BUDGET);
    const overBudget = candidates.slice(ACCESS_VERIFICATION_BUDGET);

    if (overBudget.length > 0) {
      this.logger.warn(
        `Presupuesto de verificaciones agotado: ${overBudget.length} organizaciones no se verifican en esta petición.`,
      );
    }

    const resolutions = await mapWithConcurrency(verifiable, ACCESS_VERIFICATION_CONCURRENCY, (installation) =>
      this.resolveFromInstallation(installation, githubUserId),
    );
    const member: OrganizationContext[] = [];
    const unverifiable: OrganizationInstallation[] = [...suspended, ...overBudget];

    resolutions.forEach((resolution, index) => {
      if (resolution.status === 'OK') {
        member.push(resolution.organization);
      } else if (resolution.status === 'UNVERIFIABLE') {
        this.logger.warn(`Membresía de la organización "${verifiable[index].organizationLogin}" no verificable.`);
        unverifiable.push(verifiable[index]);
      }
    });

    return { status: 'OK', member, unverifiable };
  }

  private async resolveFromInstallation(
    installation: OrganizationInstallation,
    githubUserId: string,
  ): Promise<OrganizationResolution> {
    const membership = await this.github.getOrganizationMembership(
      { installationId: installation.installationId, organizationLogin: installation.organizationLogin },
      githubUserId,
    );

    switch (membership.status) {
      case 'NOT_FOUND':
        return { status: 'NOT_MEMBER' };
      case 'NOT_INSTALLED':
        return { status: 'NOT_INSTALLED' };
      case 'UNVERIFIABLE':
        return { status: 'UNVERIFIABLE' };
      case 'OK':
        if (membership.value.state !== 'active') {
          return { status: 'NOT_MEMBER' };
        }
        return {
          status: 'OK',
          organization: {
            organizationId: installation.organizationId,
            login: installation.organizationLogin,
            installationId: installation.installationId,
            avatarUrl: installation.avatarUrl,
            role: membership.value.role === 'admin' ? 'ADMIN' : 'MEMBER',
          },
        };
    }
  }
}

function uniqueByOrganization(installations: OrganizationInstallation[]): OrganizationInstallation[] {
  return [...new Map(installations.map((installation) => [installation.organizationId, installation])).values()];
}

/** Los logins de GitHub no distinguen mayúsculas; el id desempata de forma estable. */
export function byLogin(a: { organizationLogin: string; organizationId: string }, b: {
  organizationLogin: string;
  organizationId: string;
}): number {
  const left = a.organizationLogin.toLowerCase();
  const right = b.organizationLogin.toLowerCase();
  if (left !== right) {
    return left < right ? -1 : 1;
  }
  return a.organizationId < b.organizationId ? -1 : a.organizationId > b.organizationId ? 1 : 0;
}
