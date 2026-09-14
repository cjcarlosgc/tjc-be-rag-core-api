import { Module } from '@nestjs/common';
import { PromptBuilder } from './prompt-builder.service.js';
import { TestFileMergeService } from './test-file-merge.service.js';
import { GeneralistAgentService } from './agent/generalist-agent.service.js';

/**
 * Retirados los modos manuales de generación (SDD 2.0, ver CHANGELOG.md): sin
 * controller propio. Expone únicamente las piezas agnósticas de modo/ZIP que
 * reutilizan tanto Experiments (HU19, vigente) como la futura generación
 * PR-driven (HU39-40).
 */
@Module({
  providers: [PromptBuilder, TestFileMergeService, GeneralistAgentService],
  exports: [PromptBuilder, TestFileMergeService, GeneralistAgentService],
})
export class GenerationModule {}
