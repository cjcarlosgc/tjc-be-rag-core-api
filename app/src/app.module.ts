import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { ObjectStorageModule } from './object-storage/object-storage.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { IdempotencyModule } from './common/idempotency/idempotency.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ProjectVersionsModule } from './project-versions/project-versions.module.js';
import { RetrievalModule } from './retrieval/retrieval.module.js';
import { GenerationModule } from './generation/generation.module.js';
import { ExperimentsModule } from './experiments/experiments.module.js';
import { HealthController } from './common/health/health.controller.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { validateEnv } from './config/env.validation.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    ObjectStorageModule,
    ProvidersModule,
    JobsModule,
    RealtimeModule,
    IdempotencyModule,
    ProjectsModule,
    ProjectVersionsModule,
    RetrievalModule,
    GenerationModule,
    ExperimentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
