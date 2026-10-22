import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateContract } from '../../contracts/contract-validator.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

const examplesDir = resolve(__dirname, '../../../../spec/contracts/schemas/examples');

/** Contrato del error envelope (INTEROP-2.18 §4, schemas/error-envelope.schema.json). */
function catchAndRead(exception: unknown, ...header: [string | undefined] | []) {
  const correlationId = header.length ? header[0] : 'corr-contract';
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/ruta?x=1', headers: { [CORRELATION_ID_HEADER]: correlationId } }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return json.mock.calls[0][0] as unknown;
}

describe('AllExceptionsFilter cumple el ErrorEnvelope canónico', () => {
  it.each([
    ['AppException con detalles', new AppException(ErrorCode.PROJECT_NOT_FOUND, 'no existe', HttpStatus.NOT_FOUND, { id: '123' })],
    ['AppException sin detalles', new AppException(ErrorCode.SANDBOX_UNAVAILABLE, 'sin sandbox', HttpStatus.SERVICE_UNAVAILABLE)],
    ['HttpException de validación con varios mensajes', new BadRequestException(['a debe ser UUID', 'b es requerido'])],
    ['HttpException genérica', new ForbiddenException('prohibido')],
    ['error desconocido', new Error('detalle interno')],
    ['código genérico 404 NOT_FOUND', new NotFoundException('Cannot GET /x')],
    ['código genérico 415 sin retryable', new UnsupportedMediaTypeException('tipo no soportado')],
    ['código genérico 429 con retryable true', new HttpException('límite', HttpStatus.TOO_MANY_REQUESTS)],
    ['código genérico 503 con retryable true', new ServiceUnavailableException('caído')],
    ['5xx sin código (INTERNAL_ERROR)', new InternalServerErrorException('detalle')],
    ['código genérico HTTP_ERROR', new HttpException('x', 402)],
  ])('%s', (_name, exception) => {
    const check = validateContract('error-envelope.schema.json', null, catchAndRead(exception));
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it('un código genérico usa mensaje fijo y no repite el texto de la excepción', () => {
    const body = catchAndRead(new ForbiddenException('prohibido')) as { code: string; message: string; retryable: boolean };
    expect(body).toMatchObject({
      code: ErrorCode.FORBIDDEN,
      message: 'No tienes permiso para realizar esta operación.',
      retryable: false,
    });
    expect(body.message).not.toContain('prohibido');
  });

  it('retryable solo aparece en los códigos genéricos (true en 429 y 503) y es opcional en el esquema', () => {
    const throttled = catchAndRead(new HttpException('límite', HttpStatus.TOO_MANY_REQUESTS)) as { retryable?: boolean };
    expect(throttled.retryable).toBe(true);
    const unavailable = catchAndRead(new ServiceUnavailableException('caído')) as { retryable?: boolean };
    expect(unavailable.retryable).toBe(true);
    const explicit = catchAndRead(new AppException(ErrorCode.PROJECT_NOT_FOUND, 'no existe', HttpStatus.NOT_FOUND)) as object;
    expect(explicit).not.toHaveProperty('retryable');
    expect(validateContract('error-envelope.schema.json', null, explicit).valid).toBe(true);
  });

  it('el ejemplo canónico de código genérico cumple el esquema', () => {
    const example = JSON.parse(readFileSync(resolve(examplesDir, 'error-envelope.generic.json'), 'utf8')) as unknown;
    expect(validateContract('error-envelope.schema.json', null, example).valid).toBe(true);
  });

  it('genera un correlationId cuando el middleware no lo fijó (el campo es obligatorio)', () => {
    const body = catchAndRead(new Error('x'), undefined) as { correlationId: string };
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(validateContract('error-envelope.schema.json', null, body).valid).toBe(true);
  });
});
