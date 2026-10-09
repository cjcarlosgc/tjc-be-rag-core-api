export type LLMConfigurationErrorCode = 'REASONING_EFFORT_UNSUPPORTED' | 'MODEL_UNAVAILABLE';

export interface LLMConfigurationErrorDetails {
  code: LLMConfigurationErrorCode;
  model: string;
  requestedEffort: string | null;
  supportedEfforts: string[];
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
  }
}
