import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ExperimentCapture } from '../../generated/prisma/client.js';

/** Prisma reporta la violación de un índice único con código `P2002` (también el índice único parcial). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** El índice único parcial `experiment_captures_one_armed_per_project_key` rechazó una segunda captura ARMED. */
export class ExperimentCaptureAlreadyArmedError extends Error {
  constructor(readonly projectId: string) {
    super(`El Project "${projectId}" ya tiene una captura armada.`);
    this.name = 'ExperimentCaptureAlreadyArmedError';
  }
}

export interface ExperimentCaptureReservation {
  captureId: string;
  reservedAt: Date;
}

@Injectable()
export class ExperimentCapturesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserta una captura ARMED. Con una captura ya ARMED del mismo Project, el índice único parcial rechaza la
   * fila: la violación se traduce a `ExperimentCaptureAlreadyArmedError` (no se lee antes para decidir).
   */
  async arm(projectId: string, armedByUserId: string): Promise<ExperimentCapture> {
    try {
      return await this.prisma.experimentCapture.create({ data: { projectId, armedByUserId, status: 'ARMED' } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ExperimentCaptureAlreadyArmedError(projectId);
      }

      throw error;
    }
  }

  /** Listado más reciente primero (`createdAt desc, id desc`); `take` incluye la fila extra para saber si hay más. */
  list(projectId: string, take: number, cursor?: string): Promise<ExperimentCapture[]> {
    return this.prisma.experimentCapture.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  /**
   * Desarma la captura ARMED del Project en una transacción. La escritura va condicionada a `status = 'ARMED'`
   * (compare-and-set): si una reserva concurrente la consumió entre la lectura y la escritura, devuelve `null`.
   */
  disarmArmed(projectId: string, disarmedByUserId: string, now: Date = new Date()): Promise<ExperimentCapture | null> {
    return this.prisma.$transaction(async (tx) => {
      const armed = await tx.experimentCapture.findFirst({
        where: { projectId, status: 'ARMED' },
        select: { id: true },
      });

      if (!armed) {
        return null;
      }

      const { count } = await tx.experimentCapture.updateMany({
        where: { id: armed.id, status: 'ARMED' },
        data: { status: 'DISARMED', disarmedByUserId, disarmedAt: now },
      });

      if (count !== 1) {
        return null;
      }

      return tx.experimentCapture.findUniqueOrThrow({ where: { id: armed.id } });
    });
  }

  /**
   * Reserva atómica del siguiente Run elegible (HU18). En una transacción: `UPDATE ... WHERE status = 'ARMED'`
   * marca la captura RESERVED y, si afectó una fila, enlaza el Run (`analysis_runs.experimentCaptureId`).
   * Dos reservas concurrentes para el mismo Project: la segunda no encuentra fila ARMED y devuelve `null`.
   * Devuelve `null` si no había captura armada. Un fallo a mitad revierte ambas escrituras.
   */
  reserveIfArmed(projectId: string, analysisRunId: string, now: Date = new Date()): Promise<ExperimentCaptureReservation | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "experiment_captures"
        SET "status" = 'RESERVED',
            "reservedAnalysisRunId" = ${analysisRunId},
            "reservedAt" = ${now},
            "updatedAt" = ${now}
        WHERE "projectId" = ${projectId} AND "status" = 'ARMED'
        RETURNING "id"
      `;

      const captured = rows[0];

      if (!captured) {
        return null;
      }

      await tx.analysisRun.update({
        where: { id: analysisRunId },
        data: { experimentCaptureId: captured.id },
      });

      return { captureId: captured.id, reservedAt: now };
    });
  }
}
