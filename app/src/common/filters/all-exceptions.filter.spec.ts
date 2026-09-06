import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
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
  });

  it('maps a generic HttpException to INVALID_REQUEST with its own status', () => {
    const { host, status, json } = createHost(undefined);

    filter.catch(new BadRequestException('campo inválido'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0]).toMatchObject({
      code: ErrorCode.INVALID_REQUEST,
      message: 'campo inválido',
    });
  });

  it('preserves the HTTP status of built-in exceptions other than 400', () => {
    const { host, status } = createHost(undefined);

    filter.catch(new NotFoundException('no encontrado'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });
});
