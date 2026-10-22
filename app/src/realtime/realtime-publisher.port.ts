/**
 * Puerto de publicación del tiempo real (`INTEROP-2.18` §6.6, WI-CORE-074). Los servicios de dominio emiten a través
 * de este token y nunca dependen del gateway de Socket.IO. La implementación es `RealtimeGateway`.
 *
 * Garantías del puerto: best-effort, at-most-once, sin replay. Quien publica lo hace DESPUÉS de confirmar su
 * transacción y envuelve la llamada en un try/catch que nunca rompe el flujo de dominio.
 */
export const REALTIME_PUBLISHER = Symbol('REALTIME_PUBLISHER');

export interface RealtimePublisher {
  /** `true` si hay al menos un socket unido a la sala. Permite no recomponer el DTO si nadie escucha. */
  hasSubscribers(room: string): boolean;
  /** Emite `event` con `payload` solo a la sala indicada (nunca broadcast global). */
  publish(room: string, event: string, payload: unknown): void;
}

/** Puerto sin efecto: lo usan las pruebas y cualquier contexto sin transporte de tiempo real. */
export const NOOP_REALTIME_PUBLISHER: RealtimePublisher = {
  hasSubscribers: () => false,
  publish: () => undefined,
};

/** Salas por id (una por recurso; nunca un broadcast global). */
export function projectVersionRoom(projectVersionId: string): string {
  return `project-version:${projectVersionId}`;
}

export function analysisRunRoom(analysisRunId: string): string {
  return `analysis-run:${analysisRunId}`;
}

export function experimentRoom(experimentId: string): string {
  return `experiment:${experimentId}`;
}

/** Eventos servidor -> cliente. El payload es exactamente el DTO de su GET (sin campos fuera del contrato HTTP). */
export const ANALYSIS_RUN_UPDATE_EVENT = 'analysis-run:update';
export const EXPERIMENT_UPDATE_EVENT = 'experiment:update';
