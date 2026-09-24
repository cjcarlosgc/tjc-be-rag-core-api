import { Module } from '@nestjs/common';
import { ProjectAccessModule } from '../project-access/project-access.module.js';
import { ProjectVersionsModule } from '../project-versions/project-versions.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { SandboxModule } from '../sandbox/sandbox.module.js';
import { GenerationModule } from '../generation/generation.module.js';
import { ExperimentsController } from './experiments.controller.js';
import { ContextTracesController } from './context-traces.controller.js';
import { ExperimentsService } from './experiments.service.js';
import { ExperimentRunsRepository } from './persistence/experiment-runs.repository.js';
import { ExperimentJobHandler } from './experiment-job.handler.js';
import { GeneralistAgentService } from '../generation/agent/generalist-agent.service.js';
import { ContextTracesModule } from '../context-traces/context-traces.module.js';

@Module({
  imports: [
    ProjectAccessModule,
    ProjectVersionsModule,
    RetrievalModule,
    SandboxModule,
    GenerationModule,
    ContextTracesModule,
  ],
  controllers: [ExperimentsController, ContextTracesController],
  providers: [
    ExperimentsService,
    ExperimentRunsRepository,
    ExperimentJobHandler,
    GeneralistAgentService,
  ],
})
export class ExperimentsModule {}
