import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  /**
   * `WorkspaceRefResponse.id`; omitido o igual al id del workspace personal =
   * personal. Hasta el corte 3 el de una organización responde `404 WORKSPACE_NOT_FOUND`.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  workspaceId?: string;
}
