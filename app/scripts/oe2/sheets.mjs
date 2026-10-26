// WI-CORE-108 (ciclo 2, M-1): lectura de las hojas ciegas que vieron los anotadores (`ciego/hojas/T<nn>.md`, formato
// de `renderSheet` en pool.mjs). Sirve para comprobar que la llave y la plantilla son de la misma ejecución de `pool`:
// los `candidate_id` son posicionales (dependen de la semilla), así que solo la hoja fija qué candidato vio cada id.
// Robusto: acepta CRLF y solo interpreta líneas fuera de bloques de código (un `###` dentro de un bloque no cuenta).
import { Oe2DataError } from './io-primitives.mjs';

const OPEN_FENCE = /^(`{3,})/;
const CLOSE_FENCE = /^(`{3,})\s*$/;

/**
 * Parsea una hoja. Devuelve `{ targetId, targetFile, targetSymbol, candidates }` donde `candidates` es un Map
 * `candidate_id -> { filePath, qualifiedName }`. Lanza `Oe2DataError` si la estructura no es la de `renderSheet`
 * (sin línea «Target:», bloque de código sin cerrar o candidate_id repetido).
 */
export function parseSheet(text, label) {
  const lines = text.split(/\r?\n/);
  let fence = 0;
  let targetId = null;
  let targetFile = null;
  let targetSymbol = null;
  let current = null;
  const candidates = new Map();

  for (const line of lines) {
    if (fence > 0) {
      const close = CLOSE_FENCE.exec(line);
      if (close && close[1].length >= fence) fence = 0;
      continue;
    }
    const open = OPEN_FENCE.exec(line);
    if (open) {
      fence = open[1].length;
      continue;
    }
    if (line.startsWith('### ')) {
      const id = line.slice(4);
      if (candidates.has(id)) throw new Oe2DataError(`${label}: candidate_id ${id} repetido en la hoja`);
      current = { filePath: null, qualifiedName: null };
      candidates.set(id, current);
      continue;
    }
    if (line.startsWith('#')) {
      // Encabezados de nivel 1 y 2 (título y «## Candidatos») cierran el bloque de candidato en curso.
      current = null;
      continue;
    }
    const target = /^Target: (.+)$/.exec(line);
    if (target) {
      if (targetId !== null) throw new Oe2DataError(`${label}: más de una línea «Target:»`);
      targetId = target[1];
      continue;
    }
    const file = /^- Archivo: (.*)$/.exec(line);
    const symbol = /^- S.mbolo: (.*)$/.exec(line);
    if (file || symbol) {
      const value = (file ?? symbol)[1];
      if (current !== null) {
        if (file) current.filePath = value;
        else current.qualifiedName = value;
      } else if (targetId !== null) {
        if (file) targetFile = value;
        else targetSymbol = value;
      }
    }
  }
  if (fence > 0) throw new Oe2DataError(`${label}: bloque de código sin cerrar`);
  if (targetId === null) throw new Oe2DataError(`${label}: falta la línea «Target:»`);
  return { targetId, targetFile, targetSymbol, candidates };
}
