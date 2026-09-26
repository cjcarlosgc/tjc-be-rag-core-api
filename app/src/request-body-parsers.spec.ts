import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { configureRequestBodyParsers } from './request-body-parsers.js';

const serviceToken = 'test-only-github-integration-token';
const webhookPath = '/internal/v1/github/webhook-events';

function createServer() {
  const server = express();
  configureRequestBodyParsers(server, serviceToken);
  server.post(webhookPath, (req, res) => res.status(202).json({ bytes: req.body.payload.length }));
  server.post('/ordinary-json', (req, res) => res.status(200).json({ bytes: req.body.payload.length }));
  return server;
}

describe('route-scoped Core body parsers', () => {
  it('checks the service credential before parsing a large webhook body', async () => {
    const response = await request(createServer())
      .post(webhookPath)
      .send({ payload: 'x'.repeat(150_000) })
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('does not reflect an invalid correlation ID in parser-level errors', async () => {
    const invalidId = 'bad correlation id';
    const unauthorized = await request(createServer())
      .post(webhookPath)
      .set('X-Correlation-ID', invalidId)
      .send({ payload: 'small' })
      .expect(401);
    expect(unauthorized.headers['x-correlation-id']).not.toBe(invalidId);
    expect(unauthorized.body.correlationId).toBe(unauthorized.headers['x-correlation-id']);
    expect(unauthorized.body.correlationId).toMatch(/^[a-f0-9-]{36}$/i);

    const oversized = await request(createServer())
      .post('/ordinary-json')
      .set('X-Correlation-ID', invalidId)
      .send({ payload: 'x'.repeat(150_000) })
      .expect(413);
    expect(oversized.headers['x-correlation-id']).not.toBe(invalidId);
    expect(oversized.body.correlationId).toBe(oversized.headers['x-correlation-id']);
    expect(oversized.body.correlationId).toMatch(/^[a-f0-9-]{36}$/i);
  });

  it('accepts a large authenticated webhook without raising the general JSON limit', async () => {
    await request(createServer())
      .post(webhookPath)
      .set('Authorization', `Bearer ${serviceToken}`)
      .set('X-Correlation-ID', 'e2e-large-webhook')
      .send({ payload: 'x'.repeat(150_000) })
      .expect(202, { bytes: 150_000 });

    const ordinary = await request(createServer())
      .post('/ordinary-json')
      .send({ payload: 'x'.repeat(150_000) })
      .expect(413);
    expect(ordinary.body.code).toBe('INVALID_REQUEST');
  });
});
