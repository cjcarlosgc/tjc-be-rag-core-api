import { Inject, Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../common/concurrency.util.js';
import { GITHUB_ACCESS_PORT, type GithubAccessPort, type OrganizationInstallation } from '../github-app/github-access.port.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import { REVOKE_CONCURRENCY } from './access-sync.constants.js';
import { BindingLifecycleService } from './binding-lifecycle.service.js';

/**
 * Resultado de la parte (a) de la reconciliación para una organización: `HIDDEN` sus Projects
 * quedaron ocultos (GitHub CONFIRMA que ya no es resoluble o que la App se desinstaló; una lista de
 * owners vacía NO es confirmación), `RENAMED` cambió el login guardado, `UNVERIFIABLE` no se pudo comprobar (no se toca
 * nada), `FAILED` error inesperado.
 */
export type OrganizationReconciliation = 'OK' | 'RENAMED' | 'HIDDEN' | 'UNVERIFIABLE' | 'FAILED';

/**
 * Ciclo de vida de la organización sobre `projects.githubOrgId/githubOrgLogin` (HU61,
 * `DEC-ORG-001` "Ciclo de vida de la organización"): si la organización desaparece, se
 * o se desinstala la App, sus Projects y su evidencia se CONSERVAN pero dejan de
 * verse (binding `REVOKED` y registros borrados, Admin incluido); reaparecen cuando la App se
 * reinstala o la organización vuelve, porque el acceso se recrea al entrar, y con el binding
 * `REVOKED` hasta que un Admin lo reactive. Nunca se reasignan a otro workspace.
 */
@Injectable()
export class OrganizationLifecycleService {
  private readonly logger = new Logger(OrganizationLifecycleService.name);

  constructor(
    private readonly lifecycle: BindingLifecycleService,
    private readonly accessRepository: ProjectAccessRepository,
    @Inject(GITHUB_ACCESS_PORT) private readonly github: GithubAccessPort,
  ) {}

  /** `organization.renamed`: actualiza el login guardado (solo presentación; los accesos se verifican por id). */
  rename(organizationId: string, login: string): Promise<void> {
    return this.accessRepository.updateOrganizationLogin(organizationId, login);
  }

  /**
   * Oculta y conserva todos los Projects vivos de la organización (`organization.deleted`,
   * `installation.deleted` de una organización, reconciliación (a)). Un fallo en un Project no
   * detiene a los demás y se informa al final (los ya ocultos no se deshacen; la reconciliación
   * termina lo que quede). Devuelve cuántos Projects ocultó.
   */
  async hide(organizationId: string): Promise<number> {
    const projectIds = await this.accessRepository.findLiveProjectIdsOfOrganization(organizationId);
    const failed: string[] = [];

    await mapWithConcurrency(projectIds, REVOKE_CONCURRENCY, async (projectId) => {
      try {
        await this.lifecycle.hideProject(projectId);
      } catch (error) {
        failed.push(projectId);
        this.logger.warn(`No se pudo ocultar el Project "${projectId}": ${describe(error)}`);
      }
    });

    if (failed.length > 0) {
      throw new Error(`Ocultado incompleto de la organización "${organizationId}" (${failed.length} Projects pendientes).`);
    }

    return projectIds.length;
  }

  /**
   * Parte (a) de la reconciliación para UNA organización con registros de acceso, contra la
   * lista de instalaciones de la App ya leída (`installations`, `OK`): la organización debe ser
   * resoluble (instalación presente), la App seguir instalada y tener al menos un owner activo;
   * si GitHub CONFIRMA lo contrario (instalación ausente, `NOT_FOUND`/`NOT_INSTALLED`), sus Projects quedan ocultos. Una instalación suspendida o una lectura no verificable
   * (red, `5xx`, límite de tasa, `Members: read` ausente) conserva todo. Nunca lanza. Además
   * corrige el login guardado con el vigente de la instalación (un `organization.renamed`
   * perdido o fuera de orden).
   */
  async reconcile(
    organization: { organizationId: string; login: string | null },
    installations: OrganizationInstallation[],
  ): Promise<OrganizationReconciliation> {
    try {
      const installation = installations.find((candidate) => candidate.organizationId === organization.organizationId);

      // La lista se leyó completa (`OK`): la organización sin instalación ya no tiene la App.
      if (!installation) {
        await this.hide(organization.organizationId);
        return 'HIDDEN';
      }

      if (installation.suspended) {
        return 'UNVERIFIABLE';
      }

      const owners = await this.github.listOrganizationOwners({
        installationId: installation.installationId,
        organizationLogin: installation.organizationLogin,
      });

      switch (owners.status) {
        case 'UNVERIFIABLE':
          return 'UNVERIFIABLE';
        case 'NOT_FOUND':
        case 'NOT_INSTALLED':
          await this.hide(organization.organizationId);
          return 'HIDDEN';
        case 'OK':
          // Una organización de GitHub no puede tener cero owners: una lista vacía es un artefacto de
          // visibilidad, no una confirmación. Nunca oculta (el adaptador ya la devuelve `UNVERIFIABLE`).
          if (owners.value.length === 0) {
            return 'UNVERIFIABLE';
          }
      }

      if (organization.login !== installation.organizationLogin) {
        await this.rename(organization.organizationId, installation.organizationLogin);
        return 'RENAMED';
      }

      return 'OK';
    } catch (error) {
      this.logger.warn(`No se pudo reconciliar la organización "${organization.organizationId}": ${describe(error)}`);
      return 'FAILED';
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
