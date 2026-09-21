import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  /**
   * `WorkspaceRefResponse.id`; omitido o igual al id del workspace personal = personal.
   * Con el de una organización solo crea un owner (`403 WORKSPACE_ADMIN_REQUIRED` a un
   * miembro que no lo es); un valor que no es un workspace del usuario, `404 WORKSPACE_NOT_FOUND`.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  workspaceId?: string;
}
