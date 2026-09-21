import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/prisma/client.js';
import { JobsRepository } from './jobs.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * HU61 (corte 5a): SQL real de la cola con `dedupeKey` (índice único parcial solo sobre
 * PENDING, reclamo que excluye un PENDING con un RUNNING no obsoleto, reclamo de locks
 * obsoletos, N1). Necesita un PostgreSQL LOCAL descartable con las migraciones de `jobs`
 * aplicadas: sin `JOBS_TEST_DATABASE_URL` se omite (la suite normal usa fakes y nunca toca
 * Supabase). La URL debe apuntar a localhost: la suite VACÍA la tabla `jobs`. Como Supabase,
 * la base debe usar `timezone = 'UTC'` (`ALTER DATABASE ... SET timezone TO 'UTC'`): las columnas
 * son `timestamp` sin zona y la cola las compara con `now()`.
 *
 *   JOBS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/jobs_test npx vitest run src/jobs/jobs.repository.pg.spec.ts
 */
const url = process.env.JOBS_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

describe.skipIf(!url)('JobsRepository against a local PostgreSQL (dedupeKey, HU61)', () => {
  let prisma: PrismaClient;
  let repository: JobsRepository;

  beforeAll(() => {
    if (!isLocal) {
      throw new Error('JOBS_TEST_DATABASE_URL debe apuntar a localhost (la suite vacía la tabla jobs).');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    repository = new JobsRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "jobs"`;
  });

  const KEY = 'ACCESS_REVERIFY:project-1:user-1';
  const insert = (dedupeKey = KEY, extra: Partial<Parameters<JobsRepository['insertDeduped']>[0]> = {}) =>
    repository.insertDeduped({ type: 'access-reverify', payload: { n: 1 }, maxAttempts: 3, dedupeKey, ...extra });
  const rows = () => prisma.job.findMany({ orderBy: { createdAt: 'asc' } });
  const age = (id: string, seconds: number) =>
    prisma.$executeRaw`UPDATE "jobs" SET "lockedAt" = now() - make_interval(secs => ${seconds}::double precision) WHERE "id" = ${id}`;

  describe('deduplication only over PENDING', () => {
    it('does not create a second PENDING with the same dedupeKey, but does with another key', async () => {
      expect(await insert()).toEqual(expect.any(String));
      expect(await insert()).toBeNull();
      expect(await insert('ACCESS_REVERIFY:project-1:user-2')).toEqual(expect.any(String));
      expect(await rows()).toHaveLength(2);
    });

    it('does not deduplicate jobs without dedupeKey (create is unchanged)', async () => {
      await repository.create('snapshot-analysis', { a: 1 }, 3);
      await repository.create('snapshot-analysis', { a: 1 }, 3);
      expect(await rows()).toHaveLength(2);
    });

    it('a RUNNING row does not block the next occurrence (the chain enqueues itself at the start of its run)', async () => {
      await insert();
      const running = await repository.claimNext('worker-a');
      expect(running).toMatchObject({ status: 'RUNNING', dedupeKey: KEY });

      expect(await insert(KEY, { delayMs: 3_600_000 })).toEqual(expect.any(String));
      expect(await insert(KEY, { delayMs: 3_600_000 })).toBeNull();
      expect((await rows()).map((row) => row.status).sort()).toEqual(['PENDING', 'RUNNING']);
    });

    it('a COMPLETED row does not block either', async () => {
      const id = (await insert())!;
      await repository.complete(id);
      expect(await insert()).toEqual(expect.any(String));
    });

    it('schedules the new job in the future using the database clock', async () => {
      await insert(KEY, { delayMs: 3_600_000 });
      expect(await repository.claimNext('worker-a')).toBeNull();
      const [row] = await prisma.$queryRaw<Array<{ ahead: number }>>`
        SELECT extract(epoch FROM ("availableAt" - now()))::float AS ahead FROM "jobs"`;
      expect(row.ahead).toBeGreaterThan(3_590);
      expect(row.ahead).toBeLessThan(3_610);
    });
  });

  describe('seeding (skipIfRunning)', () => {
    it('is skipped while there is a PENDING or a non-stale RUNNING, and created when the RUNNING is stale', async () => {
      const key = 'ACCESS_RECONCILIATION';
      expect(await insert(key, { skipIfRunning: true })).toEqual(expect.any(String));
      expect(await insert(key, { skipIfRunning: true })).toBeNull(); // PENDING

      const running = (await repository.claimNext('worker-a'))!;
      expect(await insert(key, { skipIfRunning: true })).toBeNull(); // RUNNING vigente

      await age(running.id, 3_600);
      expect(await insert(key, { skipIfRunning: true, staleLockMs: 600_000 })).toEqual(expect.any(String)); // RUNNING obsoleto = ausente
    });
  });

  describe('claimNext', () => {
    it('does not claim a PENDING whose dedupeKey matches a non-stale RUNNING, and claims the others', async () => {
      await insert();
      const first = (await repository.claimNext('worker-a'))!;
      await insert(); // evento durante el RUNNING: encola uno nuevo
      await repository.create('snapshot-analysis', { a: 1 }, 3);

      const next = await repository.claimNext('worker-b');
      expect(next).toMatchObject({ type: 'snapshot-analysis', dedupeKey: null });
      expect(await repository.claimNext('worker-b')).toBeNull(); // el PENDING con la clave espera

      await repository.complete(first.id);
      expect(await repository.claimNext('worker-b')).toMatchObject({ dedupeKey: KEY, status: 'RUNNING' });
    });

    it('claims the PENDING when the RUNNING with the same key is stale', async () => {
      await insert();
      const first = (await repository.claimNext('worker-a'))!;
      await insert();
      await age(first.id, 3_600);

      expect(await repository.claimNext('worker-b', 600_000)).toMatchObject({ dedupeKey: KEY, lockedBy: 'worker-b' });
    });

    it('keeps claiming untyped jobs in availableAt order', async () => {
      const a = await repository.create('t', {}, 3);
      const b = await repository.create('t', {}, 3);
      expect((await repository.claimNext('w'))?.id).toBe(a.id);
      expect((await repository.claimNext('w'))?.id).toBe(b.id);
    });
  });

  describe('fail and reschedule (note N1)', () => {
    it('returns the job to PENDING with backoff when nobody else holds its key', async () => {
      await insert();
      const job = (await repository.claimNext('w'))!;

      await repository.fail(job, 'boom');

      expect(await rows()).toEqual([expect.objectContaining({ status: 'PENDING', attempts: 1, lastError: 'boom', lockedBy: null })]);
    });

    it('completes/discards the current job instead of colliding with another PENDING of the same key', async () => {
      await insert();
      const job = (await repository.claimNext('w'))!;
      await insert(); // otro PENDING con la misma clave

      await repository.fail(job, 'boom');

      const all = await rows();
      expect(all.filter((row) => row.status === 'PENDING')).toHaveLength(1);
      expect(all.find((row) => row.id === job.id)).toMatchObject({ status: 'COMPLETED', lockedBy: null });
    });

    it('reschedules without consuming an attempt, updating the payload, and also discards on collision', async () => {
      await insert();
      const job = (await repository.claimNext('w'))!;
      await repository.reschedule(job, 120_000, 'GitHub no verificable', { deferrals: 1 });

      const [row] = await rows();
      expect(row).toMatchObject({ status: 'PENDING', attempts: 0, payload: { deferrals: 1 } });
      expect(row.availableAt.getTime()).toBeGreaterThan(Date.now() + 60_000);

      await prisma.job.update({ where: { id: row.id }, data: { availableAt: new Date(0) } });
      const again = (await repository.claimNext('w'))!;
      await insert();
      await repository.reschedule(again, 120_000, 'GitHub no verificable');
      expect((await rows()).find((r) => r.id === again.id)?.status).toBe('COMPLETED');
    });

    it('marks it FAILED without touching the index when attempts run out', async () => {
      await insert(KEY, {});
      await prisma.job.updateMany({ data: { maxAttempts: 1 } });
      const job = (await repository.claimNext('w'))!;
      await repository.fail(job, 'boom');
      expect((await rows())[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    });
  });

  describe('releaseStale', () => {
    it('requeues a stale RUNNING with dedupeKey, or discards it if the key already has a PENDING', async () => {
      await insert();
      const stale = (await repository.claimNext('dead-worker'))!;
      await age(stale.id, 3_600);

      expect(await repository.releaseStale(600_000)).toBe(1);
      expect((await rows())[0]).toMatchObject({ status: 'PENDING', attempts: 1, lockedBy: null });

      await prisma.job.updateMany({ data: { availableAt: new Date(0) } }); // saltar el backoff
      const again = (await repository.claimNext('dead-worker'))!;
      await insert();
      await age(again.id, 3_600);
      expect(await repository.releaseStale(600_000)).toBe(1);
      expect((await rows()).find((row) => row.id === again.id)?.status).toBe('COMPLETED');
    });

    it('does not touch a fresh RUNNING, nor a stale RUNNING without dedupeKey (untyped jobs never get reclaimed)', async () => {
      await insert();
      await repository.claimNext('w');
      const other = await repository.create('snapshot-analysis', {}, 3);
      const claimed = (await repository.claimNext('w'))!;
      expect(claimed.id).toBe(other.id);
      await age(claimed.id, 36_000);

      expect(await repository.releaseStale(600_000)).toBe(0);
      expect((await rows()).map((row) => row.status)).toEqual(['RUNNING', 'RUNNING']);
    });
  });

  it('updatePendingPayload only changes the PENDING with that key', async () => {
    await insert();
    const running = (await repository.claimNext('w'))!;
    await insert(KEY, { delayMs: 1000 });

    await repository.updatePendingPayload(KEY, { afterBindingId: 'b-9' });

    const all = await rows();
    expect(all.find((row) => row.status === 'PENDING')?.payload).toEqual({ afterBindingId: 'b-9' });
    expect(all.find((row) => row.id === running.id)?.payload).toEqual({ n: 1 });
  });
});
