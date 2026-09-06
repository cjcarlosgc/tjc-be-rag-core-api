import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  SUPABASE_URL!: string;

  @IsString()
  SUPABASE_SERVICE_ROLE_KEY!: string;

  @IsString()
  OBJECT_STORAGE_BUCKET!: string;

  @IsInt()
  @Min(100)
  JOBS_POLL_INTERVAL_MS: number = 1000;

  @IsInt()
  @Min(1)
  JOBS_MAX_ATTEMPTS: number = 3;

  @IsInt()
  @Min(1)
  INDEXING_MAX_ZIP_SIZE_BYTES: number = 52_428_800;

  @IsInt()
  @Min(100)
  INDEXING_POLL_AFTER_MS: number = 1500;

  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsString()
  EMBEDDING_MODEL: string = 'text-embedding-3-small';

  @IsInt()
  @Min(1)
  EMBEDDING_DIMENSIONS: number = 1536;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Configuración de entorno inválida: ${errors.toString()}`);
  }

  return validated;
}
