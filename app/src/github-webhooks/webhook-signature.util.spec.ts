import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isValidWebhookSignature } from './webhook-signature.util.js';

const SECRET = 'test-secret';

function sign(body: Buffer, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('isValidWebhookSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = Buffer.from('{"action":"opened"}', 'utf8');

    expect(isValidWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a body signed with a different secret', () => {
    const body = Buffer.from('{"action":"opened"}', 'utf8');

    expect(isValidWebhookSignature(body, sign(body, 'other-secret'), SECRET)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const body = Buffer.from('{"action":"opened"}', 'utf8');
    const signature = sign(body);
    const tampered = Buffer.from('{"action":"closed"}', 'utf8');

    expect(isValidWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    const body = Buffer.from('{}', 'utf8');

    expect(isValidWebhookSignature(body, undefined, SECRET)).toBe(false);
  });

  it('rejects a signature header without the sha256= prefix', () => {
    const body = Buffer.from('{}', 'utf8');

    expect(isValidWebhookSignature(body, 'deadbeef', SECRET)).toBe(false);
  });

  it('rejects when the raw body was not captured', () => {
    expect(isValidWebhookSignature(undefined, sign(Buffer.from('{}')), SECRET)).toBe(false);
  });
});
