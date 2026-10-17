import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  /** Igual que `UpdateProjectDto`: `name` se recorta antes de validar (un nombre solo de espacios es `400`). */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
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
