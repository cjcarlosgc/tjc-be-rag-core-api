// WI-CORE-094: paridad entre las copias locales del extractor y las utilidades del producto. Si el producto cambia
// sus reglas de redacción o de UUID y la copia no se actualiza, estas pruebas fallan.
import { describe, expect, it } from 'vitest';
import { redactSecretsInText } from './redaction.mjs';
import { snapshotRefFor, uuidV5 } from './uuid.mjs';
import { redactSecretsInText as productRedactSecretsInText } from '../../src/common/sanitize-failure-message.util.js';
import { uuidV5 as productUuidV5 } from '../../src/common/uuid-v5.util.js';
import { snapshotRefFor as productSnapshotRefFor } from '../../src/evidence/evidence-mapping.js';

const CORPUS = [
  'plain text without secrets',
  'Authorization: Bearer abcdefghijklmnopqrstuv',
  'Cookie: session=abc123; other=zzz\nnext line',
  'DATABASE_PASSWORD=hunter2 and api_key: sk-abcdefghijklmnop',
  'token expired',
  'password hunter2',
  'https://user:pass@example.com/path?token=abc#frag',
  'https://hooks.example/services/T12345678/B12345678/abcdef',
  'https://example.com/key/abcdefghijklmnopqrstu/x',
  '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG\n-----END PRIVATE KEY-----',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart',
  'ghp_abcdefghijklmnopqrstuvwxyz0123456789 and AKIAABCDEFGHIJKLMNOP',
  '$this->assertSame("token", $value); // Cookie: not really',
  "const cfg = { password: 'x', secret: \"y\" };",
  'AIzaSyA1234567890abcdefghijklmnopqrstu npm_abcdefghijklmnopqrstuvwx',
  'xoxb-1234567890-abcdefgh sk_live_abcdefghijk rk_live_abcdefgh',
  'multi\tline\u0001 control and émoji 🙂 text',
];

describe('redactSecretsInText (copia local frente al producto)', () => {
  it.each(CORPUS.map((text) => [text]))('produce la misma salida que el producto para %j', (text) => {
    expect(redactSecretsInText(text)).toBe(productRedactSecretsInText(text));
  });

  it('es idempotente', () => {
    for (const text of CORPUS) {
      const once = redactSecretsInText(text);
      expect(redactSecretsInText(once)).toBe(once);
    }
  });

  it('redacta el secreto de una cabecera Authorization', () => {
    expect(redactSecretsInText('Authorization: Bearer abcdefghijklmnopqrstuv')).not.toContain('abcdefghijklmnopqrstuv');
  });
});

describe('uuid (copia local frente al producto)', () => {
  it('uuidV5 produce el mismo resultado que el producto', () => {
    for (const name of ['urn:tjc:snapshot-ref:v1:pv-1:abc', 'x', 'ñ-unicode']) {
      expect(uuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', name)).toBe(
        productUuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', name),
      );
    }
  });

  it('snapshotRefFor produce el mismo resultado que el producto y null sin datos', () => {
    const pv = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
    const sha = 'a'.repeat(40);
    expect(snapshotRefFor(pv, sha)).toBe(productSnapshotRefFor(pv, sha));
    expect(snapshotRefFor(null, sha)).toBeNull();
    expect(snapshotRefFor(pv, '')).toBeNull();
  });
});
