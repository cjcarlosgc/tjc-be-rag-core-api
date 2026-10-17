import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { InMemoryJobsRepository } from '../../test/support/in-memory-jobs.repository.js';
import { JobsService } from '../jobs/jobs.service.js';
import type { JobsRepository } from '../jobs/jobs.repository.js';
import { RescheduleJobError } from '../jobs/reschedule-job.error.js';
import { ACCESS_BACKOFF_MAX_MS, accessBackoffMs } from './access-backoff.js';

const KEY = 'ACCESS_REVERIFY:project-1:user-1';
const TYPE = 'access-reverify';

/**
 * Semántica de la cola para los jobs de acceso (HU61, `DEC-ORG-002` (s)) a través de
 * `JobsService`, con el modelo en memoria del SQL (verificado contra PostgreSQL real en
 * `jobs.repository.pg.spec.ts`): dedupe solo sobre PENDING, reclamo que espera a un RUNNING no
 * obsoleto de la misma clave, reprogramación con backoff sin consumir intentos y nota N1.
 */
describe('access jobs on the queue (HU61)', () => {
  let queue: InMemoryJobsRepository;
  let jobs: JobsService;
  let ran: string[];
  let behavior: (payload: { n: number }) => Promise<void>;

  beforeEach(() => {
    queue = new InMemoryJobsRepository();
    const config = { get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService;
    jobs = new JobsService(queue as unknown as JobsRepository, config);
    ran = [];
    behavior = () => Promise.resolve();
    jobs.registerHandler({
      type: TYPE,
      handle: async (payload: unknown) => {
        ran.push(JSON.stringify(payload));
        await behavior(payload as { n: number });
      },
    });
  });

  const enqueue = (n: number, delayMs = 0) => jobs.enqueueDeduped(TYPE, { n }, { dedupeKey: KEY, delayMs });

  it('deduplicates only over PENDING: a second event for the same (project, user) is absorbed', async () => {
    expect((await enqueue(1)).created).toBe(true);
    expect((await enqueue(2)).created).toBe(false);
    expect(queue.pending(KEY)).toHaveLength(1);
    expect(queue.pending(KEY)[0].payload).toEqual({ n: 1 });
  });

  it('an event that arrives DURING a RUNNING reverification enqueues a new one that runs AFTER it, never in parallel', async () => {
    await enqueue(1);
    let secondWorkerSaw: unknown = 'not-run';
    behavior = async ({ n }) => {
      if (n !== 1) {
        return;
      }
      // El evento llega mientras el job 1 está RUNNING: se encola (el RUNNING no bloquea al índice)...
      expect((await enqueue(2)).created).toBe(true);
      // ...pero un segundo worker NO lo reclama mientras el RUNNING siga vigente.
      secondWorkerSaw = await queue.claimNext('worker-b');
    };

    await jobs.runOnce();
    expect(secondWorkerSaw).toBeNull();
    expect(ran).toEqual(['{"n":1}']);

    await jobs.runOnce(); // el primero terminó: ahora corre el nuevo, que verifica en vivo
    expect(ran).toEqual(['{"n":1}', '{"n":2}']);
    expect(queue.jobs.every((job) => job.status === 'COMPLETED')).toBe(true);
  });

  it('a job of another type is not blocked by a RUNNING access job, and untyped jobs never wait', async () => {
    await enqueue(1);
    await queue.claimNext('worker-a'); // RUNNING con clave
    await enqueue(2);
    await queue.create('other-type', {}, 3);

    expect((await queue.claimNext('worker-b'))?.type).toBe('other-type');
    expect(await queue.claimNext('worker-b')).toBeNull();
  });

  it('a stale RUNNING lock stops blocking the PENDING with its key, which then runs', async () => {
    await enqueue(1);
    await queue.claimNext('dead-worker');
    await enqueue(2);
    expect(await queue.claimNext('worker-b')).toBeNull();

    queue.advance(700_000); // supera el umbral por defecto (10 min)

    expect(await queue.claimNext('worker-b')).toMatchObject({ payload: { n: 2 }, lockedBy: 'worker-b' });
  });

  it('a stale RUNNING lock is reclaimed (attempt consumed, back to PENDING with backoff) when nobody else holds its key', async () => {
    await enqueue(1);
    await queue.claimNext('dead-worker');
    queue.advance(700_000);

    await jobs.runOnce(); // barrido: lo libera; el backoff de 2 s aún no venció
    expect(queue.jobs[0]).toMatchObject({ status: 'PENDING', attempts: 1, lockedBy: null });
    expect(ran).toEqual([]);

    queue.advance(2_000);
    await jobs.runOnce();
    expect(ran).toEqual(['{"n":1}']);
  });

  describe('not verifiable: reschedule with growing backoff, without consuming attempts', () => {
    it('reschedules to PENDING with the handler payload, keeping attempts, until it can verify', async () => {
      await enqueue(1);
      behavior = ({ n }) => Promise.reject(new RescheduleJobError(accessBackoffMs(n), 'GitHub no verificable', { n: n + 1 }));

      await jobs.runOnce();
      const [job] = queue.jobs;
      expect(job).toMatchObject({ status: 'PENDING', attempts: 0, payload: { n: 2 } });
      expect(job.availableAt.getTime() - queue.now().getTime()).toBe(accessBackoffMs(1));

      // Todavía no toca; tras el backoff corre otra vez.
      await jobs.runOnce();
      expect(ran).toHaveLength(1);
      queue.advance(accessBackoffMs(1));
      await jobs.runOnce();
      expect(ran).toHaveLength(2);
      expect(queue.jobs[0].attempts).toBe(0);
    });

    it('when another PENDING with the same key already exists the current job is discarded, not returned to PENDING (N1)', async () => {
      await enqueue(1);
      behavior = async () => {
        await enqueue(2); // un evento nuevo encoló otro mientras este corría
        throw new RescheduleJobError(120_000, 'GitHub no verificable');
      };

      await jobs.runOnce();

      expect(queue.pending(KEY)).toHaveLength(1);
      expect(queue.jobs.find((job) => job.status === 'COMPLETED')?.lastError).toContain('Descartado');
    });

    it('an ordinary failure with backoff also discards itself if the key already has a PENDING (N1)', async () => {
      await enqueue(1);
      behavior = async () => {
        await enqueue(2);
        throw new Error('boom');
      };

      await jobs.runOnce();

      expect(queue.pending(KEY)).toHaveLength(1);
      expect(queue.jobs.filter((job) => job.status === 'COMPLETED')).toHaveLength(1);
    });
  });

  describe('accessBackoffMs', () => {
    it('grows and never exceeds one hour', () => {
      expect([0, 1, 2, 3].map(accessBackoffMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
      expect(accessBackoffMs(6)).toBe(ACCESS_BACKOFF_MAX_MS);
      expect(accessBackoffMs(1_000)).toBe(ACCESS_BACKOFF_MAX_MS);
      expect(accessBackoffMs(-3)).toBe(60_000);
    });
  });
});
