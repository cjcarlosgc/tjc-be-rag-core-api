import type { ExperimentCapture, ExperimentCaptureStatus } from '../../generated/prisma/client.js';

/** INTEROP-2.25 §6.17 (WI-CORE-109): captura armada de experimentación de un Project. */
export interface ExperimentCaptureResponse {
  captureId: string;
  projectId: string;
  status: ExperimentCaptureStatus;
  armedBy: string;
  armedAt: string;
  reservedAnalysisRunId: string | null;
  reservedAt: string | null;
  disarmedBy: string | null;
  disarmedAt: string | null;
}

/** Referencia de la captura que consumió un AnalysisRun (`AnalysisRunSummaryResponse.experimentCapture`). */
export interface ExperimentCaptureReservationResponse {
  captureId: string;
  reservedAt: string;
}

export function toExperimentCaptureResponse(capture: ExperimentCapture): ExperimentCaptureResponse {
  return {
    captureId: capture.id,
    projectId: capture.projectId,
    status: capture.status,
    armedBy: capture.armedByUserId,
    armedAt: capture.armedAt.toISOString(),
    reservedAnalysisRunId: capture.reservedAnalysisRunId,
    reservedAt: capture.reservedAt ? capture.reservedAt.toISOString() : null,
    disarmedBy: capture.disarmedByUserId,
    disarmedAt: capture.disarmedAt ? capture.disarmedAt.toISOString() : null,
  };
}

/** Solo una captura con `reservedAt` puede aparecer en un Run; cualquier otro caso se trata como ausencia. */
export function toExperimentCaptureReservationResponse(
  capture: { id: string; reservedAt: Date | null } | null | undefined,
): ExperimentCaptureReservationResponse | null {
  if (!capture || capture.reservedAt === null) {
    return null;
  }

  return { captureId: capture.id, reservedAt: capture.reservedAt.toISOString() };
}
