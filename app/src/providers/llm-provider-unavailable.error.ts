import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

/**
 * Fallo del proveedor de LLM durante una generación (WI-CORE-025).
 *
 * Conserva exactamente el contrato de `LLM_PROVIDER_UNAVAILABLE` (code, 503 y details).
 * `externalFailure` es solo un indicador interno para clasificar la repetición del
 * experimento: true para HTTP 5xx, 429 o error de conexión/timeout de red del SDK.
 */
export class LLMProviderUnavailableError extends AppException {
  constructor(details: string, readonly externalFailure: boolean) {
    super(
      ErrorCode.LLM_PROVIDER_UNAVAILABLE,
      'El proveedor de LLM no respondió correctamente.',
      HttpStatus.SERVICE_UNAVAILABLE,
      details,
    );
  }
}
