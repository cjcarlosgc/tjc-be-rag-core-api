import { Module } from '@nestjs/common';
import { ArtifactsController } from './artifacts.controller.js';
import { ArtifactService } from './artifact.service.js';
import { ArtifactsRepository } from './artifacts.repository.js';

@Module({
  controllers: [ArtifactsController],
  providers: [ArtifactService, ArtifactsRepository],
  exports: [ArtifactService],
})
export class ArtifactsModule {}
