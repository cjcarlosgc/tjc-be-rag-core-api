// WI-CORE-094: verificación de los hashes persistidos frente a los recalculados sobre los datos de la base.
// Veredictos: `coincide`, `no coincide` y `no verificable` (con motivo). Nunca «corrige» un valor persistido.
import { canonicalJson, sha256Hex } from './util.mjs';

export const VERDICT = Object.freeze({
  MATCH: 'coincide',
  MISMATCH: 'no coincide',
  UNVERIFIABLE: 'no verificable',
});

function unverifiable(name, persisted, reason) {
  return { name, persisted: persisted ?? null, recalculated: null, verdict: VERDICT.UNVERIFIABLE, reason };
}

/**
 * Compara un hash persistido con el SHA-256 del texto o de los bytes recibidos. `unverifiableReason` (si se pasa)
 * fuerza «no verificable» aunque haya valores (por ejemplo, contenido truncado).
 */
function compare({ name, persisted, data, unverifiableReason = null, note = null }) {
  if (unverifiableReason !== null) return unverifiable(name, persisted, unverifiableReason);
  if (typeof persisted !== 'string' || persisted.length === 0) {
    return unverifiable(name, null, 'sin hash persistido');
  }
  if (data === null || data === undefined) return unverifiable(name, persisted, 'sin datos sobre los que recalcular');
  const recalculated = sha256Hex(data);
  const verdict = recalculated === persisted ? VERDICT.MATCH : VERDICT.MISMATCH;
  return { name, persisted, recalculated, verdict, ...(note !== null && verdict === VERDICT.MISMATCH ? { note } : {}) };
}

/** `testContentSha256` frente al `testContent` de la BD (bytes UTF-8). Solo verificable sin truncado. */
export function testContentHashCheck(artifact) {
  const name = 'testContentSha256';
  if (artifact.testContent === null || artifact.testContent === undefined) {
    return unverifiable(name, artifact.testContentSha256, 'sin contenido de prueba persistido');
  }
  return compare({
    name,
    persisted: artifact.testContentSha256,
    data: artifact.testContent,
    unverifiableReason: artifact.testContentTruncated
      ? 'contenido truncado a 256 KiB: el hash persistido cubre el contenido completo, que no está en la base'
      : null,
  });
}

/** `artifactHash` (hash del contenido enviado al Sandbox, sin quitar NUL) frente al `testContent` persistido. */
export function artifactHashCheck(repetition, artifact) {
  const name = 'artifactHash';
  if (artifact === null || artifact.testContent === null || artifact.testContent === undefined) {
    return unverifiable(name, repetition.artifactHash, 'sin contenido de prueba persistido');
  }
  return compare({
    name,
    persisted: repetition.artifactHash,
    data: artifact.testContent,
    unverifiableReason: artifact.testContentTruncated ? 'contenido truncado a 256 KiB' : null,
    note: 'artifactHash no quita NUL y el texto persistido sí: una diferencia puede deberse a NUL en el contenido enviado',
  });
}

/** Hash de un JSON persistido (`runnerReportSha256`, `sandboxEvidenceSha256`) recalculado con JSON canónico. */
export function canonicalJsonHashCheck(name, persisted, value) {
  if (value === null || value === undefined) return unverifiable(name, persisted, 'sin valor JSON persistido');
  return compare({ name, persisted, data: canonicalJson(value) });
}

/** `contentSha256` de una propuesta frente a los bytes descargados de Storage. */
export function storageHashCheck(contentSha256, downloaded) {
  const name = 'contentSha256';
  if (!downloaded || downloaded.ok !== true) {
    return unverifiable(name, contentSha256, `objeto de Storage no descargado (${downloaded?.reason ?? 'no solicitado'})`);
  }
  return compare({ name, persisted: contentSha256, data: downloaded.bytes });
}

/** `promptSha256`: solo hash; el texto del prompt no se persiste, así que no hay nada que recalcular. */
export function promptHashCheck(promptSha256) {
  return unverifiable(
    'promptSha256',
    promptSha256,
    'el texto del prompt no se persiste (solo su hash; DEC-VAL-001 PENDING)',
  );
}

/** Cuenta veredictos de una lista de comprobaciones: `{ coincide, 'no coincide', 'no verificable' }`. */
export function countVerdicts(checks) {
  const counts = { [VERDICT.MATCH]: 0, [VERDICT.MISMATCH]: 0, [VERDICT.UNVERIFIABLE]: 0 };
  for (const check of checks) counts[check.verdict] += 1;
  return counts;
}
