// WI-CORE-094: copia local de `uuidV5` (`src/common/uuid-v5.util.ts`) y de `snapshotRefFor`
// (`src/evidence/evidence-mapping.ts`, DEC-EVID-005) para calcular el `snapshotRef` de la Tabla 70 sin importar
// TypeScript del producto. `uuid.spec.ts` compara ambas implementaciones.
import { createHash } from 'node:crypto';

/** Namespace de `snapshotRef` (mismo valor que `SNAPSHOT_REF_NAMESPACE` del producto). */
export const SNAPSHOT_REF_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function uuidToBytes(uuid) {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(bytes) {
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

/** UUID v5 (RFC 4122), determinista a partir de un namespace y un nombre. */
export function uuidV5(namespace, name) {
  const hash = createHash('sha1')
    .update(Buffer.concat([uuidToBytes(namespace), Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

/** `snapshotRef` = UUIDv5(namespace, `urn:tjc:snapshot-ref:v1:<projectVersionId>:<headSha>`); null si falta algún dato. */
export function snapshotRefFor(projectVersionId, headSha) {
  if (typeof projectVersionId !== 'string' || projectVersionId.length === 0) return null;
  if (typeof headSha !== 'string' || headSha.length === 0) return null;
  return uuidV5(SNAPSHOT_REF_NAMESPACE, `urn:tjc:snapshot-ref:v1:${projectVersionId}:${headSha}`);
}
