import { Module } from '@nestjs/common';
import { AnalysisRunsController } from './analysis-runs.controller.js';
import { AnalysisRunsService } from './analysis-runs.service.js';
import { AnalysisRunsRepository } from './analysis-runs.repository.js';
import { ProjectsModule } from '../projects/projects.module.js';

@Module({
  imports: [ProjectsModule],
  controllers: [AnalysisRunsController],
  providers: [AnalysisRunsService, AnalysisRunsRepository],
  exports: [AnalysisRunsService, AnalysisRunsRepository],
})
export class AnalysisRunsModule {}
