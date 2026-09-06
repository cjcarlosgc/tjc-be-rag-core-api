import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class IndexProjectDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
