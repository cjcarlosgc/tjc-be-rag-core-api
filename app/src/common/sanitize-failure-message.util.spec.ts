import { describe, expect, it } from 'vitest';
import {
  FAILURE_MESSAGE_MAX_LENGTH,
  sanitizeFailureMessage,
} from './sanitize-failure-message.util.js';

describe('sanitizeFailureMessage (WI-CORE-007)', () => {
  it('devuelve idéntico un mensaje sin secretos, sin control y dentro del límite', () => {
    const message = 'Expected 2 to be 3 in src/sum.spec.ts';
    expect(sanitizeFailureMessage(message)).toBe(message);
  });

  it('redacta el valor de Authorization conservando la clave, también con esquema', () => {
    expect(sanitizeFailureMessage('Authorization: Bearer abc.def-123')).toBe(
      'Authorization: [REDACTED]',
    );
    expect(sanitizeFailureMessage('authorization=Basic dXNlcjpwYXNz')).toBe(
      'authorization=[REDACTED]',
    );
  });

  it('redacta Bearer suelto', () => {
    expect(sanitizeFailureMessage('request rejected, Bearer abc123def456')).toBe(
      'request rejected, Bearer [REDACTED]',
    );
  });

  it('redacta JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
    expect(sanitizeFailureMessage(`token ${jwt} rejected`)).toBe(
      'token [REDACTED] rejected',
    );
  });

  it('redacta claves tipo sk- (OpenAI)', () => {
    expect(sanitizeFailureMessage('invalid key sk-proj-AbC123_xyz9')).toBe(
      'invalid key [REDACTED]',
    );
  });

  it('redacta tokens de GitHub (ghp_, gho_, ghs_, github_pat_)', () => {
    expect(sanitizeFailureMessage('ghp_0123456789abcdefABCDEF')).toBe('[REDACTED]');
    expect(sanitizeFailureMessage('gho_0123456789abcdefABCDEF')).toBe('[REDACTED]');
    expect(sanitizeFailureMessage('ghs_0123456789abcdefABCDEF')).toBe('[REDACTED]');
    expect(sanitizeFailureMessage('github_pat_11ABCDEFG_0123456789abcdef')).toBe(
      '[REDACTED]',
    );
  });

  it('redacta claves de acceso de AWS (AKIA)', () => {
    expect(sanitizeFailureMessage('key AKIAIOSFODNN7EXAMPLE used')).toBe(
      'key [REDACTED] used',
    );
  });

  it('redacta bloques de clave privada PEM completos', () => {
    const message =
      'load failed -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY----- end';
    const sanitized = sanitizeFailureMessage(message);
    expect(sanitized).toBe('load failed [REDACTED] end');
    expect(sanitized).not.toContain('MIIEpAIBAAKCAQEA');
  });

  it('redacta valores de variables sensibles (PASSWORD, SECRET, TOKEN, KEY)', () => {
    expect(
      sanitizeFailureMessage('DATABASE_PASSWORD=hunter2 SECRET_TOKEN: xyz API_KEY=abc123'),
    ).toBe('DATABASE_PASSWORD=[REDACTED] SECRET_TOKEN: [REDACTED] API_KEY=[REDACTED]');
  });

  it('redacta el valor de una clave JSON sensible', () => {
    expect(sanitizeFailureMessage('{"password":"abc def","user":"ana"}')).toBe(
      '{"password":[REDACTED],"user":"ana"}',
    );
  });

  it('quita las credenciales user:pass@ de una URL', () => {
    expect(sanitizeFailureMessage('clone https://user:pass@example.com/repo.git failed')).toBe(
      'clone https://[REDACTED]@example.com/repo.git failed',
    );
  });

  it('quita query y fragmento de una URL firmada', () => {
    expect(
      sanitizeFailureMessage(
        'GET https://bucket.example.com/obj.zip?X-Amz-Signature=abc&X-Amz-Credential=def#frag failed',
      ),
    ).toBe('GET https://bucket.example.com/obj.zip failed');
  });

  it('quita el token que viaja en la query de una URL', () => {
    expect(sanitizeFailureMessage('https://api.example.com/v1/run?token=zzz')).toBe(
      'https://api.example.com/v1/run',
    );
  });

  it('elimina caracteres de control y convierte saltos en espacio', () => {
    expect(sanitizeFailureMessage('line one\nline two\u0007\tend')).toBe(
      'line one line two end',
    );
  });

  it('trunca a 500 caracteres cuando no hay secretos', () => {
    const sanitized = sanitizeFailureMessage('a'.repeat(900));
    expect(sanitized).toHaveLength(FAILURE_MESSAGE_MAX_LENGTH);
    expect(sanitized).toBe('a'.repeat(FAILURE_MESSAGE_MAX_LENGTH));
  });

  it('redacta antes de truncar: un secreto que cruza el límite no deja fragmento', () => {
    // El token empieza en la posición 495; si se truncara primero quedaría "sk-B…" sin redactar.
    const sanitized = sanitizeFailureMessage(`${'x'.repeat(495)} sk-${'B'.repeat(30)}`);
    expect(sanitized.length).toBeLessThanOrEqual(FAILURE_MESSAGE_MAX_LENGTH);
    expect(sanitized).not.toContain('sk-');
    expect(sanitized).not.toContain('BBBB');
  });

  it('es idempotente, incluso cuando el truncado corta un marcador', () => {
    const samples = [
      'Authorization: Bearer abc.def-123 and ghp_0123456789abcdefABCDEF',
      // El límite cae justo tras "password=[": el marcador queda cortado y no debe re-redactarse.
      `${'x'.repeat(489)} password=hunter2`,
      `${'y'.repeat(494)} https://u:p@h.example/a?sig=1`,
      'a'.repeat(900),
    ];
    for (const sample of samples) {
      const once = sanitizeFailureMessage(sample);
      expect(sanitizeFailureMessage(once)).toBe(once);
    }
    expect(sanitizeFailureMessage(`${'x'.repeat(489)} password=hunter2`)).toMatch(
      /password=\[$/,
    );
  });
});
