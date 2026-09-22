import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'development';

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

  /** Umbral (ms) de un lock `RUNNING` obsoleto de un job con `dedupeKey` (jobs de acceso, HU61). */
  @IsInt()
  @Min(1000)
  JOBS_STALE_LOCK_MS: number = 600_000;

  /** Siembra y ejecuta la reconciliación horaria de acceso (HU61); `false` la desactiva (local/tests). */
  @IsBoolean()
  ACCESS_RECONCILIATION_ENABLED: boolean = true;

  /** Intervalo entre ocurrencias de `ACCESS_RECONCILIATION` (por defecto una hora). */
  @IsInt()
  @Min(1000)
  ACCESS_RECONCILIATION_INTERVAL_MS: number = 3_600_000;

  /** Presupuesto de verificaciones contra GitHub por ejecución de la reconciliación. */
  @IsInt()
  @Min(1)
  ACCESS_RECONCILIATION_BUDGET: number = 500;

  /** Tope de verificaciones simultáneas contra GitHub en la reconciliación. */
  @IsInt()
  @Min(1)
  ACCESS_RECONCILIATION_CONCURRENCY: number = 5;

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

  @IsOptional()
  @IsString()
  LLM_REASONING_EFFORT?: string;

  @IsInt()
  @Min(1000)
  OPENAI_TIMEOUT_MS: number = 30_000;

  @IsInt()
  @Min(0)
  OPENAI_MAX_RETRIES: number = 2;

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

  @IsOptional()
  @IsString()
  SANDBOX_SERVICE_TOKEN?: string;

  @IsInt()
  @Min(1)
  SANDBOX_DOWNLOAD_TTL_SECONDS: number = 300;

  @IsInt()
  @Min(100)
  SANDBOX_REQUEST_TIMEOUT_MS: number = 10_000;

  @IsInt()
  @Min(1)
  SANDBOX_MAX_POLL_ATTEMPTS: number = 120;

  @IsInt()
  @Min(1)
  AGENT_MAX_TOOL_CALLS: number = 20;

  @IsInt()
  @Min(1000)
  GENERATION_TIMEOUT_MS: number = 120_000;

  @IsInt()
  @Min(1)
  EXPERIMENT_REPETITION_CONCURRENCY: number = 3;

  @IsNumber()
  @Min(0)
  LLM_INPUT_COST_PER_1K_TOKENS: number = 0.00015;

  @IsNumber()
  @Min(0)
  LLM_OUTPUT_COST_PER_1K_TOKENS: number = 0.0006;

  @IsOptional()
  @IsString()
  GITHUB_APP_WEBHOOK_SECRET?: string;

  @IsOptional()
  @IsString()
  GITHUB_APP_ID?: string;

  @IsOptional()
  @IsString()
  GITHUB_APP_PRIVATE_KEY_BASE64?: string;

  @IsOptional()
  @IsString()
  CONSOLE_BASE_URL?: string;

  @IsString()
  GITHUB_CHECK_NAME: string = 'RAG Core Analysis';

  @IsBoolean()
  AUTH_BYPASS_ENABLED: boolean = false;

  @IsString()
  AUTH_BYPASS_USER_ID: string = 'local-dev-user';

  /** HU62: identidad GitHub sintética (id numérico) que aporta el bypass; nunca en producción. */
  @Matches(/^\d+$/, { message: 'AUTH_BYPASS_GITHUB_USER_ID debe ser un id numérico de GitHub.' })
  AUTH_BYPASS_GITHUB_USER_ID: string = '900000001';
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  // AUTH_BYPASS_ENABLED llega como texto desde .env; class-transformer trataría
  // cualquier string no vacío (incluido "false") como verdadero, así que se
  // normaliza antes de la conversión implícita.
  const normalized = {
    ...config,
    AUTH_BYPASS_ENABLED: config.AUTH_BYPASS_ENABLED === 'true' || config.AUTH_BYPASS_ENABLED === true,
    // Por defecto activo: solo un `false` explícito la desactiva.
    ACCESS_RECONCILIATION_ENABLED:
      config.ACCESS_RECONCILIATION_ENABLED === undefined ||
      config.ACCESS_RECONCILIATION_ENABLED === 'true' ||
      config.ACCESS_RECONCILIATION_ENABLED === true,
  };
  const validated = plainToInstance(EnvironmentVariables, normalized, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Configuración de entorno inválida: ${errors.toString()}`);
  }

  // DEC-AUTH-001: SANDBOX_URL y SANDBOX_SERVICE_TOKEN deben configurarse juntos
  // o no configurarse; una configuración parcial deja al cliente del Sandbox
  // sin poder autenticarse (o con un secreto huérfano) y debe fallar en el
  // arranque, no en el primer request.
  if (Boolean(validated.SANDBOX_URL) !== Boolean(validated.SANDBOX_SERVICE_TOKEN)) {
    throw new Error(
      'Configuración de entorno inválida: SANDBOX_URL y SANDBOX_SERVICE_TOKEN deben configurarse juntos (DEC-AUTH-001).',
    );
  }

  // GITHUB_APP_ID y GITHUB_APP_PRIVATE_KEY_BASE64 autentican a Core como la
  // GitHub App real (JWT + installation access tokens, HU33-34); deben
  // configurarse juntos o no configurarse, igual que Sandbox.
  if (Boolean(validated.GITHUB_APP_ID) !== Boolean(validated.GITHUB_APP_PRIVATE_KEY_BASE64)) {
    throw new Error(
      'Configuración de entorno inválida: GITHUB_APP_ID y GITHUB_APP_PRIVATE_KEY_BASE64 deben configurarse juntos.',
    );
  }

  // DEC-WEB-AUTH-001: el bypass de autenticación solo puede existir en
  // desarrollo/mock; la aplicación debe negarse a arrancar en producción si
  // está activo, para no exponer el flujo ZIP sin identidad real.
  if (validated.NODE_ENV === 'production' && validated.AUTH_BYPASS_ENABLED) {
    throw new Error(
      'Configuración de entorno inválida: AUTH_BYPASS_ENABLED no puede estar activo con NODE_ENV=production (DEC-WEB-AUTH-001).',
    );
  }

  return validated;
}
