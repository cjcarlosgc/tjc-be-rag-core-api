import { ArgumentsHost, BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { validateContract } from '../../contracts/contract-validator.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

/** Contrato del error envelope (INTEROP-2.17 §4, schemas/error-envelope.schema.json). */
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
  ])('%s', (_name, exception) => {
    const check = validateContract('error-envelope.schema.json', null, catchAndRead(exception));
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it('genera un correlationId cuando el middleware no lo fijó (el campo es obligatorio)', () => {
    const body = catchAndRead(new Error('x'), undefined) as { correlationId: string };
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(validateContract('error-envelope.schema.json', null, body).valid).toBe(true);
  });
});
