import { Module } from '@nestjs/common';
import { AnalysisRunsController } from './analysis-runs.controller.js';
import { AnalysisRunsService } from './analysis-runs.service.js';
import { AnalysisRunsRepository } from './analysis-runs.repository.js';
import { AnalysisSymbolsRepository } from './persistence/analysis-symbols.repository.js';
import { ProjectsModule } from '../projects/projects.module.js';

@Module({
  imports: [ProjectsModule],
  controllers: [AnalysisRunsController],
  providers: [AnalysisRunsService, AnalysisRunsRepository, AnalysisSymbolsRepository],
  exports: [AnalysisRunsService, AnalysisRunsRepository, AnalysisSymbolsRepository],
})
export class AnalysisRunsModule {}
