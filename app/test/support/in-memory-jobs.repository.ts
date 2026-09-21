import { randomUUID } from 'node:crypto';
import type { InsertDedupedJobInput } from '../../src/jobs/jobs.repository.js';
import type { Job, Prisma } from '../../src/generated/prisma/client.js';

const DEFAULT_STALE_LOCK_MS = 600_000;

/**
 * Modelo en memoria de `JobsRepository` con la MISMA semántica que su SQL (verificado contra
 * PostgreSQL real en `jobs.repository.pg.spec.ts`): índice único parcial solo sobre PENDING,
 * reclamo que excluye un PENDING cuya `dedupeKey` coincide con un RUNNING no obsoleto, reclamo
 * de locks obsoletos solo de jobs con clave y nota N1. El reloj es controlable para probar
 * backoff, siembra y locks obsoletos sin esperar.
 */
export class InMemoryJobsRepository {
  readonly jobs: Job[] = [];
  private nowMs = Date.parse('2026-09-21T12:00:00.000Z');

  now(): Date {
    return new Date(this.nowMs);
  }

  advance(ms: number): void {
    this.nowMs += ms;
  }

  pending(dedupeKey?: string): Job[] {
    return this.jobs.filter((job) => job.status === 'PENDING' && (dedupeKey === undefined || job.dedupeKey === dedupeKey));
  }

  private insert(fields: Partial<Job> & Pick<Job, 'type' | 'payload'>): Job {
    const job: Job = {
      id: randomUUID(),
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      lastError: null,
      availableAt: this.now(),
      lockedAt: null,
      lockedBy: null,
      dedupeKey: null,
      createdAt: this.now(),
      updatedAt: this.now(),
      ...fields,
    };
    this.jobs.push(job);
    return job;
  }

  create(type: string, payload: Prisma.InputJsonValue, maxAttempts: number): Promise<Job> {
    return Promise.resolve(this.insert({ type, payload, maxAttempts }));
  }

  insertDeduped(input: InsertDedupedJobInput): Promise<string | null> {
    const stale = input.staleLockMs ?? DEFAULT_STALE_LOCK_MS;

    if (this.pending(input.dedupeKey).length > 0) {
      return Promise.resolve(null);
    }

    if (input.skipIfRunning && this.hasFreshRunning(input.dedupeKey, stale)) {
      return Promise.resolve(null);
    }

    const job = this.insert({
      type: input.type,
      payload: input.payload,
      maxAttempts: input.maxAttempts,
      dedupeKey: input.dedupeKey,
      availableAt: new Date(this.nowMs + (input.delayMs ?? 0)),
    });
    return Promise.resolve(job.id);
  }

  claimNext(workerId: string, staleLockMs = DEFAULT_STALE_LOCK_MS): Promise<Job | null> {
    const candidate = this.jobs
      .filter(
        (job) =>
          job.status === 'PENDING' &&
          job.availableAt.getTime() <= this.nowMs &&
          (job.dedupeKey === null || !this.hasFreshRunning(job.dedupeKey, staleLockMs)),
      )
      .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())[0];

    if (!candidate) {
      return Promise.resolve(null);
    }

    Object.assign(candidate, { status: 'RUNNING', lockedAt: this.now(), lockedBy: workerId, updatedAt: this.now() });
    return Promise.resolve({ ...candidate });
  }

  complete(jobId: string): Promise<void> {
    Object.assign(this.byId(jobId), { status: 'COMPLETED', lockedAt: null, lockedBy: null });
    return Promise.resolve();
  }

  fail(job: Job, errorMessage: string, forceTerminal = false): Promise<void> {
    const attempts = job.attempts + 1;

    if (forceTerminal || attempts >= job.maxAttempts) {
      Object.assign(this.byId(job.id), { attempts, status: 'FAILED', lastError: errorMessage, lockedAt: null, lockedBy: null });
      return Promise.resolve();
    }

    this.returnToPending(job, attempts, Math.min(2 ** attempts * 1000, 60_000), errorMessage);
    return Promise.resolve();
  }

  reschedule(job: Job, delayMs: number, reason: string, payload?: Prisma.InputJsonValue): Promise<void> {
    this.returnToPending(job, job.attempts, delayMs, reason, payload);
    return Promise.resolve();
  }

  releaseStale(staleLockMs = DEFAULT_STALE_LOCK_MS): Promise<number> {
    const stale = this.jobs.filter(
      (job) => job.status === 'RUNNING' && job.dedupeKey !== null && job.lockedAt !== null && job.lockedAt.getTime() <= this.nowMs - staleLockMs,
    );

    for (const job of stale) {
      void this.fail({ ...job }, 'Lock obsoleto: el worker que lo reclamó dejó de responder.');
    }

    return Promise.resolve(stale.length);
  }

  expedite(dedupeKey: string): Promise<number> {
    const targets = this.pending(dedupeKey).filter((job) => job.availableAt.getTime() > this.nowMs);
    targets.forEach((job) => {
      job.availableAt = this.now();
    });
    return Promise.resolve(targets.length);
  }

  updatePendingPayload(dedupeKey: string, payload: Prisma.InputJsonValue): Promise<void> {
    this.pending(dedupeKey).forEach((job) => {
      job.payload = payload;
    });
    return Promise.resolve();
  }

  private hasFreshRunning(dedupeKey: string, staleLockMs: number): boolean {
    return this.jobs.some(
      (job) => job.status === 'RUNNING' && job.dedupeKey === dedupeKey && job.lockedAt !== null && job.lockedAt.getTime() > this.nowMs - staleLockMs,
    );
  }

  /** Nota N1: no vuelve a PENDING si ya hay otro PENDING con la misma clave (índice único parcial): se descarta. */
  private returnToPending(job: Job, attempts: number, delayMs: number, reason: string, payload?: Prisma.InputJsonValue): void {
    const row = this.byId(job.id);
    const collides = row.dedupeKey !== null && this.pending(row.dedupeKey).some((other) => other.id !== row.id);

    if (collides) {
      Object.assign(row, { attempts, status: 'COMPLETED', lastError: `Descartado: ya existe un PENDING con la misma dedupeKey (${reason}).`, lockedAt: null, lockedBy: null });
      return;
    }

    Object.assign(row, {
      attempts,
      status: 'PENDING',
      lastError: reason,
      lockedAt: null,
      lockedBy: null,
      availableAt: new Date(this.nowMs + delayMs),
      ...(payload === undefined ? {} : { payload }),
    });
  }

  private byId(id: string): Job {
    const job = this.jobs.find((row) => row.id === id);
    if (!job) {
      throw new Error(`job ${id} no encontrado`);
    }
    return job;
  }
}
