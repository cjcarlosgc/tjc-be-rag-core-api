import {
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateContract } from '../src/contracts/contract-validator.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';

/** Rutas de prueba que lanzan excepciones del framework sin código propio (DEC-ERR-001). */
@Controller('probe')
class ProbeController {
  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('detalle interno de autorización');
  }

  @Get('unavailable')
  unavailable(): never {
    throw new ServiceUnavailableException('dependencia interna caída: host 10.0.0.5');
  }

  @Get('internal')
  internal(): never {
    throw new InternalServerErrorException('stack de error interno');
  }
}

describe('Error envelope de códigos genéricos (e2e, INTEROP-2.18 §4)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('una ruta inexistente responde 404 NOT_FOUND con mensaje fijo y sin eco de la ruta', async () => {
    const response = await request(app.getHttpServer()).get('/no-existe/x?y=1').expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'El recurso solicitado no existe.',
      details: null,
      retryable: false,
    });
    expect(response.body.message).not.toContain('no-existe');
    expect(validateContract('error-envelope.schema.json', null, response.body).valid).toBe(true);
  });

  it('un método no registrado en una ruta existente responde 404 NOT_FOUND (el enrutador de Nest/Express no emite 405)', async () => {
    const response = await request(app.getHttpServer()).post('/probe/forbidden').expect(404);

    expect(response.body.code).toBe('NOT_FOUND');
    expect(validateContract('error-envelope.schema.json', null, response.body).valid).toBe(true);
  });

  it('un 403 sin código propio responde FORBIDDEN con mensaje fijo y sin el texto de la excepción', async () => {
    const response = await request(app.getHttpServer()).get('/probe/forbidden').expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'No tienes permiso para realizar esta operación.',
      retryable: false,
    });
    expect(JSON.stringify(response.body)).not.toContain('autorización');
    expect(validateContract('error-envelope.schema.json', null, response.body).valid).toBe(true);
  });

  it('un 503 sin código propio responde SERVICE_UNAVAILABLE retryable, nunca INVALID_REQUEST', async () => {
    const response = await request(app.getHttpServer()).get('/probe/unavailable').expect(503);

    expect(response.body).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'El servicio no está disponible temporalmente.',
      retryable: true,
    });
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.5');
    expect(validateContract('error-envelope.schema.json', null, response.body).valid).toBe(true);
  });

  it('un 500 sin código propio responde INTERNAL_ERROR sin filtrar el texto interno', async () => {
    const response = await request(app.getHttpServer()).get('/probe/internal').expect(500);

    expect(response.body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor.',
      retryable: false,
    });
    expect(response.body.code).not.toBe('INVALID_REQUEST');
    expect(JSON.stringify(response.body)).not.toContain('stack de error interno');
    expect(validateContract('error-envelope.schema.json', null, response.body).valid).toBe(true);
  });
});
