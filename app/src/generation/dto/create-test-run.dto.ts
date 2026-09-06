import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { GENERATION_MODES, type GenerationMode } from './generation-mode.js';

export class CreateTestRunDto {
  @IsUUID()
  projectId!: string;

  @IsIn(GENERATION_MODES)
  mode!: GenerationMode;

  @IsOptional()
  @IsUUID()
  targetId?: string;
}
