import { Module } from '@nestjs/common';
import { ExperimentCapturesController } from './experiment-captures.controller.js';
import { ExperimentCapturesService } from './experiment-captures.service.js';
import { ExperimentCapturesRepository } from './persistence/experiment-captures.repository.js';

/**
 * Captura armada de experimentación (WI-CORE-109). Sin imports de otros módulos de dominio: `AnalysisRunsModule`
 * importa este módulo para la reserva, así que aquí no puede volver a depender de él (evita el ciclo).
 */
@Module({
  controllers: [ExperimentCapturesController],
  providers: [ExperimentCapturesRepository, ExperimentCapturesService],
  exports: [ExperimentCapturesRepository],
})
export class ExperimentCapturesModule {}
