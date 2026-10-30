import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  ExperimentCaptureAlreadyArmedError,
  ExperimentCapturesRepository,
} from './experiment-captures.repository.js';

/**
 * WI-CORE-109 (HU18) contra un PostgreSQL LOCAL con las migraciones aplicadas:
 * - el índice único parcial `experiment_captures_one_armed_per_project_key` garantiza una sola captura ARMED por
 *   Project (lo prueba también con SQL directo, no solo con el repositorio);
 * - la reserva es atómica y dos reservas concurrentes para el mismo Project dejan exactamente una;
 * - un fallo a mitad de la reserva revierte la captura (sigue ARMED);
 * - `analysis_runs.experimentCaptureId` es único y las tablas nuevas tienen RLS.
 *
 * Sin `CT_TEST_DATABASE_URL` (localhost) se omite. Crea sus propias filas con ids únicos y borra solo esas.
 *
 *   CT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/rag_core_ct?schema=public \
 *     pnpm exec vitest run src/experiment-captures/persistence/experiment-captures.repository.pg.spec.ts
 */
const url = process.env.CT_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

describe.skipIf(!url)('WI-CORE-109: capturas armadas contra un PostgreSQL local', () => {
  let prisma: PrismaClient;
  let repository: ExperimentCapturesRepository;

  const userId = `capture-user-${randomUUID()}`;
  const projectId = randomUUID();
  const otherProjectId = randomUUID();

  const createRun = (project: string, prNumber: number) =>
    prisma.analysisRun.create({
      data: {
        projectId: project,
        repositoryId: 'repo-capture',
        repositoryName: 'org/capture',
        prNumber,
        prTitle: `PR ${prNumber}`,
        baseRef: 'develop',
        headRef: `feature/${prNumber}`,
        baseSha: 'base',
        headSha: `head-${prNumber}`,
        changesetBaseSha: 'base',
        changesetHeadSha: `head-${prNumber}`,
      },
    });

  beforeAll(async () => {
    if (!isLocal) {
      throw new Error('CT_TEST_DATABASE_URL debe apuntar a localhost.');
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    repository = new ExperimentCapturesRepository(prisma as unknown as PrismaService);

    await prisma.project.createMany({
      data: [
        { id: projectId, name: `capture-${projectId}`, ownerUserId: userId },
        { id: otherProjectId, name: `capture-${otherProjectId}`, ownerUserId: userId },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) {
      // Orden por claves foráneas: primero los Runs (RESTRICT sobre la captura), luego las capturas, luego Projects.
      await prisma.analysisRun.deleteMany({ where: { projectId: { in: [projectId, otherProjectId] } } });
      await prisma.experimentCapture.deleteMany({ where: { projectId: { in: [projectId, otherProjectId] } } });
      await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
      await prisma.$disconnect();
    }
  });

  it('la migración deja RLS en la tabla y el índice único parcial con su predicado', async () => {
    const rls = await prisma.$queryRaw<Array<{ relrowsecurity: boolean }>>`
      SELECT relrowsecurity FROM pg_class WHERE relname = 'experiment_captures'`;
    expect(rls[0]?.relrowsecurity).toBe(true);

    const partial = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'experiment_captures_one_armed_per_project_key'`;
    expect(partial[0]?.indexdef).toMatch(/UNIQUE INDEX .* \("projectId"\) WHERE \(status = 'ARMED'::"ExperimentCaptureStatus"\)/);

    const unique = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'analysis_runs_experimentCaptureId_key'`;
    expect(unique[0]?.indexdef).toMatch(/UNIQUE INDEX/);
  });

  it('arma una captura y una segunda ARMED del mismo Project responde ExperimentCaptureAlreadyArmedError', async () => {
    const first = await repository.arm(projectId, userId);
    expect(first.status).toBe('ARMED');
    expect(first.armedByUserId).toBe(userId);

    await expect(repository.arm(projectId, userId)).rejects.toBeInstanceOf(ExperimentCaptureAlreadyArmedError);

    // Desarmar para dejar el Project limpio a las pruebas siguientes.
    await repository.disarmArmed(projectId, userId);
  });

  it('el índice rechaza una segunda ARMED con una inserción directa, sin pasar por el repositorio', async () => {
    await repository.arm(projectId, userId);

    await expect(
      prisma.experimentCapture.create({ data: { projectId, armedByUserId: userId, status: 'ARMED' } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await repository.disarmArmed(projectId, userId);
  });

  it('tras RESERVED o DISARMED el Project puede armar otra captura; el histórico conserva ambas', async () => {
    const run = await createRun(projectId, 101);
    const consumed = await repository.arm(projectId, userId);
    const reservation = await repository.reserveIfArmed(projectId, run.id);
    expect(reservation?.captureId).toBe(consumed.id);

    const afterReserve = await repository.arm(projectId, userId);
    expect(afterReserve.status).toBe('ARMED');

    const disarmed = await repository.disarmArmed(projectId, userId);
    expect(disarmed).toMatchObject({ id: afterReserve.id, status: 'DISARMED', disarmedByUserId: userId });
    expect(disarmed?.disarmedAt).toBeInstanceOf(Date);

    const again = await repository.arm(projectId, userId);
    expect(again.status).toBe('ARMED');
    await repository.disarmArmed(projectId, userId);
  });

  it('reserveIfArmed sin captura armada devuelve null y no toca el Run', async () => {
    const run = await createRun(otherProjectId, 201);

    await expect(repository.reserveIfArmed(otherProjectId, run.id)).resolves.toBeNull();

    const unchanged = await prisma.analysisRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(unchanged.experimentCaptureId).toBeNull();
  });

  it('una captura ya consumida o desarmada no se reserva de nuevo: el segundo Run queda sin captura', async () => {
    const consumedProject = randomUUID();
    await prisma.project.create({ data: { id: consumedProject, name: `consumed-${consumedProject}`, ownerUserId: userId } });

    try {
      const runA = await createRun(consumedProject, 501);
      const runB = await createRun(consumedProject, 502);
      const runC = await createRun(consumedProject, 503);
      const consumed = await repository.arm(consumedProject, userId);
      await repository.reserveIfArmed(consumedProject, runA.id);

      // Sin ninguna captura ARMED: la reserva no toca la RESERVED previa ni enlaza nada al segundo Run.
      await expect(repository.reserveIfArmed(consumedProject, runB.id)).resolves.toBeNull();

      const stillConsumed = await prisma.experimentCapture.findUniqueOrThrow({ where: { id: consumed.id } });
      expect(stillConsumed).toMatchObject({ status: 'RESERVED', reservedAnalysisRunId: runA.id });

      // Una captura DISARMED tampoco se reserva.
      await repository.arm(consumedProject, userId);
      await repository.disarmArmed(consumedProject, userId);
      await expect(repository.reserveIfArmed(consumedProject, runC.id)).resolves.toBeNull();

      const runs = await prisma.analysisRun.findMany({
        where: { id: { in: [runA.id, runB.id, runC.id] } },
        select: { id: true, experimentCaptureId: true },
      });
      expect(runs.filter((run) => run.experimentCaptureId !== null).map((run) => run.id)).toEqual([runA.id]);
    } finally {
      await prisma.analysisRun.deleteMany({ where: { projectId: consumedProject } });
      await prisma.experimentCapture.deleteMany({ where: { projectId: consumedProject } });
      await prisma.project.deleteMany({ where: { id: consumedProject } });
    }
  });

  it('reserveIfArmed marca la captura RESERVED y enlaza el Run; la carga del Run expone reservedAt', async () => {
    const run = await createRun(otherProjectId, 202);
    const armed = await repository.arm(otherProjectId, userId);

    const reservation = await repository.reserveIfArmed(otherProjectId, run.id);

    expect(reservation).toEqual({ captureId: armed.id, reservedAt: expect.any(Date) });
    const capture = await prisma.experimentCapture.findUniqueOrThrow({ where: { id: armed.id } });
    expect(capture).toMatchObject({ status: 'RESERVED', reservedAnalysisRunId: run.id });
    expect(capture.reservedAt).toBeInstanceOf(Date);

    const loaded = await prisma.analysisRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { experimentCapture: { select: { id: true, reservedAt: true } } },
    });
    expect(loaded.experimentCaptureId).toBe(armed.id);
    expect(loaded.experimentCapture?.reservedAt?.getTime()).toBe(capture.reservedAt?.getTime());
  });

  it('dos reservas concurrentes para el mismo Project: exactamente una gana', async () => {
    const concurrentProject = randomUUID();
    await prisma.project.create({ data: { id: concurrentProject, name: `race-${concurrentProject}`, ownerUserId: userId } });

    try {
      await repository.arm(concurrentProject, userId);
      const runA = await createRun(concurrentProject, 301);
      const runB = await createRun(concurrentProject, 302);

      const results = await Promise.all([
        repository.reserveIfArmed(concurrentProject, runA.id),
        repository.reserveIfArmed(concurrentProject, runB.id),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);

      const linked = await prisma.analysisRun.findMany({
        where: { id: { in: [runA.id, runB.id] } },
        select: { id: true, experimentCaptureId: true },
      });
      expect(linked.filter((run) => run.experimentCaptureId !== null)).toHaveLength(1);

      const captures = await prisma.experimentCapture.findMany({ where: { projectId: concurrentProject } });
      expect(captures.map((capture) => capture.status)).toEqual(['RESERVED']);
    } finally {
      await prisma.analysisRun.deleteMany({ where: { projectId: concurrentProject } });
      await prisma.experimentCapture.deleteMany({ where: { projectId: concurrentProject } });
      await prisma.project.deleteMany({ where: { id: concurrentProject } });
    }
  });

  it('un fallo a mitad de la reserva revierte la captura: sigue ARMED y sin reservedAt', async () => {
    const armed = await repository.arm(projectId, userId);

    await expect(repository.reserveIfArmed(projectId, 'run-that-does-not-exist')).rejects.toThrow();

    const capture = await prisma.experimentCapture.findUniqueOrThrow({ where: { id: armed.id } });
    expect(capture.status).toBe('ARMED');
    expect(capture.reservedAt).toBeNull();
    expect(capture.reservedAnalysisRunId).toBeNull();

    await repository.disarmArmed(projectId, userId);
  });

  it('experimentCaptureId es único: una captura no puede enlazar dos Runs', async () => {
    const runA = await createRun(otherProjectId, 401);
    const runB = await createRun(otherProjectId, 402);
    await repository.arm(otherProjectId, userId);
    const reservation = await repository.reserveIfArmed(otherProjectId, runA.id);
    expect(reservation).not.toBeNull();

    await expect(
      prisma.analysisRun.update({ where: { id: runB.id }, data: { experimentCaptureId: reservation!.captureId } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('disarmArmed sin captura ARMED devuelve null; list devuelve lo más reciente primero, con cursor', async () => {
    const listProject = randomUUID();
    await prisma.project.create({ data: { id: listProject, name: `list-${listProject}`, ownerUserId: userId } });

    try {
      await expect(repository.disarmArmed(listProject, userId)).resolves.toBeNull();

      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const armed = await repository.arm(listProject, userId);
        ids.push(armed.id);
        await repository.disarmArmed(listProject, userId);
      }

      const firstPage = await repository.list(listProject, 2);
      expect(firstPage.map((capture) => capture.id)).toEqual([ids[2], ids[1]]);

      const secondPage = await repository.list(listProject, 2, firstPage[1].id);
      expect(secondPage.map((capture) => capture.id)).toEqual([ids[0]]);
    } finally {
      await prisma.experimentCapture.deleteMany({ where: { projectId: listProject } });
      await prisma.project.deleteMany({ where: { id: listProject } });
    }
  });
});
