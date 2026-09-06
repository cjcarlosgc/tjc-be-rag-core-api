import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectVersionsController } from './project-versions.controller.js';
import { ProjectVersionsService } from './project-versions.service.js';
import { ProjectVersionsRepository } from './project-versions.repository.js';
import { ZipValidationService } from './zip/zip-validation.service.js';
import { ZipExtractionService } from './zip/zip-extraction.service.js';
import { FileDiscoveryService } from './discovery/file-discovery.service.js';
import { TypeScriptParserService } from './parsing/typescript-parser.service.js';
import { TestTargetExtractorService } from './inventory/test-target-extractor.service.js';
import { ExistingTestResolverService } from './inventory/existing-test-resolver.service.js';
import { CodeChunksRepository } from './persistence/code-chunks.repository.js';
import { TestTargetsRepository } from './persistence/test-targets.repository.js';
import { IndexingJobHandler } from './indexing-job.handler.js';

@Module({
  imports: [ProjectsModule],
  controllers: [ProjectVersionsController],
  providers: [
    ProjectVersionsService,
    ProjectVersionsRepository,
    ZipValidationService,
    ZipExtractionService,
    FileDiscoveryService,
    TypeScriptParserService,
    TestTargetExtractorService,
    ExistingTestResolverService,
    CodeChunksRepository,
    TestTargetsRepository,
    IndexingJobHandler,
  ],
  exports: [CodeChunksRepository, TestTargetsRepository],
})
export class ProjectVersionsModule {}
