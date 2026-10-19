import {
  ArgumentsHost,
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  MethodNotAllowedException,
  NotAcceptableException,
  NotFoundException,
  PayloadTooLargeException,
  RequestTimeoutException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppException } from '../errors/app.exception.js';
import { ErrorCode } from '../errors/error-code.enum.js';
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware.js';

function createHost(correlationId: string | undefined) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        url: '/whatever',
        headers: { [CORRELATION_ID_HEADER]: correlationId },
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

/** Texto crudo que una excepción del framework podría traer; no debe aparecer en la respuesta de un genérico. */
const RAW = 'texto-crudo-interno-no-exponer';

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('never leaks a stack trace and returns a generic message for unknown errors', () => {
    const { host, status, json } = createHost('corr-1');

    filter.catch(new Error('leaked internal detail'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body).not.toHaveProperty('stack');
    expect(body.message).toBe('Error interno del servidor.');
    expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(body.correlationId).toBe('corr-1');
    expect(body).not.toHaveProperty('retryable');
  });

  it('uses the AppException code, status and details as-is', () => {
    const { host, status, json } = createHost('corr-2');

    filter.catch(
      new AppException(ErrorCode.PROJECT_NOT_FOUND, 'no existe', HttpStatus.NOT_FOUND, {
        id: '123',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json.mock.calls[0][0]).toMatchObject({
      code: ErrorCode.PROJECT_NOT_FOUND,
      message: 'no existe',
      details: { id: '123' },
    });
    expect(json.mock.calls[0][0]).not.toHaveProperty('retryable');
  });

  it.each([
    ['404', new AppException(ErrorCode.CONTEXT_TRACE_NOT_FOUND, 'traza no encontrada', HttpStatus.NOT_FOUND), ErrorCode.CONTEXT_TRACE_NOT_FOUND, HttpStatus.NOT_FOUND],
    ['409', new AppException(ErrorCode.IDEMPOTENCY_CONFLICT, 'conflicto', HttpStatus.CONFLICT), ErrorCode.IDEMPOTENCY_CONFLICT, HttpStatus.CONFLICT],
    ['503', new AppException(ErrorCode.SANDBOX_UNAVAILABLE, 'sin sandbox', HttpStatus.SERVICE_UNAVAILABLE), ErrorCode.SANDBOX_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE],
  ])('un AppException con estado %s conserva su código propio y no recibe genérico', (_s, exception, code, statusCode) => {
    const { host, status, json } = createHost('corr-explicit');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json.mock.calls[0][0]).toMatchObject({ code });
    expect(json.mock.calls[0][0]).not.toHaveProperty('retryable');
  });

  it('maps a generic HttpException 400 to INVALID_REQUEST with its own status and message', () => {
    const { host, status, json } = createHost(undefined);

    filter.catch(new BadRequestException('campo inválido'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0]).toMatchObject({
      code: ErrorCode.INVALID_REQUEST,
      message: 'campo inválido',
      details: null,
    });
    expect(json.mock.calls[0][0]).not.toHaveProperty('retryable');
  });

  it('keeps the list of validation messages of a 400 as details', () => {
    const { host, json } = createHost(undefined);

    filter.catch(new BadRequestException(['a debe ser UUID', 'b es requerido']), host);

    expect(json.mock.calls[0][0]).toMatchObject({
      code: ErrorCode.INVALID_REQUEST,
      message: 'a debe ser UUID; b es requerido',
      details: ['a debe ser UUID', 'b es requerido'],
    });
  });

  it('preserves the HTTP status and maps a 404 without code to NOT_FOUND', () => {
    const { host, status, json } = createHost(undefined);

    filter.catch(new NotFoundException(`Cannot GET ${RAW}`), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json.mock.calls[0][0]).toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'El recurso solicitado no existe.',
      details: null,
      retryable: false,
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain(RAW);
  });

  it.each([
    // [excepción, estado, código genérico, mensaje fijo, retryable]
    [new UnauthorizedException(RAW), 401, ErrorCode.UNAUTHORIZED, 'Se requiere una credencial válida.', false],
    [new ForbiddenException(RAW), 403, ErrorCode.FORBIDDEN, 'No tienes permiso para realizar esta operación.', false],
    [new NotFoundException(RAW), 404, ErrorCode.NOT_FOUND, 'El recurso solicitado no existe.', false],
    [new MethodNotAllowedException(RAW), 405, ErrorCode.METHOD_NOT_ALLOWED, 'El método HTTP no está permitido para esta ruta.', false],
    [new NotAcceptableException(RAW), 406, ErrorCode.NOT_ACCEPTABLE, 'El servicio no puede responder en el formato solicitado.', false],
    [new ConflictException(RAW), 409, ErrorCode.CONFLICT, 'El estado actual del recurso no permite la operación.', false],
    [new PayloadTooLargeException(RAW), 413, ErrorCode.PAYLOAD_TOO_LARGE, 'El cuerpo de la solicitud excede el límite permitido.', false],
    [new UnsupportedMediaTypeException(RAW), 415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, 'El tipo de contenido no es compatible.', false],
    [new UnprocessableEntityException(RAW), 422, ErrorCode.UNPROCESSABLE_ENTITY, 'La solicitud es reconocible pero no se puede procesar.', false],
    [new HttpException(RAW, HttpStatus.TOO_MANY_REQUESTS), 429, ErrorCode.TOO_MANY_REQUESTS, 'Se superó el límite de solicitudes; reintenta más tarde.', true],
    [new ServiceUnavailableException(RAW), 503, ErrorCode.SERVICE_UNAVAILABLE, 'El servicio no está disponible temporalmente.', true],
  ])('genérico #%# con código, retryable y mensaje fijo, sin eco de la excepción', (exception, statusCode, code, message, retryable) => {
    const { host, status, json } = createHost('corr-generic');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      statusCode,
      code,
      message,
      details: null,
      correlationId: 'corr-generic',
      timestamp: expect.any(String),
      path: '/whatever',
      retryable,
    });
    expect(JSON.stringify(body)).not.toContain(RAW);
  });

  it.each([
    // 5xx sin código distinto de 503 → INTERNAL_ERROR, nunca INVALID_REQUEST ni el texto crudo.
    [new InternalServerErrorException(RAW), 500],
    [new BadGatewayException(RAW), 502],
    [new GatewayTimeoutException(RAW), 504],
  ])('5xx sin código #%# se mapea a INTERNAL_ERROR sin eco', (exception, statusCode) => {
    const { host, status, json } = createHost(undefined);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    const body = json.mock.calls[0][0];
    expect(body).toMatchObject({
      statusCode,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Error interno del servidor.',
      details: null,
      retryable: false,
    });
    expect(body.code).not.toBe(ErrorCode.INVALID_REQUEST);
    expect(JSON.stringify(body)).not.toContain(RAW);
  });

  it.each([
    [new RequestTimeoutException(RAW), 408],
    [new HttpException(RAW, 402), 402],
  ])('otro 4xx sin código #%# se mapea a HTTP_ERROR sin eco', (exception, statusCode) => {
    const { host, status, json } = createHost(undefined);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json.mock.calls[0][0]).toMatchObject({
      statusCode,
      code: ErrorCode.HTTP_ERROR,
      message: 'La solicitud no pudo procesarse.',
      details: null,
      retryable: false,
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain(RAW);
  });
});
