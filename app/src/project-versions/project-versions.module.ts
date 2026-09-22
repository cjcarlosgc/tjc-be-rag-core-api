import { Module } from '@nestjs/common';
import { ProjectAccessModule } from '../project-access/project-access.module.js';
import { ProjectVersionsController } from './project-versions.controller.js';
import { ProjectVersionsService } from './project-versions.service.js';
import { ProjectVersionsRepository } from './project-versions.repository.js';
import { ZipExtractionService } from './zip/zip-extraction.service.js';
import { FileDiscoveryService } from './discovery/file-discovery.service.js';
import { TypeScriptParserService } from './parsing/typescript-parser.service.js';
import { TestTargetExtractorService } from './inventory/test-target-extractor.service.js';
import { ExistingTestResolverService } from './inventory/existing-test-resolver.service.js';
import { CodeChunksRepository } from './persistence/code-chunks.repository.js';
import { TestTargetsRepository } from './persistence/test-targets.repository.js';

@Module({
  imports: [ProjectAccessModule],
  controllers: [ProjectVersionsController],
  providers: [
    ProjectVersionsService,
    ProjectVersionsRepository,
    ZipExtractionService,
    FileDiscoveryService,
    TypeScriptParserService,
    TestTargetExtractorService,
    ExistingTestResolverService,
    CodeChunksRepository,
    TestTargetsRepository,
  ],
  exports: [
    CodeChunksRepository,
    TestTargetsRepository,
    ProjectVersionsRepository,
    ZipExtractionService,
    FileDiscoveryService,
    TypeScriptParserService,
    TestTargetExtractorService,
    ExistingTestResolverService,
  ],
})
export class ProjectVersionsModule {}
