import { Injectable, Logger } from '@nestjs/common';
import { toGithubId, type AccessReverifyScope } from '../access-sync/access-reverify.scope.js';
import { AccessReverifyService } from '../access-sync/access-reverify.service.js';
import { OrganizationLifecycleService } from '../access-sync/organization-lifecycle.service.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import type {
  GithubMemberWebhookPayload,
  GithubMembershipWebhookPayload,
  GithubOrganizationWebhookPayload,
  GithubTeamWebhookPayload,
} from './dto/access-webhook.payload.js';

export type AccessEventName = 'member' | 'membership' | 'organization' | 'team';

export const ACCESS_EVENT_NAMES: ReadonlySet<string> = new Set<AccessEventName>(['member', 'membership', 'organization', 'team']);

/**
 * Eventos de acceso de organización (`INTEROP-2.4` §6.9, "Eventos de acceso"; HU61): `member`,
 * `membership`, `organization` y `team` (`repository.privatized` lo enruta `RepositoryEventsService`).
 *
 * El payload SOLO selecciona qué reverificar (usuario, repositorio u organización): el ingress no
 * llama a GitHub, encola un `ACCESS_REVERIFY` deduplicado por alcance y responde `202`; el rol sale
 * siempre de una verificación viva. Los `action` no listados y los eventos sin un id utilizable se
 * ignoran. Un evento que no toca ningún Project de organización vivo no encola nada. Todo es
 * idempotente (no se persiste `WebhookDelivery`): un duplicado o un evento fuera de orden repite la
 * misma reverificación viva. Los efectos de `organization.renamed` y `organization.deleted` son
 * directos (login guardado; Projects ocultos y conservados).
 */
@Injectable()
export class AccessEventsService {
  private readonly logger = new Logger(AccessEventsService.name);

  constructor(
    private readonly reverify: AccessReverifyService,
    private readonly organizations: OrganizationLifecycleService,
    private readonly accessRepository: ProjectAccessRepository,
  ) {}

  async handle(eventName: AccessEventName, payload: unknown): Promise<void> {
    switch (eventName) {
      case 'member':
        return this.handleMember(payload as GithubMemberWebhookPayload);
      case 'membership':
        return this.handleMembership(payload as GithubMembershipWebhookPayload);
      case 'organization':
        return this.handleOrganization(payload as GithubOrganizationWebhookPayload);
      case 'team':
        return this.handleTeam(payload as GithubTeamWebhookPayload);
    }
  }

  /** `member` (`added`, `edited`, `removed`): el usuario `member.id` sobre los Projects vinculados a `repository.id`. */
  private async handleMember(payload: GithubMemberWebhookPayload): Promise<void> {
    if (!['added', 'edited', 'removed'].includes(payload.action)) {
      return;
    }

    const githubUserId = toGithubId(payload.member?.id);
    const repositoryId = toGithubId(payload.repository?.id);

    if (githubUserId === null || repositoryId === null) {
      return this.malformed('member', payload.action);
    }

    await this.enqueueForRepository({ scope: 'USER_REPOSITORY', githubUserId, repositoryId });
  }

  /** `membership` (`added`, `removed`): el usuario `member.id` sobre los Projects con repositorio de `organization.id`. */
  private async handleMembership(payload: GithubMembershipWebhookPayload): Promise<void> {
    if (!['added', 'removed'].includes(payload.action)) {
      return;
    }

    const githubUserId = toGithubId(payload.member?.id);
    const organizationId = toGithubId(payload.organization?.id);

    if (githubUserId === null || organizationId === null) {
      return this.malformed('membership', payload.action);
    }

    await this.enqueueForOrganization({ scope: 'USER_ORGANIZATION_REPOSITORIES', githubUserId, organizationId });
  }

  private async handleOrganization(payload: GithubOrganizationWebhookPayload): Promise<void> {
    const organizationId = toGithubId(payload.organization?.id);

    switch (payload.action) {
      case 'member_removed': {
        // El usuario deja de ser miembro: se reverifica sobre TODOS los Projects de la organización
        // (borra sus registros, Admin incluido, si ya no es miembro activo).
        const githubUserId = toGithubId(payload.membership?.user?.id);

        if (githubUserId === null || organizationId === null) {
          return this.malformed('organization', payload.action);
        }

        return this.enqueueForOrganization({ scope: 'USER_ORGANIZATION', githubUserId, organizationId });
      }

      case 'renamed': {
        const login = payload.organization?.login;

        if (organizationId === null || typeof login !== 'string' || login.length === 0) {
          return this.malformed('organization', payload.action);
        }

        return this.organizations.rename(organizationId, login);
      }

      case 'deleted':
        if (organizationId === null) {
          return this.malformed('organization', payload.action);
        }

        await this.organizations.hide(organizationId);
        return;

      default:
        // `member_added` y `member_invited` no quitan nada (el alta se crea al entrar) y los demás no se listan.
        return;
    }
  }

  /**
   * `team` (`added_to_repository`, `removed_from_repository`, `edited`, `deleted`): los registros de
   * los Projects vinculados a `repository.id` si viene en el payload; si no, los de todos los Projects
   * con repositorio de `organization.id`. Un cambio del permiso de un Team no está garantizado como
   * evento (la reconciliación horaria lo corrige). `created` no afecta a ningún Project.
   */
  private async handleTeam(payload: GithubTeamWebhookPayload): Promise<void> {
    if (!['added_to_repository', 'removed_from_repository', 'edited', 'deleted'].includes(payload.action)) {
      return;
    }

    const repositoryId = toGithubId(payload.repository?.id);

    if (repositoryId !== null) {
      return this.enqueueForRepository({ scope: 'REPOSITORY', repositoryId });
    }

    const organizationId = toGithubId(payload.organization?.id);

    if (organizationId === null) {
      return this.malformed('team', payload.action);
    }

    await this.enqueueForOrganization({ scope: 'ORGANIZATION_REPOSITORIES', organizationId });
  }

  /** Solo si el repositorio está vinculado a un Project de organización vivo (los demás no tienen registros). */
  private async enqueueForRepository(scope: Extract<AccessReverifyScope, { repositoryId: string }>): Promise<void> {
    if (await this.accessRepository.hasLiveOrganizationProjectForRepository(scope.repositoryId)) {
      await this.reverify.enqueue(scope);
    }
  }

  /** Solo si la organización tiene algún Project vivo. */
  private async enqueueForOrganization(scope: Extract<AccessReverifyScope, { organizationId: string }>): Promise<void> {
    if ((await this.accessRepository.findLiveProjectIdsOfOrganization(scope.organizationId)).length > 0) {
      await this.reverify.enqueue(scope);
    }
  }

  private malformed(eventName: string, action: string): void {
    this.logger.warn(`Evento ${eventName}.${action} sin los ids que Core necesita: se ignora.`);
  }
}
