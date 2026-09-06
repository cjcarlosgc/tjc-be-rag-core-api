import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { SandboxModule } from '../sandbox/sandbox.module.js';
import { GenerationModule } from '../generation/generation.module.js';
import { ExperimentsController } from './experiments.controller.js';
import { ExperimentsService } from './experiments.service.js';
import { ExperimentRunsRepository } from './persistence/experiment-runs.repository.js';
import { ExperimentJobHandler } from './experiment-job.handler.js';
import { GeneralistAgentService } from '../generation/agent/generalist-agent.service.js';

@Module({
  imports: [ProjectsModule, ProjectVersionsModule, RetrievalModule, SandboxModule, GenerationModule],
  controllers: [ExperimentsController],
  providers: [
    ExperimentsService,
    ExperimentRunsRepository,
    ExperimentJobHandler,
    GeneralistAgentService,
  ],
})
export class ExperimentsModule {}
