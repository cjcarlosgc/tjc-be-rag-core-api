import { Injectable, Logger } from '@nestjs/common';
import { UserGithubIdentitiesRepository } from '../common/auth/user-github-identities.repository.js';
import { mapWithConcurrency } from '../common/concurrency.util.js';
import { JobsService } from '../jobs/jobs.service.js';
import { VerificationContext } from '../project-access/organization-access.resolver.js';
import { ACCESS_VERIFICATION_CONCURRENCY } from '../project-access/project-access.constants.js';
import { ProjectAccessRepository, type AccessRecordFilter, type AccessRecordKey } from '../project-access/project-access.repository.js';
import { ProjectAccessService, type ReverifyOutcome } from '../project-access/project-access.service.js';
import { ProjectSubscriptionsService } from '../realtime/project-subscriptions.service.js';
import {
  ACCESS_REVERIFY_JOB_TYPE,
  reverifyDedupeKey,
  type AccessReverifyScope,
} from './access-reverify.scope.js';

/** Registro a reverificar con el `githubUserId` de su usuario. */
export interface ReverifyTarget extends AccessRecordKey {
  githubUserId: string;
}

export interface ReverifySummary {
  checked: number;
  unchanged: number;
  updated: number;
  revoked: number;
  /** GitHub no pudo verificar: se conserva el registro y se reintenta con backoff. */
  unverifiable: number;
  /** Error inesperado al reverificar un registro (se trata como no verificable: se reintenta). */
  failed: number;
  /** Registros sin identidad GitHub persistida (no deberían existir): no se pueden verificar y se omiten. */
  skipped: number;
}

export const emptyReverifySummary = (): ReverifySummary => ({
  checked: 0,
  unchanged: 0,
  updated: 0,
  revoked: 0,
  unverifiable: 0,
  failed: 0,
  skipped: 0,
});

/** Lo que NO pudo completarse y debe reintentarse (no verificable o con error). */
export const pendingRetries = (summary: ReverifySummary): number => summary.unverifiable + summary.failed;

const COUNTER = {
  UNCHANGED: 'unchanged',
  UPDATED: 'updated',
  REVOKED: 'revoked',
  UNVERIFIABLE: 'unverifiable',
  NO_RECORD: 'unchanged',
} as const satisfies Record<ReverifyOutcome, keyof ReverifySummary>;

/**
 * Reverificación de registros de acceso de organización (HU61): encola `ACCESS_REVERIFY` desde
 * los eventos y recalcula registros para el job y para la reconciliación (b), con las MISMAS
 * reglas que el alta (`ProjectAccessService.reverify`, mismo advisory lock por
 * `(projectId, userId)`). Tras cambiar registros expulsa de las salas WebSocket a quien ya no
 * tiene acceso (`ProjectSubscriptionsService.revalidateProject`).
 */
@Injectable()
export class AccessReverifyService {
  private readonly logger = new Logger(AccessReverifyService.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly access: ProjectAccessService,
    private readonly accessRepository: ProjectAccessRepository,
    private readonly identities: UserGithubIdentitiesRepository,
    private readonly subscriptions: ProjectSubscriptionsService,
  ) {}

  /**
   * Encola la reverificación de un alcance, deduplicada por su `dedupeKey` solo sobre `PENDING`:
   * un evento que llega durante un `RUNNING` del mismo alcance crea uno nuevo que corre DESPUÉS.
   * Si el evento se absorbe en un `PENDING` reprogramado con backoff, lo adelanta a "ahora".
   */
  async enqueue(scope: AccessReverifyScope): Promise<void> {
    const dedupeKey = reverifyDedupeKey(scope);
    const { created } = await this.jobs.enqueueDeduped(ACCESS_REVERIFY_JOB_TYPE, { ...scope }, { dedupeKey });

    if (!created) {
      await this.jobs.expediteDeduped(dedupeKey);
    }
  }

  /** Registros que un alcance señala, con el `githubUserId` de cada usuario. */
  async resolveTargets(scope: AccessReverifyScope): Promise<{ targets: ReverifyTarget[]; skipped: number }> {
    if (scope.scope === 'USER_REPOSITORY' || scope.scope === 'USER_ORGANIZATION' || scope.scope === 'USER_ORGANIZATION_REPOSITORIES') {
      // El usuario de Core al que se refiere el evento; sin vínculo no tiene registros.
      const identity = await this.identities.findByGithubUserId(scope.githubUserId);

      if (!identity) {
        return { targets: [], skipped: 0 };
      }

      // Por (Project, usuario) sobre los Projects señalados, no solo sobre los registros existentes: la
      // reverificación toma el advisory lock de cada par y, si un alta de ese usuario estaba en vuelo
      // (aún sin registro), corre DESPUÉS de ella y la verifica en vivo (no queda un acceso obsoleto).
      const projectIds = await this.accessRepository.findCandidateProjectIds(filterOf(scope));
      return { targets: projectIds.map((projectId) => ({ projectId, userId: identity.userId, githubUserId: scope.githubUserId })), skipped: 0 };
    }

    return this.withIdentities(await this.accessRepository.findRecords(filterOf(scope)));
  }

  /** Une los registros con el `githubUserId` de cada usuario; los que no tienen identidad se omiten. */
  async withIdentities(records: AccessRecordKey[]): Promise<{ targets: ReverifyTarget[]; skipped: number }> {
    const identities = await this.identities.findByUserIds([...new Set(records.map((record) => record.userId))]);
    const githubUserIdOf = new Map(identities.map((identity) => [identity.userId, identity.githubUserId]));
    const targets: ReverifyTarget[] = [];
    let skipped = 0;

    for (const record of records) {
      const githubUserId = githubUserIdOf.get(record.userId);

      if (githubUserId === undefined) {
        skipped += 1;
        this.logger.warn(`El registro de acceso "${record.projectId}"/"${record.userId}" no tiene identidad GitHub: no se puede reverificar.`);
      } else {
        targets.push({ ...record, githubUserId });
      }
    }

    return { targets, skipped };
  }

  async reverifyScope(scope: AccessReverifyScope, context: VerificationContext = new VerificationContext()): Promise<ReverifySummary> {
    const { targets, skipped } = await this.resolveTargets(scope);
    const summary = await this.reverifyTargets(targets, context);
    summary.skipped = skipped;
    return summary;
  }

  /**
   * Recalcula cada registro con tope de concurrencia. Nunca lanza por un registro: un error
   * inesperado se cuenta (`failed`) para que quien invoca reintente, y no detiene a los demás.
   */
  async reverifyTargets(targets: ReverifyTarget[], context: VerificationContext): Promise<ReverifySummary> {
    const summary = emptyReverifySummary();
    const changedProjects = new Set<string>();

    const outcomes = await mapWithConcurrency(targets, ACCESS_VERIFICATION_CONCURRENCY, async (target) => {
      try {
        return await this.access.reverify(target.projectId, target.userId, target.githubUserId, context);
      } catch (error) {
        this.logger.warn(`No se pudo reverificar "${target.projectId}"/"${target.userId}": ${describe(error)}`);
        return 'FAILED' as const;
      }
    });

    outcomes.forEach((outcome, index) => {
      summary.checked += 1;

      if (outcome === 'FAILED') {
        summary.failed += 1;
        return;
      }

      summary[COUNTER[outcome]] += 1;

      if (outcome === 'UPDATED' || outcome === 'REVOKED') {
        changedProjects.add(targets[index].projectId);
      }
    });

    await this.expelUnauthorized(changedProjects);
    return summary;
  }

  /** Saca de las salas a quien ya no ve cada Project cuyo registro cambió; un fallo se registra y no detiene el resto. */
  private async expelUnauthorized(projectIds: Set<string>): Promise<void> {
    for (const projectId of projectIds) {
      try {
        await this.subscriptions.revalidateProject(projectId);
      } catch (error) {
        this.logger.warn(`No se pudo revalidar las suscripciones del Project "${projectId}": ${describe(error)}`);
      }
    }
  }
}

function filterOf(scope: AccessReverifyScope): AccessRecordFilter {
  switch (scope.scope) {
    case 'USER_REPOSITORY':
    case 'REPOSITORY':
      return { repositoryId: scope.repositoryId };
    case 'USER_ORGANIZATION':
      return { organizationId: scope.organizationId };
    case 'USER_ORGANIZATION_REPOSITORIES':
    case 'ORGANIZATION_REPOSITORIES':
      return { organizationId: scope.organizationId, withRepositoryOnly: true };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
