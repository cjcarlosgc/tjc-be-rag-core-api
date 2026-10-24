import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateContract } from '../../contracts/contract-validator.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter.js';
import { GithubIntegrationAuthGuard } from '../github-integration-auth.guard.js';
import { GithubWebhooksController } from '../github-webhooks.controller.js';
import { GithubWebhooksService } from '../github-webhooks.service.js';
import { parseNormalizedWebhookEvent } from './normalized-webhook-event.js';

// Frontera CT-01 (WI-CORE-079, ST-CORE-095): el esquema canónico y el parser de Core deben aceptar y rechazar lo mismo,
// salvo las divergencias documentadas en GH-INTEROP-1.9 y listadas abajo con su motivo.

const SCHEMA = 'github-webhook-event.schema.json' as const;
const examplesDir = resolve(__dirname, '../../../../spec/contracts/schemas/examples');
const load = <T = Record<string, unknown>>(name: string): T => JSON.parse(readFileSync(resolve(examplesDir, name), 'utf8')) as T;
const manifest = load<{ examples: { file: string; schema: string; definition: string }[] }>('manifest.json');
const ceEntries = manifest.examples.filter((e) => e.schema === SCHEMA);
const eventEntries = ceEntries.filter((e) => e.definition === 'GithubWebhookEvent');
const responseEntries = ceEntries.filter((e) => e.definition === 'GitHubWebhookAcceptedResponse');

const baseEvent = () => load<Record<string, any>>('github-webhook-event.pull-request.opened.json');
const baseIgnored = () => load<Record<string, any>>('github-webhook-event.ignored.json');

function parserOutcome(value: unknown): 'ok' | AppException {
  try {
    parseNormalizedWebhookEvent(value);
    return 'ok';
  } catch (error) {
    return error as AppException;
  }
}

const schemaValid = (value: unknown) => validateContract(SCHEMA, 'GithubWebhookEvent', value).valid;
const parserValid = (value: unknown) => parserOutcome(value) === 'ok';

describe('CT-01: ejemplos canónicos del evento normalizado', () => {
  it('el manifest incluye los 13 eventos y las 2 respuestas (una entrada por variante)', () => {
    expect(eventEntries).toHaveLength(13);
    expect(responseEntries).toHaveLength(2);
  });

  it.each(eventEntries)('$file es válido para el esquema y para parseNormalizedWebhookEvent (round-trip)', ({ file }) => {
    const example = load(file);
    expect(validateContract(SCHEMA, 'GithubWebhookEvent', example)).toEqual({ valid: true, errors: [] });
    expect(parseNormalizedWebhookEvent(example)).toEqual(example);
  });

  it.each(responseEntries)('$file es una respuesta de aceptación válida', ({ file }) => {
    expect(validateContract(SCHEMA, 'GitHubWebhookAcceptedResponse', load(file)).valid).toBe(true);
  });

  it('cubre las nueve variantes por data.kind', () => {
    const kinds = new Set(eventEntries.map(({ file }) => (load(file) as { data: { kind: string } }).data.kind));
    expect([...kinds].sort()).toEqual([
      'IGNORED', 'INSTALLATION', 'INSTALLATION_REPOSITORIES', 'MEMBER', 'MEMBERSHIP', 'ORGANIZATION', 'PULL_REQUEST', 'REPOSITORY', 'TEAM',
    ]);
  });
});

describe('CT-01: entradas inválidas fallan en el esquema y en el parser (INVALID_REQUEST)', () => {
  const withData = (patch: Record<string, unknown>) => {
    const event = baseEvent();
    event.data = { ...event.data, ...patch };
    return event;
  };
  const withPr = (patch: Record<string, unknown>) => {
    const event = baseEvent();
    event.data.pullRequest = { ...event.data.pullRequest, ...patch };
    return event;
  };

  const invalid: [string, unknown][] = [
    ['clave extra en el sobre', { ...baseEvent(), extra: true }],
    ['clave ausente en el sobre (action)', (() => { const e = baseEvent(); delete e.action; return e; })()],
    ['clave extra en data', withData({ extra: 'x' })],
    ['clave extra en pullRequest', withPr({ extra: 'x' })],
    ['clave extra en repository', withData({ repository: { id: '1001', fullName: 'example-org/example-repo', extra: 1 } })],
    ['schemaVersion 2', { ...baseEvent(), schemaVersion: 2 }],
    ['deliveryId vacío', { ...baseEvent(), deliveryId: '' }],
    ['deliveryId de 256 caracteres', { ...baseEvent(), deliveryId: 'a'.repeat(256) }],
    ['eventName de 101 caracteres', { ...baseIgnored(), eventName: 'a'.repeat(101) }],
    ['action de 101 caracteres', { ...baseEvent(), action: 'a'.repeat(101) }],
    ['id de repositorio "0"', withData({ repository: { id: '0', fullName: 'example-org/example-repo' } })],
    ['id de repositorio "01"', withData({ repository: { id: '01', fullName: 'example-org/example-repo' } })],
    ['installationId numérico', withData({ installationId: 2001 })],
    ['pullRequestNumber 0', withData({ pullRequestNumber: 0 })],
    ['pullRequestNumber 1.5', withData({ pullRequestNumber: 1.5 })],
    ['pullRequestNumber "7"', withData({ pullRequestNumber: '7' })],
    ['createdAt con offset', withPr({ createdAt: '2026-01-01T00:00:00+01:00' })],
    ['createdAt sin Z', withPr({ createdAt: '2026-01-01T00:00:00' })],
    ['createdAt con día imposible', withPr({ createdAt: '2026-02-30T00:00:00Z' })],
    ['receivedAt con espacio', { ...baseEvent(), receivedAt: '2026-10-24 10:00:00Z' }],
    ['receivedAt con t minúscula', { ...baseEvent(), receivedAt: '2026-10-24t10:00:00Z' }],
    ['kind desconocido', withData({ kind: 'UNKNOWN' })],
    ['kind PULL_REQUEST con eventName "team"', { ...baseEvent(), eventName: 'team' }],
    ...['pull_request', 'installation', 'installation_repositories', 'repository', 'member', 'membership', 'organization', 'team'].map(
      (name): [string, unknown] => [`kind IGNORED con eventName "${name}"`, { ...baseIgnored(), eventName: name }],
    ),
    ['data null', { ...baseEvent(), data: null }],
    ['IGNORED con clave extra', { ...baseIgnored(), data: { kind: 'IGNORED', extra: 1 } }],
    ['added no es array', (() => {
      const e = load<Record<string, any>>('github-webhook-event.installation-repositories.json');
      e.data.added = {};
      return e;
    })()],
  ];

  it.each(invalid)('rechaza %s', (_label, value) => {
    expect(schemaValid(value)).toBe(false);
    const outcome = parserOutcome(value);
    expect(outcome).toBeInstanceOf(AppException);
    expect((outcome as AppException).code).toBe(ErrorCode.INVALID_REQUEST);
  });
});

describe('CT-01: paridad esquema ↔ parser', () => {
  /**
   * Casos con `divergence` documentada: el esquema y el parser devuelven resultados distintos a propósito.
   * - `longitud-UTF16`: el esquema cuenta puntos de código y el parser `length` (unidades UTF-16). Un emoji ocupa
   *   1 punto de código y 2 unidades: el parser es más estricto. Lo declara GH-INTEROP-1.9 como brecha.
   * - `fecha-segundo-60`: `format: date-time` admite el segundo intercalar 60 y `Date.parse` de V8 lo rechaza.
   * - `fecha-normalizada`: `Date.parse` de V8 normaliza un día inexistente o la hora 24:00:00 y el parser de `receivedAt` los acepta; `format: date-time` los rechaza.
   */
  const parity: { name: string; value: unknown; divergence?: 'longitud-UTF16' | 'fecha-segundo-60' | 'fecha-normalizada' }[] = [
    { name: 'base válida', value: baseEvent() },
    { name: 'title vacío (ambos aceptan)', value: (() => { const e = baseEvent(); e.data.pullRequest.title = ''; return e; })() },
    { name: 'ref vacío (ambos aceptan)', value: (() => { const e = baseEvent(); e.data.pullRequest.base.ref = ''; return e; })() },
    { name: 'sha vacío (ambos aceptan)', value: (() => { const e = baseEvent(); e.data.pullRequest.head.sha = ''; return e; })() },
    { name: 'receivedAt con offset (ambos aceptan)', value: { ...baseEvent(), receivedAt: '2026-10-24T10:00:00+01:00' } },
    { name: 'receivedAt con fracción de 9 dígitos (ambos aceptan)', value: { ...baseEvent(), receivedAt: '2026-10-24T10:00:00.123456789Z' } },
    { name: 'createdAt con fracción (ambos aceptan)', value: (() => { const e = baseEvent(); e.data.pullRequest.createdAt = '2026-01-01T00:00:00.5Z'; return e; })() },
    { name: 'pullRequestNumber por encima de Number.MAX_SAFE_INTEGER', value: (() => { const e = baseEvent(); e.data.pullRequestNumber = 9007199254740992; return e; })() },
    { name: 'action de 100 emojis (100 puntos de código, 200 unidades UTF-16)', value: { ...baseEvent(), action: '😀'.repeat(100) }, divergence: 'longitud-UTF16' },
    { name: 'deliveryId de 128 emojis (256 unidades UTF-16)', value: { ...baseEvent(), deliveryId: '😀'.repeat(128) }, divergence: 'longitud-UTF16' },
    { name: 'receivedAt con día inexistente (2026-02-30)', value: { ...baseEvent(), receivedAt: '2026-02-30T00:00:00Z' }, divergence: 'fecha-normalizada' },
    { name: 'receivedAt con hora 24:00:00', value: { ...baseEvent(), receivedAt: '2026-10-24T24:00:00Z' }, divergence: 'fecha-normalizada' },
    { name: 'createdAt con segundo 60', value: (() => { const e = baseEvent(); e.data.pullRequest.createdAt = '2026-01-01T23:59:60Z'; return e; })(), divergence: 'fecha-segundo-60' },
  ];

  it.each(parity)('$name', ({ value, divergence }) => {
    const s = schemaValid(value);
    const p = parserValid(value);
    if (divergence) {
      expect(s).not.toBe(p);
    } else {
      expect(s).toBe(p);
    }
  });
});

describe('CT-01: entrada HTTP con el ejemplo canónico pull-request.opened', () => {
  let app: INestApplication;
  const service = { handle: vi.fn() };
  const TOKEN = 'test-gh-to-core-token';
  const config = { get: vi.fn((key: string) => (key === 'GITHUB_INTEGRATION_TO_CORE_TOKEN' ? TOKEN : undefined)) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [GithubWebhooksController],
      providers: [
        GithubIntegrationAuthGuard,
        { provide: GithubWebhooksService, useValue: service },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockImplementation((key: string) => (key === 'GITHUB_INTEGRATION_TO_CORE_TOKEN' ? TOKEN : undefined));
    service.handle.mockImplementation(async (event: { deliveryId: string }) => ({
      deliveryId: event.deliveryId,
      accepted: true,
      duplicate: false,
      analysisRunId: null,
    }));
  });

  it('el ejemplo llega al servicio sin cambios y responde 202 con la respuesta canónica', async () => {
    const example = load('github-webhook-event.pull-request.opened.json');
    const response = await request(app.getHttpServer())
      .post('/internal/v1/github/webhook-events')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(example)
      .expect(202);

    expect(service.handle).toHaveBeenCalledTimes(1);
    expect(service.handle).toHaveBeenCalledWith(example);
    expect(validateContract(SCHEMA, 'GitHubWebhookAcceptedResponse', response.body).valid).toBe(true);
  });
});
