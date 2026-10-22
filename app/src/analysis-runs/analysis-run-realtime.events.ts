import { Inject, Injectable, Logger } from '@nestjs/common';
import { ANALYSIS_RUN_UPDATE_EVENT, analysisRunRoom, REALTIME_PUBLISHER, type RealtimePublisher } from '../realtime/realtime-publisher.port.js';
import { AnalysisRunsRepository } from './analysis-runs.repository.js';
import { AnalysisSymbolsRepository } from './persistence/analysis-symbols.repository.js';
import { toAnalysisRunDetailResponse } from './dto/analysis-run.response.js';

/**
 * Emisión `analysis-run:update` (`INTEROP-2.18` §6.6, WI-CORE-074). Se llama DESPUÉS de confirmar el cambio de
 * estado del Run. Recompone el DTO con la misma función que `GET /analysis-runs/{id}` y lo publica a la sala del Run.
 *
 * Best-effort: `runChanged` nunca lanza. Si no hay suscriptores no lee nada de la base de datos.
 */
@Injectable()
export class AnalysisRunRealtimeEvents {
  private readonly logger = new Logger(AnalysisRunRealtimeEvents.name);

  constructor(
    @Inject(REALTIME_PUBLISHER) private readonly publisher: RealtimePublisher,
    private readonly analysisRunsRepository: AnalysisRunsRepository,
    private readonly symbolsRepository: AnalysisSymbolsRepository,
  ) {}

  async runChanged(analysisRunId: string): Promise<void> {
    const room = analysisRunRoom(analysisRunId);

    try {
      if (!this.publisher.hasSubscribers(room)) {
        return;
      }

      // Sin scope de propietario: la sala ya exige Reader sobre el Project (mismo predicado que el GET al suscribir).
      const run = await this.analysisRunsRepository.findById(analysisRunId);

      if (!run) {
        return;
      }

      const symbols = await this.symbolsRepository.findByAnalysisRun(run.id);
      this.publisher.publish(room, ANALYSIS_RUN_UPDATE_EVENT, toAnalysisRunDetailResponse(run, symbols));
    } catch (error) {
      this.logger.warn(`No se pudo emitir ${ANALYSIS_RUN_UPDATE_EVENT} del Run "${analysisRunId}": ${String(error)}`);
    }
  }
}
