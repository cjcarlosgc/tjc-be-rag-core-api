import { Module } from '@nestjs/common';
import { AnalysisRunsModule } from '../analysis-runs/analysis-runs.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { RetrievalComparisonsRepository } from './persistence/retrieval-comparisons.repository.js';
import { RetrievalComparisonJobHandler } from './retrieval-comparison-job.handler.js';
import { RetrievalComparisonsService } from './retrieval-comparisons.service.js';

@Module({
  imports: [RetrievalModule, AnalysisRunsModule],
  providers: [RetrievalComparisonsRepository, RetrievalComparisonsService, RetrievalComparisonJobHandler],
})
export class RetrievalComparisonsModule {}
