import { Injectable, Logger } from '@nestjs/common';
import {
  GithubIntegrationClient,
  GithubIntegrationClientError,
} from './github-integration.client.js';
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
  private readonly logger = new Logger(GithubAccessHttpAdapter.name);

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
    const consulta = await this.consultar<OrganizationInstallation[]>(
      '/organizations/installations',
      {},
      isOrganizationInstallations,
    );
    this.registrarFallo('/organizations/installations', consulta);

    // A missing App installation endpoint is not proof that there are no
    // organization installs; the old App-JWT lookup treated it conservatively.
    if (
      consulta.resultado.status === 'NOT_FOUND' ||
      consulta.resultado.status === 'NOT_INSTALLED'
    ) {
      this.avisar('/organizations/installations', {
        motivo: `INSTALACIONES_${consulta.resultado.status}_COMO_UNVERIFIABLE`,
        estatus: 'n/a',
        reintentable: 'n/a',
        duracion: consulta.duracion,
      });
      return { status: 'UNVERIFIABLE' };
    }

    return consulta.resultado;
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
    const consulta = await this.consultar<OrganizationOwner[]>(
      '/organizations/owners',
      {
        installationId: organization.installationId,
        organizationLogin: organization.organizationLogin,
      },
      isOrganizationOwners,
    );
    this.registrarFallo('/organizations/owners', consulta);

    // Una organización de GitHub no puede tener cero owners. Mantener esta
    // salvaguarda local evita convertir una respuesta vacía en una revocación.
    if (
      consulta.resultado.status === 'OK' &&
      consulta.resultado.value.length === 0
    ) {
      this.avisar('/organizations/owners', {
        motivo: 'LISTA_DE_OWNERS_VACIA',
        estatus: 'n/a',
        reintentable: 'n/a',
        duracion: consulta.duracion,
      });
      return { status: 'UNVERIFIABLE' };
    }

    return consulta.resultado;
  }

  private async lookup<T>(
    path: string,
    request: unknown,
    isValue: (value: unknown) => value is T,
  ): Promise<GithubLookup<T>> {
    const consulta = await this.consultar(path, request, isValue);
    this.registrarFallo(path, consulta);
    return consulta.resultado;
  }

  /**
   * Llama a GitHub Integration y clasifica el resultado. Nunca lanza: los
   * fallos de transporte o inesperados se traducen a UNVERIFIABLE conservador
   * y se describen en `fallo` solo con código, estatus, reintentabilidad o nombre.
   */
  private async consultar<T>(
    path: string,
    request: unknown,
    isValue: (value: unknown) => value is T,
  ): Promise<Consulta<T>> {
    const inicio = Date.now();
    try {
      const respuesta = await this.githubIntegrationClient.post<unknown>(
        path,
        request,
      );
      const duracion = Date.now() - inicio;
      const { resultado, motivo } = toGithubLookup(respuesta, isValue);
      return motivo
        ? {
            resultado,
            duracion,
            fallo: { motivo, estatus: 'n/a', reintentable: 'n/a' },
          }
        : { resultado, duracion };
    } catch (error) {
      // Service auth/config/upstream failures cannot prove absence or revoke
      // persisted access; return the conservative port result without leaking
      // internal error text or response bodies.
      const duracion = Date.now() - inicio;
      if (error instanceof GithubIntegrationClientError) {
        return {
          resultado: { status: 'UNVERIFIABLE' },
          duracion,
          fallo: {
            motivo: `ERROR_CLIENTE:${error.code}`,
            estatus:
              error.status === undefined
                ? 'sin respuesta'
                : String(error.status),
            reintentable: String(error.retryable),
          },
        };
      }
      return {
        resultado: { status: 'UNVERIFIABLE' },
        duracion,
        fallo: {
          motivo: `ERROR_INESPERADO:${error instanceof Error ? error.name : 'desconocido'}`,
          estatus: 'n/a',
          reintentable: 'n/a',
        },
      };
    }
  }

  private registrarFallo<T>(path: string, consulta: Consulta<T>): void {
    if (!consulta.fallo) return;
    this.avisar(path, {
      ...consulta.fallo,
      duracion: consulta.duracion,
    });
  }

  private avisar(path: string, detalle: DetalleAviso): void {
    this.logger.warn(
      `GitHub Integration no pudo verificar "${path}": motivo=${detalle.motivo}, estatus=${detalle.estatus}, reintentable=${detalle.reintentable}, duracion=${detalle.duracion} ms.`,
    );
  }
}

interface DetalleAviso {
  motivo: string;
  estatus: string;
  reintentable: string;
  duracion: number;
}

interface Consulta<T> {
  resultado: GithubLookup<T>;
  duracion: number;
  fallo?: Omit<DetalleAviso, 'duracion'>;
}

function toGithubLookup<T>(
  value: unknown,
  isValue: (value: unknown) => value is T,
): { resultado: GithubLookup<T>; motivo?: string } {
  if (!isRecord(value)) {
    return {
      resultado: { status: 'UNVERIFIABLE' },
      motivo: 'RESPUESTA_NO_RECONOCIDA',
    };
  }

  switch (value.status) {
    case 'NOT_FOUND':
    case 'NOT_INSTALLED':
      return { resultado: { status: value.status } };
    case 'UNVERIFIABLE':
      return {
        resultado: { status: 'UNVERIFIABLE' },
        motivo: 'INTEGRATION_UNVERIFIABLE',
      };
    case 'OK':
      return isValue(value.value)
        ? { resultado: { status: 'OK', value: value.value } }
        : {
            resultado: { status: 'UNVERIFIABLE' },
            motivo: 'RESPUESTA_NO_RECONOCIDA',
          };
    default:
      return {
        resultado: { status: 'UNVERIFIABLE' },
        motivo: 'RESPUESTA_NO_RECONOCIDA',
      };
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
