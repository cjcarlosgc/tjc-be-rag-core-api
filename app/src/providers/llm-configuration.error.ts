export type LLMConfigurationErrorCode =
  | 'REASONING_EFFORT_UNSUPPORTED'
  | 'MODEL_UNAVAILABLE'
  | 'TEMPERATURE_UNSUPPORTED_WITH_REASONING';

export interface LLMConfigurationErrorDetails {
  code: LLMConfigurationErrorCode;
  model: string;
  requestedEffort: string | null;
  supportedEfforts: string[];
  /** Solo para `TEMPERATURE_UNSUPPORTED_WITH_REASONING`: la temperatura pedida. */
  temperature?: number | null;
}

/**
 * Error tipado de configuración del proveedor LLM. Es interno: no es
 * AppException ni agrega ErrorCode; WI-CORE-025 lo mapea a HTTP.
 */
export class LLMConfigurationError extends Error {
  readonly code: LLMConfigurationErrorCode;
  readonly model: string;
  readonly requestedEffort: string | null;
  readonly supportedEfforts: string[];
  readonly temperature: number | null;

  constructor(details: LLMConfigurationErrorDetails, message?: string) {
    super(
      message ??
        `Configuración de LLM no válida (${details.code}) para el modelo "${details.model}".`,
    );
    this.name = 'LLMConfigurationError';
    this.code = details.code;
    this.model = details.model;
    this.requestedEffort = details.requestedEffort;
    this.supportedEfforts = details.supportedEfforts;
    this.temperature = details.temperature ?? null;
  }
}
