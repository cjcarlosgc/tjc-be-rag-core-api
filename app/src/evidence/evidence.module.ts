import { Module } from '@nestjs/common';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { ExperimentRunsRepository } from '../experiments/persistence/experiment-runs.repository.js';
import { RetrievalComparisonsRepository } from '../retrieval-comparisons/persistence/retrieval-comparisons.repository.js';
import { EvidenceController } from './evidence.controller.js';
import { EVIDENCE_CLOCK, EvidenceService } from './evidence.service.js';
import { EvidenceRepository } from './persistence/evidence.repository.js';

/** WI-CORE-027: exportación de evidencia (solo lectura). El reloj de `generatedAt` es el del sistema. */
@Module({
  imports: [AnalysisRunsModule],
  controllers: [EvidenceController],
  providers: [
    EvidenceService,
    EvidenceRepository,
    ExperimentRunsRepository,
    RetrievalComparisonsRepository,
    { provide: EVIDENCE_CLOCK, useValue: (): Date => new Date() },
  ],
})
export class EvidenceModule {}
