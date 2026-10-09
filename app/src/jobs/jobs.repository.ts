import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma, type Job } from '../generated/prisma/client.js';
import { JobStatus } from '../generated/prisma/enums.js';

/**
 * "Ahora" en UTC como `timestamp` SIN zona, comparable con las columnas de `jobs` (`timestamp(3)`,
 * que Prisma escribe en UTC). `now()` es `timestamptz`: comparado o asignado a un `timestamp` se
 * convierte con la zona de la SESIÓN, así que con una base en otra zona (p. ej. `America/Bogota`)
 * los reclamos, backoffs y locks obsoletos se desfasarían. Esta expresión no depende de la sesión.
 */
const UTC_NOW = Prisma.raw(`(now() AT TIME ZONE 'utc')`);

/** Umbral por defecto de un lock `RUNNING` obsoleto (`JOBS_STALE_LOCK_MS`). */
export const DEFAULT_STALE_LOCK_MS = 600_000;

/**
 * Qué escribió `fail`: `terminal` (FAILED, sin intentos), `retry` (vuelve a PENDING con backoff),
 * `discarded` (colisión con otro PENDING de la misma clave: el actual se completa) o `lost`
 * (el lock ya no pertenece a este worker: no se escribió nada, DEC-JOBS-002).
 */
export type FailOutcome = 'terminal' | 'retry' | 'discarded' | 'lost';

/**
 * Tipos SIN `dedupeKey` cuyo lock obsoleto sí se libera. `experiment-run` (WI-CORE-030, DEC-JOBS-001):
 * tiene una reentrada diseñada (intentos por slot, latido por repetición). `retrieval-comparison`
 * (WI-CORE-022, DEC-RC-002, aprobada por el usuario como enmienda documentada de DEC-JOBS-001): su
 * handler es solo de retrieval, idempotente, y escribe por upsert `(comparisonId, mode)`. Los demás
 * tipos sin clave tienen gates de estado o escrituras externas y NO se liberan. Constante de código,
 * no configurable por entorno.
 */
export const RELEASABLE_UNKEYED_JOB_TYPES: readonly string[] = Object.freeze([
  'experiment-run',
  'retrieval-comparison',
]);

/** Motivo con el que se libera un lock obsoleto (también en `JobHandler.onExhausted`). */
export const STALE_LOCK_REASON = 'Lock obsoleto: el worker que lo reclamó dejó de responder.';

/**
 * Resultado de `releaseStale`: cuántos locks obsoletos se liberaron (sin contar los perdidos por
 * fencing) y los jobs que quedaron FAILED terminal al liberarse (agotaron `maxAttempts`).
 */
export interface ReleaseStaleResult {
  released: number;
  exhausted: Job[];
}

export interface InsertDedupedJobInput {
  type: string;
  payload: Prisma.InputJsonValue;
  maxAttempts: number;
  dedupeKey: string;
  /** Retraso hasta que el job es reclamable, calculado en la base (`now() + delay`). */
  delayMs?: number;
  /**
   * Omite el alta también si existe un `RUNNING` no obsoleto con la misma clave (siembra al
   * arrancar). Sin esto solo choca con un `PENDING` (el índice único parcial).
   */
  skipIfRunning?: boolean;
  staleLockMs?: number;
}

/** Violación de unicidad: `P2002` de Prisma o `23505` de PostgreSQL (el índice parcial no es un `@@unique`). */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : '';
  return code === 'P2002' || code === '23505' || /unique constraint|duplicate key/i.test(message);
}

@Injectable()
export class JobsRepository {
  private readonly logger = new Logger(JobsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  create(
    type: string,
    payload: Prisma.InputJsonValue,
    maxAttempts: number,
    tx?: Prisma.TransactionClient,
  ): Promise<Job> {
    return (tx ?? this.prisma).job.create({
      data: { type, payload, maxAttempts },
    });
  }

  /**
   * Alta con `dedupeKey`: una sola sentencia que no hace nada si ya existe un `PENDING` con
   * esa clave (índice único parcial, `ON CONFLICT DO NOTHING`) ni, con `skipIfRunning`, un
   * `RUNNING` no obsoleto. Devuelve el id del job creado o `null` si se deduplicó. La
   * propia fila `RUNNING` de un job que se autoencola NO choca (el índice cubre solo `PENDING`).
   */
  async insertDeduped(input: InsertDedupedJobInput): Promise<string | null> {
    const staleSeconds = (input.staleLockMs ?? DEFAULT_STALE_LOCK_MS) / 1000;
    const delaySeconds = (input.delayMs ?? 0) / 1000;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "jobs" ("id", "type", "payload", "status", "attempts", "maxAttempts", "availableAt", "dedupeKey", "createdAt", "updatedAt")
      SELECT ${randomUUID()}, ${input.type}, ${JSON.stringify(input.payload)}::jsonb, 'PENDING'::"JobStatus", 0, ${input.maxAttempts},
             ${UTC_NOW} + make_interval(secs => ${delaySeconds}::double precision), ${input.dedupeKey}, ${UTC_NOW}, ${UTC_NOW}
      WHERE NOT (${input.skipIfRunning === true}::boolean AND EXISTS (
        SELECT 1 FROM "jobs" r
        WHERE r."status" = 'RUNNING' AND r."dedupeKey" = ${input.dedupeKey}
          AND r."lockedAt" > ${UTC_NOW} - make_interval(secs => ${staleSeconds}::double precision)
      ))
      ON CONFLICT ("dedupeKey") WHERE "status" = 'PENDING' AND "dedupeKey" IS NOT NULL DO NOTHING
      RETURNING "id";
    `;

    return rows[0]?.id ?? null;
  }

  /**
   * Reclama el siguiente `PENDING` disponible. Los tipos sin `dedupeKey` no cambian. Un
   * `PENDING` con `dedupeKey` NO se reclama mientras exista un `RUNNING` no obsoleto con la
   * misma clave: así un evento que llega durante un `ACCESS_REVERIFY` en ejecución encola
   * uno nuevo que corre después y no en paralelo. Todo en una sola sentencia.
   */
  async claimNext(workerId: string, staleLockMs = DEFAULT_STALE_LOCK_MS): Promise<Job | null> {
    const staleSeconds = staleLockMs / 1000;
    const rows = await this.prisma.$queryRaw<Job[]>`
      UPDATE "jobs"
      SET "status" = 'RUNNING', "lockedAt" = ${UTC_NOW}, "lockedBy" = ${workerId}, "updatedAt" = ${UTC_NOW}
      WHERE "id" = (
        SELECT j."id" FROM "jobs" j
        WHERE j."status" = 'PENDING' AND j."availableAt" <= ${UTC_NOW}
          AND (j."dedupeKey" IS NULL OR NOT EXISTS (
            SELECT 1 FROM "jobs" r
            WHERE r."status" = 'RUNNING' AND r."dedupeKey" = j."dedupeKey"
              AND r."lockedAt" > ${UTC_NOW} - make_interval(secs => ${staleSeconds}::double precision)
          ))
        ORDER BY j."availableAt"
        FOR UPDATE OF j SKIP LOCKED
        LIMIT 1
      )
      RETURNING *;
    `;

    return rows[0] ?? null;
  }

  /**
   * Renueva `lockedAt` de un job que este worker sigue ejecutando (latido, DEC-JOBS-002). Solo
   * escribe si el job sigue `RUNNING` y `lockedBy` es el worker: un lock ya perdido no se reclama.
   * Devuelve si afectó una fila.
   */
  async touchLock(jobId: string, workerId: string): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      UPDATE "jobs" SET "lockedAt" = ${UTC_NOW}, "updatedAt" = ${UTC_NOW}
      WHERE "id" = ${jobId} AND "status" = 'RUNNING' AND "lockedBy" = ${workerId}
    `;

    return count > 0;
  }

  /** Completa el job solo si su lock sigue siendo de este worker (fencing, DEC-JOBS-002). */
  async complete(job: Job): Promise<void> {
    await this.fencedUpdate(job, 'complete', {
      status: JobStatus.COMPLETED,
      lockedAt: null,
      lockedBy: null,
    });
  }

  /** Falla el job (consume un intento). Solo escribe si el lock sigue siendo de este worker. */
  async fail(job: Job, errorMessage: string, forceTerminal = false): Promise<FailOutcome> {
    const attempts = job.attempts + 1;
    const isTerminal = forceTerminal || attempts >= job.maxAttempts;
    const backoffMs = Math.min(2 ** attempts * 1000, 60_000);

    if (isTerminal) {
      const count = await this.fencedUpdate(job, 'fail', {
        attempts,
        status: JobStatus.FAILED,
        lastError: errorMessage.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
      });
      return count === 0 ? 'lost' : 'terminal';
    }

    return this.returnToPending(job, {
      attempts,
      availableAt: new Date(Date.now() + backoffMs),
      lastError: errorMessage,
    });
  }

  /**
   * Devuelve un job `RUNNING` a `PENDING` a las `delayMs` sin consumir un intento (p. ej. un
   * `ACCESS_REVERIFY` cuya verificación no fue posible por una caída de GitHub). Aplica la
   * misma salvaguarda que `fail` ante el índice único parcial y el mismo fencing por `lockedBy`.
   */
  async reschedule(
    job: Job,
    delayMs: number,
    reason: string,
    payload?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.returnToPending(job, {
      attempts: job.attempts,
      availableAt: new Date(Date.now() + delayMs),
      lastError: reason,
      payload,
    });
  }

  /**
   * Escritura condicionada al worker que reclamó el job (fencing): solo si el job sigue `RUNNING`
   * con su `lockedBy`. Si no afecta ninguna fila, el lock ya no es de este worker (p. ej. un worker
   * zombi tras un reclamo) y no se escribe nada. Devuelve cuántas filas tocó.
   */
  private async fencedUpdate(
    job: Job,
    label: string,
    data: Prisma.JobUpdateManyMutationInput,
  ): Promise<number> {
    const { count } = await this.prisma.job.updateMany({
      where: { id: job.id, status: JobStatus.RUNNING, lockedBy: job.lockedBy },
      data,
    });

    if (count === 0) {
      this.logger.warn(
        `Job ${job.id} (${job.type}): ${label} descartado; el lock ya no pertenece a este worker.`,
      );
    }

    return count;
  }

  /**
   * Libera los locks `RUNNING` obsoletos (worker caído) de los jobs con `dedupeKey` (los de acceso,
   * cortos y acotados por presupuesto) y de los tipos de `RELEASABLE_UNKEYED_JOB_TYPES` (hoy
   * `experiment-run`, WI-CORE-030, DEC-JOBS-001; y `retrieval-comparison`, DEC-RC-002). Un latido de job vigente (`touchLock`) no es obsoleto.
   * Cada liberación consume un intento vía `fail` (vuelve a `PENDING` con backoff, o queda `FAILED` si
   * agotó `maxAttempts`) y respeta el índice único parcial: si ya hay un `PENDING` con su clave, el
   * obsoleto se descarta. Devuelve cuántos liberó y cuáles quedaron `FAILED` terminal.
   */
  async releaseStale(staleLockMs = DEFAULT_STALE_LOCK_MS, limit = 50): Promise<ReleaseStaleResult> {
    const staleSeconds = staleLockMs / 1000;
    const stale = await this.prisma.$queryRaw<Job[]>`
      SELECT * FROM "jobs"
      WHERE "status" = 'RUNNING'
        AND ("dedupeKey" IS NOT NULL OR "type" = ANY(${RELEASABLE_UNKEYED_JOB_TYPES}))
        AND "lockedAt" <= ${UTC_NOW} - make_interval(secs => ${staleSeconds}::double precision)
      ORDER BY "lockedAt"
      LIMIT ${limit};
    `;

    let released = 0;
    const exhausted: Job[] = [];
    for (const job of stale) {
      const outcome = await this.fail(job, STALE_LOCK_REASON);
      if (outcome !== 'lost') {
        released += 1;
      }
      if (outcome === 'terminal') {
        exhausted.push(job);
      }
    }

    return { released, exhausted };
  }

  /**
   * Adelanta a "ahora" el `PENDING` con esa clave si estaba reprogramado al futuro (backoff de un
   * `ACCESS_REVERIFY` no verificable): un evento nuevo que se absorbe en él no debe esperar el
   * backoff. Con el reloj de la base, como el resto de la cola. Devuelve cuántas filas adelantó.
   */
  async expedite(dedupeKey: string): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "jobs" SET "availableAt" = ${UTC_NOW}, "updatedAt" = ${UTC_NOW}
      WHERE "status" = 'PENDING' AND "dedupeKey" = ${dedupeKey} AND "availableAt" > ${UTC_NOW}
    `;
  }

  /** Actualiza el payload del `PENDING` con esa clave (p. ej. el cursor de la siguiente ocurrencia). */
  async updatePendingPayload(dedupeKey: string, payload: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.job.updateMany({
      where: { dedupeKey, status: JobStatus.PENDING },
      data: { payload },
    });
  }

  /**
   * Nota N1: un job con `dedupeKey` que vuelve a `PENDING` (backoff, reprogramación o
   * reclamo de un lock obsoleto) NO puede hacerlo si ya existe otro `PENDING` con su clave
   * (índice único parcial): en ese caso se completa/descarta el actual, porque el otro ya
   * cubre la misma verificación y verificará en vivo.
   */
  private async returnToPending(
    job: Job,
    next: { attempts: number; availableAt: Date; lastError: string; payload?: Prisma.InputJsonValue },
  ): Promise<Exclude<FailOutcome, 'terminal'>> {
    const lastError = next.lastError.slice(0, 2000);
    const retry = {
      attempts: next.attempts,
      status: JobStatus.PENDING,
      lastError,
      lockedAt: null,
      lockedBy: null,
      availableAt: next.availableAt,
      ...(next.payload === undefined ? {} : { payload: next.payload }),
    };

    if (job.dedupeKey === null || job.dedupeKey === undefined) {
      const count = await this.fencedUpdate(job, 'reintento', retry);
      return count === 0 ? 'lost' : 'retry';
    }

    let count: number;
    try {
      count = await this.fencedUpdate(job, 'reintento', retry);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const discarded = await this.fencedUpdate(job, 'descarte', {
        attempts: next.attempts,
        status: JobStatus.COMPLETED,
        lastError: `Descartado: ya existe un PENDING con la misma dedupeKey (${lastError}).`.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
      });
      return discarded === 0 ? 'lost' : 'discarded';
    }

    return count === 0 ? 'lost' : 'retry';
  }
}
