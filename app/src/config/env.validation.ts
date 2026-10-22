import { Logger } from '@nestjs/common';
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
import {
  DEFAULT_AGENT_MAX_TOOL_CALLS,
  DEFAULT_EXPERIMENT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_GENERATION_TIMEOUT_MS,
  DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS,
} from './generation-budget.defaults.js';
import { DEFAULT_LLM_MODEL } from '../providers/llm-settings.js';
import { REASONING_EFFORT_SCALE } from '../providers/reasoning-effort.scale.js';
import {
  DEFAULT_MAX_POLL_ATTEMPTS,
  DEFAULT_POLL_RETRIES,
  DEFAULT_POLL_RETRY_DELAY_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_POLL_AFTER_MS,
} from './sandbox-poll.defaults.js';

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

  /**
   * Intervalo (ms) del latido del lock de cada job en curso (WI-CORE-030, DEC-JOBS-002). Debe ser
   * como máximo `JOBS_STALE_LOCK_MS / 3`, o un worker vivo podría parecer caído.
   */
  @IsInt()
  @Min(1000)
  JOBS_HEARTBEAT_INTERVAL_MS: number = 60_000;

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

  /** Modelo único del flujo normal y de los experimentos (WI-CORE-076, DEC-EXP-005). */
  @IsString()
  LLM_MODEL: string = DEFAULT_LLM_MODEL;

  /**
   * Esfuerzo único del flujo normal y de los experimentos (WI-CORE-076, DEC-EXP-005). Obligatorio y
   * sin valor por defecto: lo valida `validateLlmSettings` con mensajes propios (no `@IsNotEmpty`).
   */
  @IsOptional()
  @IsString()
  LLM_REASONING_EFFORT?: string;

  /** Experimentos (DEC-EXP-004): temperatura solo con esfuerzo `none`. */
  @IsOptional()
  @IsString()
  EXPERIMENT_LLM_TEMPERATURE?: string;

  @IsOptional()
  @IsString()
  EXPERIMENT_LLM_MAX_OUTPUT_TOKENS?: string;

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
  RETRIEVAL_MAX_CONTEXT_TOKENS: number = DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS;

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

  /**
   * Timeout (ms) por request al Sandbox (WI-CORE-078). Se valida el texto crudo en
   * `validateSandboxLimitSettings` (entero 100..60000); sin `@IsInt`, que convertiría "1e3" o "0x10".
   */
  @IsOptional()
  SANDBOX_REQUEST_TIMEOUT_MS: number = DEFAULT_REQUEST_TIMEOUT_MS;

  /** Máximo de consultas de estado al Sandbox por ejecución (WI-CORE-078): entero 1..600. */
  @IsOptional()
  SANDBOX_MAX_POLL_ATTEMPTS: number = DEFAULT_MAX_POLL_ATTEMPTS;

  /**
   * Reintentos por consulta GET al Sandbox (WI-CORE-077). Se valida el texto crudo en
   * `validateSandboxPollSettings`: sin `@IsInt`, que convertiría "" en 0 y "abc" en NaN.
   */
  @IsOptional()
  SANDBOX_POLL_RETRIES?: number;

  /** Espera inicial (ms) entre reintentos de consulta al Sandbox (WI-CORE-077). */
  @IsOptional()
  SANDBOX_POLL_RETRY_DELAY_MS?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  AGENT_MAX_TOOL_CALLS: number = DEFAULT_AGENT_MAX_TOOL_CALLS;

  @IsInt()
  @Min(1000)
  GENERATION_TIMEOUT_MS: number = DEFAULT_GENERATION_TIMEOUT_MS;

  @IsInt()
  @Min(1)
  EXPERIMENT_REPETITION_CONCURRENCY: number = 3;

  /** Intervalo (ms) del latido de cada repetición en curso (WI-CORE-025, HU17). */
  @IsInt()
  @Min(1000)
  EXPERIMENT_HEARTBEAT_INTERVAL_MS: number = DEFAULT_EXPERIMENT_HEARTBEAT_INTERVAL_MS;

  /**
   * Umbral (ms) sin latido para considerar vencido un intento RUNNING. Vacío = calculado
   * (GENERATION_TIMEOUT del run + tiempo HTTP máximo del Sandbox); nunca menor que 3 × intervalo.
   */
  @IsOptional()
  @IsInt()
  @Min(1000)
  EXPERIMENT_HEARTBEAT_STALE_MS?: number;

  @IsNumber()
  @Min(0)
  LLM_INPUT_COST_PER_1K_TOKENS: number = 0.00015;

  @IsNumber()
  @Min(0)
  LLM_OUTPUT_COST_PER_1K_TOKENS: number = 0.0006;

  @IsOptional()
  @IsString()
  GITHUB_INTEGRATION_API_BASE_URL?: string;

  @IsOptional()
  @IsString()
  CORE_TO_GITHUB_INTEGRATION_TOKEN?: string;

  @IsOptional()
  @IsString()
  GITHUB_INTEGRATION_TO_CORE_TOKEN?: string;

  @IsOptional()
  @IsString()
  GITHUB_BINDING_EVIDENCE_SECRET?: string;

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

  // SANDBOX_URL: HTTPS obligatorio; HTTP solo en loopback fuera de producción. El mensaje no imprime el valor.
  if (validated.SANDBOX_URL && !isAllowedSandboxUrl(
    validated.SANDBOX_URL,
    validated.NODE_ENV !== 'production',
  )) {
    throw new Error(
      'Configuración de entorno inválida: SANDBOX_URL debe usar HTTPS; HTTP solo se permite en loopback fuera de producción, y no admite credenciales, ruta ni parámetros.',
    );
  }

  // El acceso entre Core y GitHub Integration es una configuración indivisible;
  // los secretos de la GitHub App ya no pertenecen a este componente.
  const githubIntegrationFields = [
    validated.GITHUB_INTEGRATION_API_BASE_URL,
    validated.CORE_TO_GITHUB_INTEGRATION_TOKEN,
    validated.GITHUB_INTEGRATION_TO_CORE_TOKEN,
  ];
  if (githubIntegrationFields.some(Boolean) && !githubIntegrationFields.every(Boolean)) {
    throw new Error(
      'Configuración de entorno inválida: GITHUB_INTEGRATION_API_BASE_URL y ambos tokens internos deben configurarse juntos.',
    );
  }

  if (validated.GITHUB_INTEGRATION_API_BASE_URL && !isAllowedGithubIntegrationUrl(
    validated.GITHUB_INTEGRATION_API_BASE_URL,
    validated.NODE_ENV !== 'production',
  )) {
    throw new Error(
      'Configuración de entorno inválida: GITHUB_INTEGRATION_API_BASE_URL debe usar HTTPS; HTTP solo se permite en loopback fuera de producción.',
    );
  }

  if (validated.GITHUB_BINDING_EVIDENCE_SECRET &&
      (validated.GITHUB_BINDING_EVIDENCE_SECRET.length < 32 || /\s/.test(validated.GITHUB_BINDING_EVIDENCE_SECRET))) {
    throw new Error('Configuración de entorno inválida: GITHUB_BINDING_EVIDENCE_SECRET debe tener al menos 32 caracteres sin espacios.');
  }

  if (validated.GITHUB_INTEGRATION_API_BASE_URL && !validated.GITHUB_BINDING_EVIDENCE_SECRET) {
    throw new Error(
      'Configuración de entorno inválida: GITHUB_BINDING_EVIDENCE_SECRET es obligatorio cuando GitHub Integration está configurado.',
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

  // WI-CORE-030 (DEC-JOBS-002): el latido debe renovar el lock al menos tres veces antes de que venza.
  if (validated.JOBS_HEARTBEAT_INTERVAL_MS * 3 > validated.JOBS_STALE_LOCK_MS) {
    throw new Error(
      'Configuración de entorno inválida: JOBS_HEARTBEAT_INTERVAL_MS debe ser ≤ JOBS_STALE_LOCK_MS / 3.',
    );
  }

  validateExperimentLlmSettings(validated);
  validateLlmSettings(validated);
  validateSandboxPollSettings(config, validated);
  validateSandboxLimitSettings(config, validated);
  warnRetiredLlmVariables(config);

  return validated;
}

/** Variables de LLM retiradas por WI-CORE-076: si siguen definidas se ignoran y se avisa al arrancar. */
export const RETIRED_LLM_VARIABLES = [
  'EXPERIMENT_LLM_MODEL',
  'EXPERIMENT_LLM_REASONING_EFFORT',
  'LLM_SUPPORTED_COMBINATIONS',
] as const;

/** Nombres de las variables retiradas presentes en `config` (aunque su valor esté vacío); nunca valores. */
export function retiredLlmVariablesIn(config: Record<string, unknown>): string[] {
  return RETIRED_LLM_VARIABLES.filter((name) => config[name] !== undefined);
}

const ECHO_MAX_CODE_POINTS = 40;
const SANDBOX_POLL_RETRIES_MAX = 10;
const SANDBOX_POLL_RETRY_DELAY_MS_MIN = 1;
const SANDBOX_POLL_RETRY_DELAY_MS_MAX = MAX_POLL_AFTER_MS;
const SANDBOX_MAX_POLL_ATTEMPTS_MIN = 1;
const SANDBOX_MAX_POLL_ATTEMPTS_MAX = 600;
const SANDBOX_REQUEST_TIMEOUT_MS_MIN = 100;
const SANDBOX_REQUEST_TIMEOUT_MS_MAX = 60_000;

/**
 * Eco seguro de un valor de entorno en un mensaje de error (WI-CORE-078). Recorta primero a 40 puntos
 * de código (nunca corta un escape a la mitad) y escapa después: JSON.stringify (comillas, barras,
 * controles C0 y sustitutos sueltos) más U+007F–U+009F, U+2028 y U+2029, que no deben partir una línea
 * de log. Devuelve el literal ya con comillas. Para valores normales el resultado es `"valor"`.
 */
export function echoEnvValue(text: string): string {
  const head = Array.from(text).slice(0, ECHO_MAX_CODE_POINTS).join('');
  return JSON.stringify(head).replace(
    /[\u007f-\u009f\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * SANDBOX_MAX_POLL_ATTEMPTS y SANDBOX_REQUEST_TIMEOUT_MS (WI-CORE-078): mismo patrón que las POLL.
 * Ausente = default; vacía o solo espacios = error; solo enteros decimales dentro de rango.
 * Escribe el número normalizado en `validated`. Los topes evitan valores absurdos o desbordes;
 * no acotan por sí solos el tiempo máximo de un intento (cota B de WI-CORE-071).
 */
function validateSandboxLimitSettings(config: Record<string, unknown>, validated: EnvironmentVariables): void {
  validated.SANDBOX_MAX_POLL_ATTEMPTS = parseBoundedInteger(config, 'SANDBOX_MAX_POLL_ATTEMPTS', {
    defaultValue: DEFAULT_MAX_POLL_ATTEMPTS,
    min: SANDBOX_MAX_POLL_ATTEMPTS_MIN,
    max: SANDBOX_MAX_POLL_ATTEMPTS_MAX,
    rangeLabel: `entre ${SANDBOX_MAX_POLL_ATTEMPTS_MIN} y ${SANDBOX_MAX_POLL_ATTEMPTS_MAX}`,
    defaultLabel: String(DEFAULT_MAX_POLL_ATTEMPTS),
  });
  validated.SANDBOX_REQUEST_TIMEOUT_MS = parseBoundedInteger(config, 'SANDBOX_REQUEST_TIMEOUT_MS', {
    defaultValue: DEFAULT_REQUEST_TIMEOUT_MS,
    min: SANDBOX_REQUEST_TIMEOUT_MS_MIN,
    max: SANDBOX_REQUEST_TIMEOUT_MS_MAX,
    rangeLabel: `entre ${SANDBOX_REQUEST_TIMEOUT_MS_MIN} y ${SANDBOX_REQUEST_TIMEOUT_MS_MAX} (ms)`,
    defaultLabel: String(DEFAULT_REQUEST_TIMEOUT_MS),
  });
}

/**
 * SANDBOX_POLL_RETRIES y SANDBOX_POLL_RETRY_DELAY_MS (WI-CORE-077). Se validan sobre el texto crudo:
 * ausente = default; vacía o solo espacios = error; solo enteros decimales (sin signo, decimal ni
 * notación) dentro de rango. Escribe el número normalizado en `validated`.
 */
function validateSandboxPollSettings(config: Record<string, unknown>, validated: EnvironmentVariables): void {
  validated.SANDBOX_POLL_RETRIES = parseBoundedInteger(config, 'SANDBOX_POLL_RETRIES', {
    defaultValue: DEFAULT_POLL_RETRIES,
    min: 0,
    max: SANDBOX_POLL_RETRIES_MAX,
    rangeLabel: `entre 0 y ${SANDBOX_POLL_RETRIES_MAX}`,
    defaultLabel: String(DEFAULT_POLL_RETRIES),
  });
  validated.SANDBOX_POLL_RETRY_DELAY_MS = parseBoundedInteger(config, 'SANDBOX_POLL_RETRY_DELAY_MS', {
    defaultValue: DEFAULT_POLL_RETRY_DELAY_MS,
    min: SANDBOX_POLL_RETRY_DELAY_MS_MIN,
    max: SANDBOX_POLL_RETRY_DELAY_MS_MAX,
    rangeLabel: `entre ${SANDBOX_POLL_RETRY_DELAY_MS_MIN} y ${SANDBOX_POLL_RETRY_DELAY_MS_MAX} (ms)`,
    defaultLabel: String(DEFAULT_POLL_RETRY_DELAY_MS),
  });
}

function parseBoundedInteger(
  config: Record<string, unknown>,
  name: string,
  options: { defaultValue: number; min: number; max: number; rangeLabel: string; defaultLabel: string },
): number {
  const raw = config[name];
  if (raw === undefined) {
    return options.defaultValue;
  }
  const text = String(raw).trim();
  if (text === '') {
    throw new Error(
      `Configuración de entorno inválida: ${name} no puede estar vacío; si no la define se usa el valor por defecto ${options.defaultLabel}.`,
    );
  }
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < options.min || value > options.max) {
    throw new Error(
      `Configuración de entorno inválida: ${name}=${echoEnvValue(text)} no es válido; debe ser un entero ${options.rangeLabel}.`,
    );
  }
  return value;
}

/** LLM_REASONING_EFFORT: obligatorio y dentro de la escala (WI-CORE-076). Normaliza el valor recortado. */
function validateLlmSettings(validated: EnvironmentVariables): void {
  // LLM_MODEL: si no está definida vale el valor por defecto; si está definida pero vacía o solo con espacios, falla
  // (ConfigService.get no aplica el default a cadenas vacías, y se enviaría `model: ""` a la API).
  if (validated.LLM_MODEL === undefined) {
    validated.LLM_MODEL = DEFAULT_LLM_MODEL;
  } else {
    const model = validated.LLM_MODEL.trim();
    if (model === '') {
      throw new Error(
        `Configuración de entorno inválida: LLM_MODEL no puede estar vacío; si no lo define se usa el valor por defecto ${DEFAULT_LLM_MODEL}.`,
      );
    }
    // El valor validado (sin espacios) es el que lee el adaptador.
    validated.LLM_MODEL = model;
  }

  const effort = (validated.LLM_REASONING_EFFORT ?? '').trim();
  const validValues = REASONING_EFFORT_SCALE.join(', ');
  if (effort === '') {
    throw new Error(
      `Configuración de entorno inválida: LLM_REASONING_EFFORT es obligatorio y no tiene valor por defecto. Defínalo con uno de: ${validValues} (low en pruebas, medium en evidencia oficial).`,
    );
  }
  if (!REASONING_EFFORT_SCALE.includes(effort)) {
    throw new Error(
      `Configuración de entorno inválida: LLM_REASONING_EFFORT=${echoEnvValue(effort)} no es un esfuerzo válido; valores válidos: ${validValues}.`,
    );
  }
  // El valor validado (sin espacios) es el que lee el adaptador.
  validated.LLM_REASONING_EFFORT = effort;
}

/** Aviso único al arrancar si quedan variables retiradas. No bloquea el arranque y no imprime valores. */
function warnRetiredLlmVariables(config: Record<string, unknown>): void {
  const retired = retiredLlmVariablesIn(config);
  if (retired.length === 0) {
    return;
  }
  new Logger('EnvValidation').warn(
    `Variables de LLM retiradas (WI-CORE-076): ${retired.join(', ')} siguen definidas y se IGNORAN. Los experimentos y el flujo normal usan LLM_MODEL y LLM_REASONING_EFFORT. Elimínelas del entorno.`,
  );
}

function validateExperimentLlmSettings(validated: EnvironmentVariables): void {
  const temperature = validated.EXPERIMENT_LLM_TEMPERATURE;
  if (temperature && !(Number.isFinite(Number(temperature)) && Number(temperature) >= 0 && Number(temperature) <= 2)) {
    throw new Error('Configuración de entorno inválida: EXPERIMENT_LLM_TEMPERATURE debe estar entre 0 y 2.');
  }

  const maxOutputTokens = validated.EXPERIMENT_LLM_MAX_OUTPUT_TOKENS;
  if (maxOutputTokens && !/^[1-9]\d*$/.test(maxOutputTokens)) {
    throw new Error('Configuración de entorno inválida: EXPERIMENT_LLM_MAX_OUTPUT_TOKENS debe ser un entero positivo.');
  }
}

function isAllowedSandboxUrl(value: string, allowHttpLoopback: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) return false;
    return url.protocol === 'https:' || (
      url.protocol === 'http:' && allowHttpLoopback &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function isAllowedGithubIntegrationUrl(value: string, allowHttpLoopback: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) return false;
    return url.protocol === 'https:' || (
      url.protocol === 'http:' && allowHttpLoopback &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
