import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DEFAULT_STALE_LOCK_MS, JobsRepository, STALE_LOCK_REASON } from './jobs.repository.js';
import { RescheduleJobError } from './reschedule-job.error.js';
import type { JobHandler } from './job-handler.interface.js';
import type { Job, Prisma } from '../generated/prisma/client.js';

/** Cada cuánto, como máximo, se barren los locks obsoletos (un poll por segundo no debe consultarlo). */
const STALE_SWEEP_INTERVAL_MS = 30_000;

/** Intervalo por defecto del latido del lock de un job en curso (`JOBS_HEARTBEAT_INTERVAL_MS`). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly workerId = randomUUID();
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private lastStaleSweepAt = 0;

  constructor(
    private readonly jobsRepository: JobsRepository,
    private readonly configService: ConfigService,
  ) {}

  registerHandler(handler: JobHandler): void {
    this.handlers.set(handler.type, handler);
  }

  async enqueue(
    type: string,
    payload: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const maxAttempts = this.configService.get<number>('JOBS_MAX_ATTEMPTS', 3);
    const job = await this.jobsRepository.create(type, payload, maxAttempts, tx);
    return job.id;
  }

  /** Umbral (ms) desde el que un lock `RUNNING` de un job con `dedupeKey` se considera obsoleto. */
  get staleLockMs(): number {
    return this.configService.get<number>('JOBS_STALE_LOCK_MS', DEFAULT_STALE_LOCK_MS);
  }

  /**
   * Alta deduplicada por `dedupeKey` (jobs de acceso, HU61): no crea nada si ya existe un
   * `PENDING` con esa clave (`created: false`, el existente cubre la misma verificación) y,
   * con `skipIfRunning` (siembra al arrancar), tampoco si hay un `RUNNING` no obsoleto. La
   * fila `RUNNING` de quien se autoencola NO cuenta (sin `skipIfRunning`).
   */
  async enqueueDeduped(
    type: string,
    payload: Prisma.InputJsonValue,
    options: { dedupeKey: string; delayMs?: number; skipIfRunning?: boolean },
  ): Promise<{ created: boolean; jobId: string | null }> {
    const jobId = await this.jobsRepository.insertDeduped({
      type,
      payload,
      maxAttempts: this.configService.get<number>('JOBS_MAX_ATTEMPTS', 3),
      dedupeKey: options.dedupeKey,
      delayMs: options.delayMs,
      skipIfRunning: options.skipIfRunning,
      staleLockMs: this.staleLockMs,
    });

    return { created: jobId !== null, jobId };
  }

  /**
   * Un evento que se absorbió en un `PENDING` reprogramado con backoff lo adelanta a "ahora":
   * la verificación pendiente debe intentarse con el evento nuevo, no esperar hasta una hora.
   */
  expediteDeduped(dedupeKey: string): Promise<number> {
    return this.jobsRepository.expedite(dedupeKey);
  }

  /** Reemplaza el payload del `PENDING` con esa clave (cursor de la siguiente ocurrencia). */
  updatePendingPayload(dedupeKey: string, payload: Prisma.InputJsonValue): Promise<void> {
    return this.jobsRepository.updatePendingPayload(dedupeKey, payload);
  }

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>('JOBS_POLL_INTERVAL_MS', 1000);
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runOnce(): Promise<void> {
    if (this.polling) {
      return;
    }

    this.polling = true;

    try {
      await this.sweepStaleLocks();

      const job = await this.jobsRepository.claimNext(this.workerId, this.staleLockMs);

      if (!job) {
        return;
      }

      const handler = this.handlers.get(job.type);

      if (!handler) {
        this.logger.error(`Sin handler registrado para el tipo de job "${job.type}".`);
        await this.jobsRepository.fail(job, `Sin handler registrado para "${job.type}".`, true);
        return;
      }

      try {
        await this.runHandler(handler, job);
        await this.jobsRepository.complete(job);
      } catch (error) {
        if (error instanceof RescheduleJobError) {
          await this.jobsRepository.reschedule(job, error.delayMs, error.reason, error.payload);
          return;
        }

        const message = error instanceof Error ? error.message : 'Error desconocido en el job.';
        this.logger.error(`Job ${job.id} (${job.type}) falló: ${message}`);
        const outcome = await this.jobsRepository.fail(job, message);

        if (outcome === 'terminal') {
          await this.notifyExhausted(job, message);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * Ejecuta el handler con el latido del lock activo: el latido arranca antes de `handle()` y se
   * detiene en `finally`, también si el handler falla o si se reprograma.
   */
  private async runHandler(handler: JobHandler, job: Job): Promise<void> {
    const stopHeartbeat = this.startJobHeartbeat(job);

    try {
      await handler.handle(job.payload, job.id);
    } finally {
      stopHeartbeat();
    }
  }

  /**
   * Latido del lock de un job en curso (DEC-JOBS-002): renueva `lockedAt` cada
   * `JOBS_HEARTBEAT_INTERVAL_MS` para que un handler lento no parezca un worker caído. Un fallo al
   * escribir se registra y no interrumpe el handler. Devuelve la función que detiene el latido.
   */
  private startJobHeartbeat(job: Job): () => void {
    const intervalMs = this.configService.get<number>('JOBS_HEARTBEAT_INTERVAL_MS', DEFAULT_HEARTBEAT_INTERVAL_MS);
    const timer = setInterval(() => {
      void Promise.resolve()
        .then(() => this.jobsRepository.touchLock(job.id, this.workerId))
        .then((renewed) => {
          if (!renewed) {
            this.logger.warn(`Job ${job.id} (${job.type}): el lock ya no pertenece a este worker; no se renueva.`);
          }
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `No se pudo renovar el lock del job ${job.id} (${job.type}): ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }, intervalMs);
    timer.unref?.();

    return () => clearInterval(timer);
  }

  /**
   * Libera los locks `RUNNING` obsoletos de los jobs con `dedupeKey`, a lo sumo una vez por
   * intervalo de barrido (no en cada poll). Un fallo del barrido no detiene el reclamo.
   */
  private async sweepStaleLocks(): Promise<void> {
    const now = Date.now();
    const interval = Math.min(this.staleLockMs, STALE_SWEEP_INTERVAL_MS);

    if (now - this.lastStaleSweepAt < interval) {
      return;
    }

    this.lastStaleSweepAt = now;

    try {
      const { released, exhausted } = await this.jobsRepository.releaseStale(this.staleLockMs);

      if (released > 0) {
        this.logger.warn(`Se liberaron ${released} lock(s) obsoleto(s) de jobs con dedupeKey o tipo liberable.`);
      }

      for (const job of exhausted) {
        await this.notifyExhausted(job, STALE_LOCK_REASON);
      }
    } catch (error) {
      this.logger.error(`No se pudieron liberar los locks obsoletos: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Invoca el gancho `onExhausted` del handler del tipo cuando el job quedó FAILED terminal (WI-CORE-030).
   * Un error del gancho se registra y no interrumpe el barrido ni el reclamo.
   */
  private async notifyExhausted(job: Job, reason: string): Promise<void> {
    const handler = this.handlers.get(job.type);

    if (!handler?.onExhausted) {
      return;
    }

    try {
      await handler.onExhausted(job.payload, reason);
    } catch (error) {
      this.logger.error(
        `El cierre del job ${job.id} (${job.type}) falló: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
