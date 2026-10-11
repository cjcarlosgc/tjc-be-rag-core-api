import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isRelativeNormalizedPosixPath', async: false })
class IsRelativeNormalizedPosixPathConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) {
      return false;
    }

    if (/^[a-zA-Z]:\//.test(value)) {
      return false;
    }

    return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  }

  defaultMessage(): string {
    return '$property debe ser una ruta POSIX relativa, normalizada y sin traversal.';
  }
}

export class CreateExperimentDto {
  @IsUUID()
  analysisRunId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  @Validate(IsRelativeNormalizedPosixPathConstraint)
  symbolFilePath!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  symbolQualifiedName!: string;

  @IsOptional()
  @IsIn([3])
  repetitions?: number;
}
