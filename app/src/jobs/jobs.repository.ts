import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Job, Prisma } from '../generated/prisma/client.js';
import { JobStatus } from '../generated/prisma/enums.js';

/** Umbral por defecto de un lock `RUNNING` obsoleto (`JOBS_STALE_LOCK_MS`). */
export const DEFAULT_STALE_LOCK_MS = 600_000;

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
             now() + make_interval(secs => ${delaySeconds}::double precision), ${input.dedupeKey}, now(), now()
      WHERE NOT (${input.skipIfRunning === true}::boolean AND EXISTS (
        SELECT 1 FROM "jobs" r
        WHERE r."status" = 'RUNNING' AND r."dedupeKey" = ${input.dedupeKey}
          AND r."lockedAt" > now() - make_interval(secs => ${staleSeconds}::double precision)
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
      SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "updatedAt" = now()
      WHERE "id" = (
        SELECT j."id" FROM "jobs" j
        WHERE j."status" = 'PENDING' AND j."availableAt" <= now()
          AND (j."dedupeKey" IS NULL OR NOT EXISTS (
            SELECT 1 FROM "jobs" r
            WHERE r."status" = 'RUNNING' AND r."dedupeKey" = j."dedupeKey"
              AND r."lockedAt" > now() - make_interval(secs => ${staleSeconds}::double precision)
          ))
        ORDER BY j."availableAt"
        FOR UPDATE OF j SKIP LOCKED
        LIMIT 1
      )
      RETURNING *;
    `;

    return rows[0] ?? null;
  }

  async complete(jobId: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.COMPLETED, lockedAt: null, lockedBy: null },
    });
  }

  async fail(job: Job, errorMessage: string, forceTerminal = false): Promise<void> {
    const attempts = job.attempts + 1;
    const isTerminal = forceTerminal || attempts >= job.maxAttempts;
    const backoffMs = Math.min(2 ** attempts * 1000, 60_000);

    if (isTerminal) {
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          attempts,
          status: JobStatus.FAILED,
          lastError: errorMessage.slice(0, 2000),
          lockedAt: null,
          lockedBy: null,
        },
      });
      return;
    }

    await this.returnToPending(job, {
      attempts,
      availableAt: new Date(Date.now() + backoffMs),
      lastError: errorMessage,
    });
  }

  /**
   * Devuelve un job `RUNNING` a `PENDING` a las `delayMs` sin consumir un intento (p. ej. un
   * `ACCESS_REVERIFY` cuya verificación no fue posible por una caída de GitHub). Aplica la
   * misma salvaguarda que `fail` ante el índice único parcial.
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
   * Libera los locks `RUNNING` obsoletos (worker caído) SOLO de jobs con `dedupeKey` (los
   * de acceso, cortos y acotados por presupuesto): un tipo sin clave puede tardar más que
   * el umbral y reclamarlo lo ejecutaría dos veces. Cada uno consume un intento (vuelve a
   * `PENDING` con backoff, o `FAILED` sin intentos) y respeta el índice único parcial:
   * si ya hay un `PENDING` con su clave, el obsoleto se descarta. Devuelve cuántos liberó.
   */
  async releaseStale(staleLockMs = DEFAULT_STALE_LOCK_MS, limit = 50): Promise<number> {
    const staleSeconds = staleLockMs / 1000;
    const stale = await this.prisma.$queryRaw<Job[]>`
      SELECT * FROM "jobs"
      WHERE "status" = 'RUNNING' AND "dedupeKey" IS NOT NULL
        AND "lockedAt" <= now() - make_interval(secs => ${staleSeconds}::double precision)
      ORDER BY "lockedAt"
      LIMIT ${limit};
    `;

    for (const job of stale) {
      await this.fail(job, 'Lock obsoleto: el worker que lo reclamó dejó de responder.');
    }

    return stale.length;
  }

  /**
   * Adelanta a "ahora" el `PENDING` con esa clave si estaba reprogramado al futuro (backoff de un
   * `ACCESS_REVERIFY` no verificable): un evento nuevo que se absorbe en él no debe esperar el
   * backoff. Con el reloj de la base, como el resto de la cola. Devuelve cuántas filas adelantó.
   */
  async expedite(dedupeKey: string): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE "jobs" SET "availableAt" = now(), "updatedAt" = now()
      WHERE "status" = 'PENDING' AND "dedupeKey" = ${dedupeKey} AND "availableAt" > now()
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
  ): Promise<void> {
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
      await this.prisma.job.update({ where: { id: job.id }, data: retry });
      return;
    }

    try {
      await this.prisma.job.update({ where: { id: job.id }, data: retry });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          attempts: next.attempts,
          status: JobStatus.COMPLETED,
          lastError: `Descartado: ya existe un PENDING con la misma dedupeKey (${lastError}).`.slice(0, 2000),
          lockedAt: null,
          lockedBy: null,
        },
      });
    }
  }
}
