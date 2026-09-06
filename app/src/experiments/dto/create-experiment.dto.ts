import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class CreateExperimentDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  targetId!: string;

  @IsOptional()
  @IsIn([3])
  repetitions?: number;
}
