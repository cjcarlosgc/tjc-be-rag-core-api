// WI-CORE-107: cierre estático de profundidad 1 (D-OE2-5). Módulo ÚNICO compartido por `sample` (elegibilidad) y
// `pool` (candidatos de tipo), para que ambos usen exactamente la misma regla.
//
// Conjunto de tipos del proyecto: CLASS/INTERFACE/TRAIT/ENUM del volcado, indexados por FQCN (= symbolName). Un
// símbolo tiene como dependencia de profundidad 1 un tipo T si, excluida su clase declarante:
//   (a) el FQCN de T está en importsUsed del símbolo (sin `\` inicial), o
//   (b) T tiene su mismo namespace y su nombre corto aparece como palabra completa en el contenido, o
//   (c) el contenido contiene `\` + FQCN de T seguido de un carácter que no es de identificador (o fin de texto).
// (b) y (c) reutilizan las mismas expresiones que R-PHP3 y R-PHP4 del producto (ver product-copies.mjs).
import {
  fullyQualifiedMentionRegex,
  namespaceOf,
  shortNameMentionRegex,
  shortNameOf,
} from './product-copies.mjs';
import { compareCodeUnits } from './io-primitives.mjs';

export const TYPE_KINDS = Object.freeze(['CLASS', 'INTERFACE', 'TRAIT', 'ENUM']);
const TYPE_KIND_SET = new Set(TYPE_KINDS);

/** Índice de tipos del proyecto: `Map<FQCN, { fqcn, filePath, kind, namespace, shortName }>`. */
export function buildTypeIndex(chunks) {
  const index = new Map();
  const ordered = [...chunks]
    .filter((chunk) => TYPE_KIND_SET.has(chunk.symbolKind) && typeof chunk.symbolName === 'string')
    .sort((a, b) => compareCodeUnits(a.filePath, b.filePath));
  for (const chunk of ordered) {
    if (index.has(chunk.symbolName)) continue;
    index.set(chunk.symbolName, {
      fqcn: chunk.symbolName,
      filePath: chunk.filePath,
      kind: chunk.symbolKind,
      namespace: namespaceOf(chunk.symbolName),
      shortName: shortNameOf(chunk.symbolName),
      shortNameRegex: shortNameMentionRegex(chunk.symbolName),
      fqcnRegex: fullyQualifiedMentionRegex(chunk.symbolName),
    });
  }
  return index;
}

/** Quita el `\` inicial de un nombre importado. */
function stripLeadingBackslash(name) {
  return name.replace(/^\\/, '');
}

/**
 * Cierre de profundidad 1 de un símbolo METHOD o FUNCTION. `symbol` aporta: `kind`, `filePath`, `parentSymbolName`
 * (solo métodos), `symbolName` (solo funciones: FQCN de la función), `importsUsed` (unión de sus partes) y
 * `content` (partes unidas). Devuelve los FQCN del cierre, ordenados por unidades de código.
 */
export function symbolClosure(symbol, typeIndex) {
  const declaringClass = symbol.kind === 'METHOD' ? symbol.parentSymbolName ?? null : null;
  const symbolNamespace = namespaceOf(symbol.kind === 'METHOD' ? symbol.parentSymbolName ?? '' : symbol.symbolName ?? '');
  const imported = new Set((symbol.importsUsed ?? []).map(stripLeadingBackslash));
  const content = symbol.content ?? '';
  const closure = [];

  for (const type of typeIndex.values()) {
    if (type.fqcn === declaringClass) continue;
    const byImport = imported.has(type.fqcn);
    const bySameNamespace = !byImport && type.namespace === symbolNamespace && type.shortNameRegex.test(content);
    const byFullyQualified = !byImport && !bySameNamespace && type.fqcnRegex.test(content);
    if (byImport || bySameNamespace || byFullyQualified) closure.push(type.fqcn);
  }
  return closure.sort(compareCodeUnits);
}
