import { plainToInstance } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  SUPABASE_URL!: string;

  @IsOptional()
  @IsString()
  SUPABASE_PUBLISHABLE_KEY?: string;

  @IsString()
  SUPABASE_SECRET_KEY!: string;

  @IsString()
  SUPABASE_STORAGE_BUCKET!: string;

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

  @IsInt()
  @Min(1)
  INDEXING_MAX_CHUNK_TOKENS: number = 1500;

  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsString()
  EMBEDDING_MODEL: string = 'text-embedding-3-small';

  @IsString()
  LLM_MODEL: string = 'gpt-4o-mini';

  @IsInt()
  @Min(1)
  EMBEDDING_DIMENSIONS: number = 1536;

  @IsNumber()
  @Min(0)
  RETRIEVAL_MINIMUM_SCORE: number = 0;

  @IsInt()
  @Min(1)
  RETRIEVAL_TOP_K: number = 10;

  @IsInt()
  @Min(1)
  RETRIEVAL_MAX_CONTEXT_TOKENS: number = 6000;

  @IsNumber()
  @Min(0)
  @Max(1)
  RETRIEVAL_SEMANTIC_WEIGHT: number = 0.7;

  @IsNumber()
  @Min(0)
  @Max(1)
  RETRIEVAL_STRUCTURAL_WEIGHT: number = 0.3;

  @IsOptional()
  @IsString()
  SANDBOX_URL?: string;

  @IsInt()
  @Min(1)
  SANDBOX_DOWNLOAD_TTL_SECONDS: number = 300;

  @IsInt()
  @Min(100)
  SANDBOX_REQUEST_TIMEOUT_MS: number = 10_000;

  @IsInt()
  @Min(1)
  SANDBOX_MAX_POLL_ATTEMPTS: number = 120;
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
