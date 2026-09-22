import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../jobs/jobs.service.js';
import type { JobHandler } from '../jobs/job-handler.interface.js';
import { RescheduleJobError } from '../jobs/reschedule-job.error.js';
import { VerificationContext } from '../project-access/organization-access.resolver.js';
import { accessBackoffMs } from './access-backoff.js';
import { ACCESS_REVERIFY_JOB_TYPE, parseReverifyPayload, type AccessReverifyPayload } from './access-reverify.scope.js';
import { AccessReverifyService } from './access-reverify.service.js';

/**
 * `ACCESS_REVERIFY` (`INTEROP-2.4` §6.9): reverifica en vivo los registros que señala un evento
 * de acceso, con las mismas reglas que el alta y el mismo advisory lock por `(projectId,
 * userId)`. Borra lo que GitHub confirma perdido, actualiza el rol si cambió y CONSERVA lo que
 * no puede verificar: en ese caso el job se reprograma con backoff creciente acotado a una hora
 * (`RescheduleJobError`: no consume `maxAttempts` ni falla en silencio); la reconciliación
 * horaria es el respaldo. Al reprogramar conserva el alcance COMPLETO (idempotente), porque un
 * evento nuevo del mismo alcance puede absorberse en ese `PENDING`.
 */
@Injectable()
export class AccessReverifyJobHandler implements JobHandler<AccessReverifyPayload>, OnModuleInit {
  readonly type = ACCESS_REVERIFY_JOB_TYPE;
  private readonly logger = new Logger(AccessReverifyJobHandler.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly reverify: AccessReverifyService,
  ) {}

  onModuleInit(): void {
    this.jobs.registerHandler(this);
  }

  async handle(payload: AccessReverifyPayload): Promise<void> {
    const scope = parseReverifyPayload(payload);

    if (!scope) {
      // Un payload irreconocible no se arregla reintentando: se descarta con registro.
      this.logger.error(`ACCESS_REVERIFY con un payload irreconocible: ${JSON.stringify(payload)}`);
      return;
    }

    const summary = await this.reverify.reverifyScope(scope, new VerificationContext());
    this.logger.log(`ACCESS_REVERIFY ${scope.scope}: ${JSON.stringify(summary)}`);

    // Un error INESPERADO en un registro (base de datos, bug) sigue el camino normal `fail` del job:
    // consume intentos con su backoff corto hasta `FAILED` y se ve en la cola. Solo "GitHub no
    // pudo verificar" se reprograma sin consumir intentos (no es un fallo del job).
    if (summary.failed > 0) {
      throw new Error(`ACCESS_REVERIFY ${scope.scope}: ${summary.failed} registro(s) fallaron con un error inesperado.`);
    }

    if (summary.unverifiable > 0) {
      const deferrals = scope.deferrals ?? 0;
      throw new RescheduleJobError(
        accessBackoffMs(deferrals),
        `GitHub no permitió verificar ${summary.unverifiable} registro(s) (${scope.scope}); reintento ${deferrals + 1} con backoff.`,
        { ...scope, deferrals: deferrals + 1 },
      );
    }
  }
}
