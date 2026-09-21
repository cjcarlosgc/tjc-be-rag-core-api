import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mapWithConcurrency } from '../common/concurrency.util.js';
import { GITHUB_ACCESS_PORT, type GithubAccessPort } from '../github-app/github-access.port.js';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { JobsService } from '../jobs/jobs.service.js';
import { RepositoryBindingsRepository, type BindingWithWorkspace } from '../repository-bindings/repository-bindings.repository.js';
import {
  ACCESS_RECONCILIATION_DEDUPE_KEY,
  ACCESS_RECONCILIATION_JOB_TYPE,
  LEFTOVER_SWEEP_LIMIT,
  RECONCILIATION_BATCH_SIZE,
} from './access-sync.constants.js';
import { BindingLifecycleService } from './binding-lifecycle.service.js';

export interface AccessReconciliationPayload {
  /** Cursor de la ejecución anterior que agotó su presupuesto: continúa tras este binding. */
  afterBindingId?: string;
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
}

/**
 * Reconciliación horaria de acceso (`INTEROP-2.4` §6.9), parte (c) (etapa 3a): revalida el
 * propietario y el nombre del repositorio de todo Project vivo con binding, personales
 * incluidos, para que un evento `repository` perdido también se corrija. Las partes (a) y
 * (b) (registros de acceso de organización) son de la etapa 3b.
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
 * - **Presupuesto y concurrencia:** a lo sumo `ACCESS_RECONCILIATION_BUDGET` lecturas de
 *   GitHub por ejecución y `ACCESS_RECONCILIATION_CONCURRENCY` simultáneas; si se agota, el
 *   cursor pasa al payload de la siguiente ocurrencia para no reverificar siempre los mismos.
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

    const summary = await this.reconcileBindings(typeof payload?.afterBindingId === 'string' ? payload.afterBindingId : null);

    if (summary.truncated && summary.cursor !== null) {
      await this.jobs.updatePendingPayload(ACCESS_RECONCILIATION_DEDUPE_KEY, { afterBindingId: summary.cursor });
    }

    summary.leftoverProjectsCleaned = await this.sweepLeftoverRecords();
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
