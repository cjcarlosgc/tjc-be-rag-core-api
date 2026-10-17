import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** `INTEROP-2.4` §6.1: `name` (trim, 1..200) es el único campo modificable; los demás se rechazan (`400`). */
export class UpdateProjectDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
