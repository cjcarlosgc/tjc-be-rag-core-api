import { createHash } from 'node:crypto';

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

/**
 * UUID v5 (RFC 4122): determinístico a partir de un namespace + nombre
 * canónico, vía SHA-1. Usado por DEC-IDEMP-001 para derivar identidades
 * hijas estables (mismo namespace + nombre => mismo id en cualquier retry),
 * sin depender de un paquete externo.
 */
export function uuidV5(namespace: string, name: string): string {
  const hash = createHash('sha1')
    .update(Buffer.concat([uuidToBytes(namespace), Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}
