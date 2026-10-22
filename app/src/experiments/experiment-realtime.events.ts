import { Inject, Injectable, Logger } from '@nestjs/common';
import { EXPERIMENT_UPDATE_EVENT, experimentRoom, REALTIME_PUBLISHER, type RealtimePublisher } from '../realtime/realtime-publisher.port.js';
import { ExperimentRunsRepository } from './persistence/experiment-runs.repository.js';
import { toExperimentStatusResponse } from './experiment-status.presenter.js';

/**
 * Intervalo mínimo entre dos `experiment:update` de progreso (`completedRepetitions`) de un mismo experimento.
 * Constante del código (no variable de entorno): acota la ráfaga de emisiones sin retrasar los cambios de estado,
 * que nunca pasan por este límite. Si quedan progresos dentro del intervalo, se emite el último al cumplirse.
 */
export const EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS = 1500;

/**
 * Emisión `experiment:update` (`INTEROP-2.18` §6.6, WI-CORE-074). Dos entradas:
 * - `statusChanged`: inicio, fin o fallo del experimento. Emite de inmediato y cancela cualquier progreso pendiente.
 * - `progressChanged`: avance de repeticiones. Emite como máximo una vez cada `EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS`
 *   por experimento; el progreso que cae dentro de la ventana se emite al cierre de la ventana (trailing).
 *
 * Ambas son best-effort: nunca lanzan ni alteran el job. Sin suscriptores no leen la base de datos.
 */
@Injectable()
export class ExperimentRealtimeEvents {
  private readonly logger = new Logger(ExperimentRealtimeEvents.name);
  private readonly lastProgressAt = new Map<string, number>();
  private readonly pendingProgress = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(REALTIME_PUBLISHER) private readonly publisher: RealtimePublisher,
    private readonly experimentRunsRepository: ExperimentRunsRepository,
  ) {}

  async statusChanged(experimentId: string): Promise<void> {
    const pending = this.pendingProgress.get(experimentId);

    if (pending !== undefined) {
      clearTimeout(pending);
      this.pendingProgress.delete(experimentId);
    }
    this.lastProgressAt.delete(experimentId);

    await this.emit(experimentId);
  }

  async progressChanged(experimentId: string): Promise<void> {
    if (!this.publisher.hasSubscribers(experimentRoom(experimentId)) || this.pendingProgress.has(experimentId)) {
      return;
    }

    const elapsed = Date.now() - (this.lastProgressAt.get(experimentId) ?? Number.NEGATIVE_INFINITY);

    if (elapsed >= EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS) {
      this.lastProgressAt.set(experimentId, Date.now());
      await this.emit(experimentId);
      return;
    }

    const timer = setTimeout(() => {
      this.pendingProgress.delete(experimentId);
      this.lastProgressAt.set(experimentId, Date.now());
      void this.emit(experimentId);
    }, EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS - elapsed);
    timer.unref?.();
    this.pendingProgress.set(experimentId, timer);
  }

  private async emit(experimentId: string): Promise<void> {
    const room = experimentRoom(experimentId);

    try {
      if (!this.publisher.hasSubscribers(room)) {
        return;
      }

      // Sin scope de propietario: la sala ya exige Reader sobre el Project (mismo predicado que el GET al suscribir).
      const run = await this.experimentRunsRepository.findById(experimentId);

      if (!run) {
        return;
      }

      this.publisher.publish(room, EXPERIMENT_UPDATE_EVENT, toExperimentStatusResponse(run));
    } catch (error) {
      this.logger.warn(`No se pudo emitir ${EXPERIMENT_UPDATE_EVENT} del experimento "${experimentId}": ${String(error)}`);
    }
  }
}
