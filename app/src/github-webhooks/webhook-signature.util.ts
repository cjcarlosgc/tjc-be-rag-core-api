import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `x-hub-signature-256` es HMAC-SHA256 sobre el body crudo (antes de
 * parsear JSON), con el secreto compartido de la GitHub App. Se compara en
 * tiempo constante para no filtrar el secreto por timing.
 */
export function isValidWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!rawBody || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(signatureHeader, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
