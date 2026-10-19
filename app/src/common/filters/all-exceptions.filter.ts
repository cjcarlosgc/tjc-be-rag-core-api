import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware.js';
import { ErrorCode } from '../errors/error-code.enum.js';

interface ErrorEnvelope {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details: unknown;
  correlationId: string;
  timestamp: string;
  path: string;
  /** INTEROP-2.18 §4: solo lo emiten los códigos genéricos; ausente en el resto. */
  retryable?: boolean;
}

/** Código genérico (DEC-ERR-001) para una HttpException del framework sin `code` propio. */
interface GenericHttpError {
  code: ErrorCode;
  /** Mensaje fijo en español: nunca repite el texto de la excepción (evita eco de internals y de rutas). */
  message: string;
  retryable: boolean;
}

const GENERIC_ERRORS_BY_STATUS: ReadonlyMap<number, GenericHttpError> = new Map<number, GenericHttpError>([
  [401, { code: ErrorCode.UNAUTHORIZED, message: 'Se requiere una credencial válida.', retryable: false }],
  [403, { code: ErrorCode.FORBIDDEN, message: 'No tienes permiso para realizar esta operación.', retryable: false }],
  [404, { code: ErrorCode.NOT_FOUND, message: 'El recurso solicitado no existe.', retryable: false }],
  [405, { code: ErrorCode.METHOD_NOT_ALLOWED, message: 'El método HTTP no está permitido para esta ruta.', retryable: false }],
  [406, { code: ErrorCode.NOT_ACCEPTABLE, message: 'El servicio no puede responder en el formato solicitado.', retryable: false }],
  [409, { code: ErrorCode.CONFLICT, message: 'El estado actual del recurso no permite la operación.', retryable: false }],
  [413, { code: ErrorCode.PAYLOAD_TOO_LARGE, message: 'El cuerpo de la solicitud excede el límite permitido.', retryable: false }],
  [415, { code: ErrorCode.UNSUPPORTED_MEDIA_TYPE, message: 'El tipo de contenido no es compatible.', retryable: false }],
  [422, { code: ErrorCode.UNPROCESSABLE_ENTITY, message: 'La solicitud es reconocible pero no se puede procesar.', retryable: false }],
  [429, { code: ErrorCode.TOO_MANY_REQUESTS, message: 'Se superó el límite de solicitudes; reintenta más tarde.', retryable: true }],
  [503, { code: ErrorCode.SERVICE_UNAVAILABLE, message: 'El servicio no está disponible temporalmente.', retryable: true }],
]);

const INTERNAL_GENERIC_ERROR: GenericHttpError = {
  code: ErrorCode.INTERNAL_ERROR,
  message: 'Error interno del servidor.',
  retryable: false,
};

const HTTP_GENERIC_ERROR: GenericHttpError = {
  code: ErrorCode.HTTP_ERROR,
  message: 'La solicitud no pudo procesarse.',
  retryable: false,
};

/**
 * Resuelve el código genérico de un estado HTTP sin código propio (INTEROP-2.18 §4, DEC-ERR-001):
 * estados aprobados con mensaje fijo; cualquier otro 5xx (500, 502, 504…) → INTERNAL_ERROR; otro 4xx → HTTP_ERROR.
 */
function resolveGenericError(statusCode: number): GenericHttpError {
  const known = GENERIC_ERRORS_BY_STATUS.get(statusCode);
  if (known) return known;
  return statusCode >= HttpStatus.INTERNAL_SERVER_ERROR ? INTERNAL_GENERIC_ERROR : HTTP_GENERIC_ERROR;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // INTEROP-2.17 §4: `correlationId` es obligatorio en el ErrorEnvelope; el middleware siempre lo fija, y sin él se genera uno.
    const correlationId = (request.headers[CORRELATION_ID_HEADER] as string | undefined) ?? randomUUID();

    const envelope = this.buildEnvelope(exception, request.url, correlationId);

    if (envelope.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${envelope.statusCode} [${envelope.code}] correlationId=${correlationId}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(envelope.statusCode).json(envelope);
  }

  private buildEnvelope(
    exception: unknown,
    path: string,
    correlationId: string,
  ): ErrorEnvelope {
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();

      // Un código explícito de AppException siempre prevalece sobre los genéricos (DEC-ERR-001).
      if (typeof body === 'object' && body !== null && 'code' in body) {
        const typedBody = body as { code: ErrorCode; message: string; details?: unknown };

        return {
          statusCode,
          code: typedBody.code,
          message: typedBody.message,
          details: typedBody.details ?? null,
          correlationId,
          timestamp,
          path,
        };
      }

      // 400 sin código propio: validación de DTO o BadRequestException; conserva su mensaje y la lista de detalles.
      if (statusCode === HttpStatus.BAD_REQUEST) {
        const message =
          typeof body === 'object' && body !== null && 'message' in body
            ? (body as { message: string | string[] }).message
            : exception.message;

        return {
          statusCode,
          code: ErrorCode.INVALID_REQUEST,
          message: Array.isArray(message) ? message.join('; ') : message,
          details: Array.isArray(message) ? message : null,
          correlationId,
          timestamp,
          path,
        };
      }

      const generic = resolveGenericError(statusCode);

      return {
        statusCode,
        code: generic.code,
        message: generic.message,
        details: null,
        correlationId,
        timestamp,
        path,
        retryable: generic.retryable,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Error interno del servidor.',
      details: null,
      correlationId,
      timestamp,
      path,
    };
  }
}
