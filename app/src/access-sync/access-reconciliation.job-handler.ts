import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mapWithConcurrency } from '../common/concurrency.util.js';
import { GITHUB_ACCESS_PORT, type GithubAccessPort } from '../github-app/github-access.port.js';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { VerificationContext } from '../project-access/organization-access.resolver.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import { RepositoryBindingsRepository, type BindingWithWorkspace } from '../repository-bindings/repository-bindings.repository.js';
import {
  ACCESS_RECONCILIATION_DEDUPE_KEY,
  ACCESS_RECONCILIATION_JOB_TYPE,
  LEFTOVER_SWEEP_LIMIT,
  RECONCILIATION_BATCH_SIZE,
  RECONCILIATION_PROJECT_BATCH_SIZE,
} from './access-sync.constants.js';
import { AccessReverifyService, emptyReverifySummary, type ReverifySummary } from './access-reverify.service.js';
import { BindingLifecycleService } from './binding-lifecycle.service.js';
import { OrganizationLifecycleService, type OrganizationReconciliation } from './organization-lifecycle.service.js';

export interface AccessReconciliationPayload {
  /** (c) Cursor de la ejecución anterior que agotó su presupuesto: continúa tras este binding. */
  afterBindingId?: string;
  /** (b) Cursor de la ejecución anterior que agotó su presupuesto: continúa tras este Project. */
  afterProjectId?: string;
}

/** Parte (a): organizaciones con registros de acceso. */
export interface OrganizationsSummary {
  checked: number;
  hidden: number;
  renamed: number;
  unverifiable: number;
  failed: number;
}

/** Parte (b): registros de acceso de los Projects de organización. */
export interface RecordsSummary extends ReverifySummary {
  /** El presupuesto se agotó antes de recorrer todos los Projects con registros: la siguiente ocurrencia continúa. */
  truncated: boolean;
}

export type BindingReconciliation = 'UNCHANGED' | 'RENAMED' | 'REVOKED' | 'UNVERIFIABLE' | 'FAILED';

export interface ReconciliationSummary {
  checked: number;
  unchanged: number;
  renamed: number;
  revoked: number;
  unverifiable: number;
  failed: number;
  /** El presupuesto se agotó antes de recorrer todos los bindings: la siguiente ocurrencia continúa. */
  truncated: boolean;
  leftoverProjectsCleaned: number;
  organizations: OrganizationsSummary;
  records: RecordsSummary;
}

/**
 * Reconciliación horaria de acceso (`INTEROP-2.4` §6.9), partes (a), (b) y (c) (se ejecutan en el
 * orden (a), (c), (b): el nombre del repositorio se corrige antes de recalcular los registros):
 *
 * - **(a) organizaciones** con registros de acceso: la organización debe ser resoluble, la App
 *   seguir instalada y tener al menos un owner activo; si no, sus Projects quedan ocultos
 *   (bindings `REVOKED` y registros borrados, Admin incluido) y se conservan. Reaparecen al
 *   volver la organización o reinstalarse la App (el acceso se recrea al entrar), con el binding
 *   `REVOKED` hasta que un Admin lo reactive. Una organización cuya instalación ya no existe
 *   (`NOT_INSTALLED`) es confirmación de GitHub, no una caída. Una sola lectura de la lista de
 *   instalaciones por ejecución; una lectura por organización para sus owners.
 * - **(b) registros** de los Projects de organización con registros: los recalcula con las mismas
 *   reglas que el alta (`ProjectAccessService.reverify`, mismo advisory lock), borra los que
 *   GitHub confirma perdidos y conserva los no verificables.
 * - **(c) binding** (etapa 3a): revalida el propietario y el nombre del repositorio de todo
 *   Project vivo con binding, personales incluidos, para que un evento `repository` perdido
 *   también se corrija.
 *
 * Nada revoca por una caída de GitHub (red, `5xx`, límite de tasa, instalación suspendida,
 * `Members: read` ausente) ni concede algo nuevo, y el siguiente ciclo se programa igualmente.
 * Un error en una parte se registra y no impide las demás.
 *
 * - **Cadena:** la siguiente ocurrencia (`now + 1 h`) se encola AL INICIO de la ejecución
 *   (el índice único parcial solo cubre `PENDING`: no choca con la fila `RUNNING` de esta
 *   ejecución), así que un fallo o una caída a mitad no la rompe. Si esa ocurrencia ya
 *   existe, la sentencia no hace nada.
 * - **Siembra:** al arrancar se encola una ocurrencia solo si no hay un `PENDING` ni un
 *   `RUNNING` no obsoleto (varias instancias no la duplican).
 * - **Resultado por binding:** transferido fuera de la cuenta/organización del Project o
 *   eliminado (o la App ya no lo ve) -> `REVOKED` y borrado de Maintainer/Reader;
 *   renombrado -> actualiza `repositoryName`; GitHub no verificable (red, `5xx`, límite
 *   de tasa, instalación suspendida) -> conserva y reintenta en la siguiente ocurrencia:
 *   nunca revoca por un error de red.
 * - **Presupuesto y concurrencia:** a lo sumo `ACCESS_RECONCILIATION_BUDGET` bindings (c) y
 *   `ACCESS_RECONCILIATION_BUDGET` registros (b) por ejecución y `ACCESS_RECONCILIATION_CONCURRENCY`
 *   lecturas simultáneas; si se agota, el cursor pasa al payload de la siguiente ocurrencia para
 *   no reverificar siempre los mismos. La parte (a) no lleva cursor (una lectura por organización
 *   con registros, acotada por la concurrencia).
 */
@Injectable()
export class AccessReconciliationJobHandler
  implements JobHandler<AccessReconciliationPayload>, OnModuleInit, OnApplicationBootstrap
{
  readonly type = ACCESS_RECONCILIATION_JOB_TYPE;
  private readonly logger = new Logger(AccessReconciliationJobHandler.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
    private readonly bindings: RepositoryBindingsRepository,
    private readonly lifecycle: BindingLifecycleService,
    @Inject(GITHUB_ACCESS_PORT) private readonly github: GithubAccessPort,
    private readonly organizations: OrganizationLifecycleService,
    private readonly reverify: AccessReverifyService,
    private readonly accessRepository: ProjectAccessRepository,
  ) {}

  onModuleInit(): void {
    this.jobs.registerHandler(this);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seed();
    } catch (error) {
      // La base no disponible al arrancar no debe impedir el arranque: el siguiente arranque siembra.
      this.logger.error(`No se pudo sembrar la reconciliación de acceso: ${describe(error)}`);
    }
  }

  private get enabled(): boolean {
    return this.config.get<boolean>('ACCESS_RECONCILIATION_ENABLED', true);
  }

  private get intervalMs(): number {
    return this.config.get<number>('ACCESS_RECONCILIATION_INTERVAL_MS', 3_600_000);
  }

  /** Siembra al arrancar: omite solo si hay un `PENDING` o un `RUNNING` no obsoleto. */
  async seed(): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    const { created } = await this.jobs.enqueueDeduped(ACCESS_RECONCILIATION_JOB_TYPE, {}, {
      dedupeKey: ACCESS_RECONCILIATION_DEDUPE_KEY,
      skipIfRunning: true,
    });

    return created;
  }

  async handle(payload: AccessReconciliationPayload | null): Promise<void> {
    await this.run(payload);
  }

  /** Una ejecución completa; devuelve el resumen (`undefined` si la reconciliación está desactivada). */
  async run(payload: AccessReconciliationPayload | null): Promise<ReconciliationSummary | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    // Antes que nada: la cadena sobrevive a cualquier fallo posterior de esta ejecución.
    await this.jobs.enqueueDeduped(ACCESS_RECONCILIATION_JOB_TYPE, {}, {
      dedupeKey: ACCESS_RECONCILIATION_DEDUPE_KEY,
      delayMs: this.intervalMs,
    });

    const context = new VerificationContext(); // memoiza solo la lista de instalaciones de ESTA ejecución
    const organizations = await this.guarded('(a) organizaciones', () => this.reconcileOrganizations(context), emptyOrganizations());

    // (c) antes que (b): un nombre de repositorio obsoleto no debe hacer que (b) lea el permiso de un
    // repositorio que ya no existe con ese nombre, y un binding ya `REVOKED` se ve antes de recalcular.
    let bindingsFailure: unknown;
    let summary!: Awaited<ReturnType<AccessReconciliationJobHandler['reconcileBindings']>>;

    try {
      summary = await this.reconcileBindings(typeof payload?.afterBindingId === 'string' ? payload.afterBindingId : null);
    } catch (error) {
      bindingsFailure = error;
    }

    const records = await this.guarded(
      '(b) registros',
      () => this.reconcileRecords(typeof payload?.afterProjectId === 'string' ? payload.afterProjectId : null, context),
      { ...emptyReverifySummary(), truncated: false, cursor: null },
    );

    if (bindingsFailure !== undefined) {
      // Como antes: la ejecución falla (la siguiente ocurrencia ya está encolada) tras haber intentado (a) y (b).
      throw bindingsFailure;
    }

    // Los cursores de (b) y (c) viajan juntos en el payload de la siguiente ocurrencia.
    const nextPayload = {
      ...(summary.truncated && summary.cursor !== null ? { afterBindingId: summary.cursor } : {}),
      ...(records.truncated && records.cursor !== null ? { afterProjectId: records.cursor } : {}),
    };

    if (Object.keys(nextPayload).length > 0) {
      await this.jobs.updatePendingPayload(ACCESS_RECONCILIATION_DEDUPE_KEY, nextPayload);
    }

    summary.leftoverProjectsCleaned = await this.sweepLeftoverRecords();
    summary.organizations = organizations;
    const { cursor: _recordsCursor, ...recordsResult } = records;
    summary.records = recordsResult;
    const { cursor: _cursor, ...result } = summary;
    this.logger.log(`Reconciliación de acceso: ${JSON.stringify(result)}`);
    return result;
  }

  /** Revalida un binding contra GitHub; nunca lanza (un fallo se cuenta y no detiene a los demás). */
  async reconcileBinding(binding: BindingWithWorkspace): Promise<BindingReconciliation> {
    try {
      const lookup = await this.github.getRepositoryById(binding.installationId, binding.repositoryId);

      switch (lookup.status) {
        case 'UNVERIFIABLE':
          return 'UNVERIFIABLE';
        case 'NOT_FOUND':
        case 'NOT_INSTALLED':
          // Eliminado, o la App ya no lo ve/está instalada: confirmado por GitHub, no una caída.
          await this.lifecycle.revokeBinding(binding);
          return 'REVOKED';
        case 'OK': {
          const repository = lookup.value;

          if (repository.repositoryId !== binding.repositoryId) {
            return 'UNVERIFIABLE';
          }

          const expectedOwnerId = await this.lifecycle.expectedOwnerId(binding.project);

          if (expectedOwnerId !== null && repository.ownerId !== expectedOwnerId) {
            await this.lifecycle.revokeBinding(binding);
            return 'REVOKED';
          }

          if (repository.repositoryName !== binding.repositoryName) {
            await this.bindings.updateRepositoryName(binding.id, repository.repositoryName);
            return 'RENAMED';
          }

          return 'UNCHANGED';
        }
      }
    } catch (error) {
      this.logger.warn(`No se pudo reconciliar el binding "${binding.id}": ${describe(error)}`);
      return 'FAILED';
    }
  }

  /** Ejecuta una parte de la reconciliación; un error se registra y devuelve `fallback` para no impedir las demás. */
  private async guarded<T>(part: string, work: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await work();
    } catch (error) {
      this.logger.error(`La parte ${part} de la reconciliación falló: ${describe(error)}`);
      return fallback;
    }
  }

  /**
   * Parte (a). Con la lista de instalaciones no verificable (caída de GitHub, límite de tasa) no
   * se toca nada: ninguna organización se oculta sin confirmación.
   */
  async reconcileOrganizations(context: VerificationContext): Promise<OrganizationsSummary> {
    const summary = emptyOrganizations();
    const organizations = await this.accessRepository.findOrganizationsWithRecords();

    if (organizations.length === 0) {
      return summary;
    }

    const installations = await context.loadInstallations(this.github);
    summary.checked = organizations.length;

    if (installations.status !== 'OK') {
      summary.unverifiable = organizations.length;
      return summary;
    }

    const concurrency = this.config.get<number>('ACCESS_RECONCILIATION_CONCURRENCY', 5);
    const outcomes = await mapWithConcurrency(organizations, concurrency, (organization) =>
      this.organizations.reconcile(organization, installations.value),
    );

    for (const outcome of outcomes) {
      if (outcome !== 'OK') {
        summary[ORGANIZATION_COUNTER[outcome]] += 1;
      }
    }

    return summary;
  }

  /**
   * Parte (b): recalcula los registros de los Projects de organización con registros, un Project
   * completo por vez, hasta agotar el presupuesto; el cursor (id del último Project) pasa a la
   * siguiente ocurrencia si quedan más.
   */
  async reconcileRecords(afterProjectId: string | null, context: VerificationContext): Promise<RecordsSummary & { cursor: string | null }> {
    const budget = this.config.get<number>('ACCESS_RECONCILIATION_BUDGET', 500);
    const summary: RecordsSummary & { cursor: string | null } = { ...emptyReverifySummary(), truncated: false, cursor: null };
    let cursor = afterProjectId;

    for (;;) {
      const projectIds = await this.accessRepository.findProjectIdsWithRecords(cursor, RECONCILIATION_PROJECT_BATCH_SIZE);

      if (projectIds.length === 0) {
        return summary;
      }

      for (const projectId of projectIds) {
        const { targets, skipped } = await this.reverify.withIdentities(await this.accessRepository.findRecords({ projectId }));
        const projectSummary = await this.reverify.reverifyTargets(targets, context);
        projectSummary.skipped = skipped;
        addSummaries(summary, projectSummary);
        cursor = projectId;

        if (summary.checked >= budget) {
          // Presupuesto agotado: si quedan más Projects con registros, la siguiente ocurrencia continúa desde aquí.
          summary.truncated = (await this.accessRepository.findProjectIdsWithRecords(cursor, 1)).length > 0;
          summary.cursor = summary.truncated ? cursor : null;
          return summary;
        }
      }

      if (projectIds.length < RECONCILIATION_PROJECT_BATCH_SIZE) {
        return summary;
      }
    }
  }

  private async reconcileBindings(afterBindingId: string | null): Promise<ReconciliationSummary & { cursor: string | null }> {
    const budget = this.config.get<number>('ACCESS_RECONCILIATION_BUDGET', 500);
    const concurrency = this.config.get<number>('ACCESS_RECONCILIATION_CONCURRENCY', 5);
    const summary: ReconciliationSummary & { cursor: string | null } = {
      checked: 0,
      unchanged: 0,
      renamed: 0,
      revoked: 0,
      unverifiable: 0,
      failed: 0,
      truncated: false,
      leftoverProjectsCleaned: 0,
      organizations: emptyOrganizations(),
      records: { ...emptyReverifySummary(), truncated: false },
      cursor: null,
    };
    let cursor = afterBindingId;

    for (;;) {
      const batch = await this.bindings.findLiveForReconciliation(cursor, RECONCILIATION_BATCH_SIZE);

      if (batch.length === 0) {
        return summary;
      }

      const remaining = budget - summary.checked;
      const verifiable = batch.slice(0, remaining);
      const outcomes = await mapWithConcurrency(verifiable, concurrency, (binding) => this.reconcileBinding(binding));

      for (const outcome of outcomes) {
        summary.checked += 1;
        summary[COUNTER[outcome]] += 1;
      }

      cursor = verifiable[verifiable.length - 1].id;

      if (summary.checked >= budget) {
        // Presupuesto agotado: si quedaban más, la siguiente ocurrencia continúa desde aquí.
        summary.truncated = verifiable.length < batch.length || batch.length === RECONCILIATION_BATCH_SIZE;
        summary.cursor = summary.truncated ? cursor : null;
        return summary;
      }

      if (batch.length < RECONCILIATION_BATCH_SIZE) {
        return summary;
      }
    }
  }

  /**
   * Un binding `REVOKED` con registros Maintainer/Reader sobrantes (una revocación
   * interrumpida): termina el borrado. No usa GitHub ni el presupuesto.
   */
  private async sweepLeftoverRecords(): Promise<number> {
    let cleaned = 0;

    try {
      for (const binding of await this.bindings.findRevokedWithLeftoverRecords(LEFTOVER_SWEEP_LIMIT)) {
        try {
          await this.lifecycle.dropNonAdminAccess(binding.projectId);
          cleaned += 1;
        } catch (error) {
          this.logger.warn(`No se pudo limpiar el acceso sobrante del Project "${binding.projectId}": ${describe(error)}`);
        }
      }
    } catch (error) {
      this.logger.warn(`No se pudo buscar accesos sobrantes de bindings REVOKED: ${describe(error)}`);
    }

    return cleaned;
  }
}

const ORGANIZATION_COUNTER = {
  HIDDEN: 'hidden',
  RENAMED: 'renamed',
  UNVERIFIABLE: 'unverifiable',
  FAILED: 'failed',
} as const satisfies Record<Exclude<OrganizationReconciliation, 'OK'>, keyof OrganizationsSummary>;

const emptyOrganizations = (): OrganizationsSummary => ({ checked: 0, hidden: 0, renamed: 0, unverifiable: 0, failed: 0 });

function addSummaries(total: ReverifySummary, part: ReverifySummary): void {
  for (const key of Object.keys(part) as Array<keyof ReverifySummary>) {
    total[key] += part[key];
  }
}

const COUNTER = {
  UNCHANGED: 'unchanged',
  RENAMED: 'renamed',
  REVOKED: 'revoked',
  UNVERIFIABLE: 'unverifiable',
  FAILED: 'failed',
} as const satisfies Record<BindingReconciliation, keyof ReconciliationSummary>;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
