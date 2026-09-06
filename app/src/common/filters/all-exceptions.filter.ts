import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware.js';
import { ErrorCode } from '../errors/error-code.enum.js';

interface ErrorEnvelope {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details: unknown;
  correlationId: string | undefined;
  timestamp: string;
  path: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = request.headers[CORRELATION_ID_HEADER] as string | undefined;

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
    correlationId: string | undefined,
  ): ErrorEnvelope {
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();

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
