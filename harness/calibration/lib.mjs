// Replay de calibracion offline del RAG (WI-CORE-063). Puro: no escribe nada, no llama a LLM ni a la base.
// Metricas M1, M3, M4, M5, M6 y recalculo del ranking sobre candidatos persistidos.
// Reglas de clasificacion R-PHP y regex de colaboradores: reutilizadas de harness/reports/fase2-01-replay-colaboradores.py.
// isFinalPhpDeclaration: reimplementada en JS (no se importa app/src/retrieval/php-dependency-context.ts).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_CONFIG = Object.freeze({ semanticWeight: 0.7, structuralWeight: 0.3, topK: 10, minimumScore: 0 });
export const TYPE_KINDS = new Set(['CLASS', 'INTERFACE', 'TRAIT', 'ENUM']);
const METHOD_KINDS = new Set(['METHOD', 'FUNCTION']);
const SNIPPET_MAX = 80;
const EVIDENCE_MAX = 20;

// ---------- utilidades de nombres (igual que fase2-01) ----------
export const stripSlash = (s) => (s ?? '').replace(/^\\+/, '');
export const shortName = (f) => f.slice(f.lastIndexOf('\\') + 1);
export const namespaceOf = (f) => { const i = f.lastIndexOf('\\'); return i >= 0 ? f.slice(0, i) : ''; };
export const ownerOf = (c) => c.parentSymbolName || (TYPE_KINDS.has(c.symbolKind) ? c.symbolName : null);
export const isTypeChunk = (c) => TYPE_KINDS.has(c.symbolKind);
const BUILTIN_TYPES = new Set(['DateTimeImmutable', 'DateTime', 'InvalidArgumentException', 'Exception', 'self', 'static',
  'float', 'int', 'string', 'bool', 'array', 'void', 'null', 'mixed', 'callable', 'iterable', 'object']);

// Clases globales de PHP (sin use), en minusculas.
export const GLOBAL_PHP_CLASSES = new Set([
  'closure', 'stringable', 'countable', 'arrayaccess', 'traversable', 'iterator', 'iteratoraggregate', 'jsonserializable',
  'datetime', 'datetimeimmutable', 'datetimeinterface', 'dateinterval', 'throwable', 'exception', 'invalidargumentexception',
  'runtimeexception', 'logicexception', 'domainexception', 'typeerror', 'unexpectedvalueexception', 'arrayiterator',
  'arrayobject', 'splobjectstorage', 'generator', 'stdclass', 'error', 'valueerror', 'arithmeticerror',
]);
const PHP_RESERVED_TYPES = new Set(['int', 'float', 'string', 'bool', 'array', 'callable', 'iterable', 'mixed', 'object',
  'void', 'never', 'null', 'false', 'true', 'self', 'static', 'parent']);

// ---------- carga ----------
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

/** Descubre los ids de caso con `<ID>.meta.json` en el directorio de datos. */
export function discoverCases(dataDir) {
  return readdirSync(dataDir).filter((f) => f.endsWith('.meta.json')).map((f) => f.slice(0, -'.meta.json'.length)).sort();
}

/** Carga un caso: meta, chunks, cands, trials (opcional) y entrada de deps.json (opcional). */
export function loadCase(dataDir, caseId, depsList = null) {
  const base = join(dataDir, caseId);
  const meta = readJson(`${base}.meta.json`);
  const chunks = readJson(`${base}.chunks.json`);
  const cands = readJson(`${base}.cands.json`);
  const trials = existsSync(`${base}.trials.json`) ? readJson(`${base}.trials.json`) : null;
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const anchor = chunks.find((c) => c.filePath === meta.filePath && METHOD_KINDS.has(c.symbolKind)
    && c.symbolName === meta.methodName && c.parentSymbolName === meta.symbolName);
  if (!anchor) throw new Error(`[${caseId}] no se encuentra el chunk objetivo ${meta.symbolName}::${meta.methodName}`);
  for (const k of cands) {
    if (!byId.has(k.chunkId)) throw new Error(`[${caseId}] candidato ${k.chunkId} sin chunk en chunks.json`);
  }
  const deps = depsList ? (depsList.find((d) => d.caso === caseId) ?? null) : null;
  return { id: caseId, meta, chunks, cands, trials, deps, anchor, byId, anchorClass: anchor.parentSymbolName };
}

/** Lee deps.json (array) si existe en el directorio de datos. */
export function loadDeps(dataDir) {
  const p = join(dataDir, 'deps.json');
  return existsSync(p) ? readJson(p) : null;
}

// ---------- ranking ----------
/** Top-K persistido: candidatos con decision SELECTED, ordenados por rank. */
export function baselineTopK(c) {
  return c.cands.filter((k) => k.decision === 'SELECTED').sort((a, b) => a.rank - b.rank).map((k) => k.chunkId);
}

/**
 * Recalcula combined = ws·(sem||0) + wt·(struct?1:0) sobre los candidatos persistidos.
 * Orden: combined desc, luego rank asc. Devuelve el ranking completo y los seleccionados (topK, combined >= minimumScore).
 */
export function recompute(c, config = DEFAULT_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const ranking = c.cands.map((k) => ({
    chunkId: k.chunkId,
    rank: k.rank,
    sem: k.sem,
    struct: k.struct,
    persistedDecision: k.decision,
    combined: cfg.semanticWeight * (k.sem || 0) + cfg.structuralWeight * (k.struct ? 1 : 0),
  })).sort((a, b) => (b.combined - a.combined) || (a.rank - b.rank));
  const selected = ranking.filter((r) => r.combined >= cfg.minimumScore).slice(0, cfg.topK).map((r) => r.chunkId);
  return { config: cfg, ranking, selected };
}

// ---------- colaboradores (fase2-01: classify/collaborators) ----------
/** Colaboradores: tipos del constructor de la clase declarante, firma del metodo y `new X` del cuerpo. FQCN. */
export function collaboratorsOf(c) {
  const ac = c.anchorClass;
  const ctor = c.chunks.filter((x) => x.symbolKind === 'CONSTRUCTOR' && x.parentSymbolName === ac && x.filePath === c.anchor.filePath);
  const classChunk = c.chunks.find((x) => x.symbolKind === 'CLASS' && x.symbolName === ac);
  const uses = new Set([...(classChunk?.importsUsed ?? []), ...c.anchor.importsUsed ?? [], ...ctor.flatMap((x) => x.importsUsed ?? [])].map(stripSlash));
  const txt = [c.anchor.content, ...ctor.map((x) => x.content)].join('\n');
  const sig = [...txt.matchAll(/(?:\(|,)\s*(?:private |public |protected )?(?:readonly )?\??\\?([A-Z][A-Za-z0-9_\\]*)\s+\$/g)].map((m) => m[1]);
  const news = [...txt.matchAll(/new\s+\\?([A-Z][A-Za-z0-9_\\]*)/g)].map((m) => m[1]);
  const types = new Set(c.chunks.filter(isTypeChunk).map((x) => x.symbolName));
  const out = new Set();
  for (const n of new Set([...sig, ...news])) {
    if (BUILTIN_TYPES.has(n)) continue;
    let full = null;
    for (const u of uses) if (shortName(u) === shortName(n)) full = u;
    if (full === null && ac && types.has(namespaceOf(ac) + '\\' + n)) full = namespaceOf(ac) + '\\' + n;
    if (full === null && types.has(n)) full = n;
    if (full && types.has(full) && full !== ac) out.add(full);
  }
  return [...out].sort();
}

// ---------- M1 ----------
/**
 * M1: para cada colaborador, (a) hay un chunk de tipo con ese FQCN en el top-K seleccionado,
 * (b) el FQCN aparece en la seccion de dependencias de deps.json (si existe). Devuelve faltantes.
 */
export function m1Collaborators(c, selectedIds) {
  const collab = collaboratorsOf(c);
  const selected = selectedIds.map((id) => c.byId.get(id));
  const inTop = [];
  const missingTop = [];
  for (const f of collab) {
    (selected.some((x) => isTypeChunk(x) && x.symbolName === f) ? inTop : missingTop).push(f);
  }
  let inSection = null; let missingSection = null;
  if (c.deps) {
    const fq = new Set(c.deps.entries.map((e) => e.fqcn));
    inSection = collab.filter((f) => fq.has(f));
    missingSection = collab.filter((f) => !fq.has(f));
  }
  const total = collab.length;
  return {
    collaborators: collab,
    total,
    inTop,
    missingTop,
    inSection,
    missingSection,
    // Faltante = no esta en el top-K ni en la seccion (si existe la seccion).
    missingAnywhere: c.deps ? collab.filter((f) => !inTop.includes(f) && !inSection.includes(f)) : missingTop,
    pctInTop: total ? round((inTop.length / total) * 100) : null,
  };
}

// ---------- M3 ----------
export const isTestChunk = (c) => /(^|\/)tests?\//i.test(c.filePath) || /Test\.php$/.test(c.filePath);
const mentions = (text, name) => !!name && new RegExp(`\\b${escapeRe(name)}\\b`).test(text);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const memberName = (x) => (x.symbolName === 'constructor' ? '__construct' : x.symbolName);

/**
 * M3 ruido. Criterios (definidos aqui y en el informe):
 *  - testNoise: chunk de prueba (ruta con tests/ o sufijo Test.php) cuyo contenido NO menciona el metodo objetivo (\bmetodo\b).
 *  - memberNoise: chunk miembro (con parentSymbolName) distinto de la clase declarante, que no es prueba, cuyo nombre
 *    NO aparece en el fragmento del objetivo (cubre miembros de otras clases y del mismo archivo).
 * Porcentajes sobre los tokens (tokenCount persistido) de los seleccionados.
 */
export function m3Noise(c, selectedIds) {
  const sel = selectedIds.map((id) => c.byId.get(id));
  const total = sum(sel.map((x) => x.tokenCount));
  let testTok = 0; let memberTok = 0; const testIds = []; const memberIds = [];
  for (const x of sel) {
    if (isTestChunk(x)) {
      if (!mentions(x.content, c.meta.methodName)) {
        testTok += x.tokenCount ?? 0; testIds.push(x.id);
      }
      continue;
    }
    if (x.parentSymbolName && x.parentSymbolName !== c.anchorClass && !mentions(c.anchor.content, memberName(x))) {
      memberTok += x.tokenCount ?? 0; memberIds.push(x.id);
    }
  }
  return {
    selectedTokens: total,
    testNoiseTokens: testTok,
    testNoisePct: total ? round((testTok / total) * 100) : 0,
    memberNoiseTokens: memberTok,
    memberNoisePct: total ? round((memberTok / total) * 100) : 0,
    testNoiseCount: testIds.length,
    memberNoiseCount: memberIds.length,
  };
}

// ---------- M4 ----------
/** Renderizado de la seccion de dependencias (mismo texto que renderPhpDependencySection). */
export function renderDependencySection(entries) {
  if (!entries || entries.length === 0) return '';
  const header = 'Dependencias del código objetivo (nombres completos de clase; usa exactamente estos nombres en los `use`):';
  const lines = entries.map((e) => `- ${e.typeName} → ${e.fqcn} (${e.origin === 'CONSTRUCTOR' ? 'constructor' : 'firma del método'})`
    + (e.final === true ? ' — final: no se puede mockear; usa una instancia real (new, o un caso si es un enum)' : ''));
  return [header, ...lines].join('\n');
}

/**
 * M4 tokens. Persistidos: suma de tokenCount de los seleccionados y sectionTokens de deps.json.
 * Contados: tokenizer (cl100k_base si esta disponible, si no estimacion ceil(chars/4)) sobre el texto de la seccion
 * renderizada y sobre el contenido de los seleccionados. deltaVsBaselinePct: variacion de tokens seleccionados frente a la base.
 */
export function m4Tokens(c, selectedIds, tokenizer, baseSelectedIds = null) {
  const sel = selectedIds.map((id) => c.byId.get(id));
  const persisted = sum(sel.map((x) => x.tokenCount));
  const counted = sum(sel.map((x) => tokenizer.count(x.content)));
  const section = c.deps ? c.deps.entries : null;
  const sectionCounted = section ? tokenizer.count(renderDependencySection(section)) : null;
  // WI-CORE-065: tokens de firmas (extra frente a la misma sección sin firmas), si deps.json los registra.
  const hasSignatureFields = !!c.deps && 'signatureExtraTokens' in c.deps;
  let delta = null;
  if (baseSelectedIds) {
    const base = sum(baseSelectedIds.map((id) => c.byId.get(id).tokenCount));
    delta = base ? round(((persisted - base) / base) * 100) : null;
  }
  return {
    tokenizer: tokenizer.name,
    selectedTokensPersisted: persisted,
    selectedTokensCounted: counted,
    sectionTokens: c.deps ? c.deps.sectionTokens : null,
    sectionTokensCounted: sectionCounted,
    sectionTokensSinFirmas: hasSignatureFields ? c.deps.sectionTokensSinFirmas : null,
    signatureExtraTokens: hasSignatureFields ? c.deps.signatureExtraTokens : null,
    baselineContextTokens: c.deps ? c.deps.baselineContextTokens : null,
    deltaVsBaselinePct: delta,
  };
}

// ---------- M5 ----------
/** M5: solape del top-K candidato con la linea base. n/K, Jaccard, mismo conjunto y mismo orden. */
export function m5Stability(baseIds, candIds) {
  const b = new Set(baseIds); const k = new Set(candIds);
  const inter = [...k].filter((x) => b.has(x)).length;
  const union = new Set([...b, ...k]).size;
  return {
    k: baseIds.length,
    overlap: inter,
    overlapLabel: `${inter}/${baseIds.length}`,
    jaccard: union ? round(inter / union) : 1,
    sameSet: inter === baseIds.length && k.size === b.size,
    sameOrder: baseIds.length === candIds.length && baseIds.every((x, i) => x === candIds[i]),
    tenOfTen: baseIds.length === 10 && inter === 10 && candIds.length === 10 && baseIds.every((x, i) => x === candIds[i]),
  };
}

// ---------- M6 ----------
/** Modificadores PHP (final, readonly, abstract) antes de `class`, tras espacios, comentarios y atributos #[...]. */
export function phpModifiers(content, symbolKind) {
  if (typeof content !== 'string') return null;
  const decl = stripLeadingPhpNoise(content);
  const m = /^((?:(?:final|readonly|abstract)\s+)+)class\s/i.exec(decl);
  if (!m) return symbolKind === 'ENUM' ? new Set(['final']) : null;
  const mods = new Set(m[1].toLowerCase().split(/\s+/).filter(Boolean));
  if (symbolKind === 'ENUM') mods.add('final');
  return mods;
}

/** true si la declaracion es enum o `final` (no abstract) con `class`. Nunca lanza. */
export function isFinalPhpDeclaration(content, symbolKind) {
  try {
    if (symbolKind === 'ENUM') return true;
    const mods = phpModifiers(content, symbolKind);
    return !!mods && mods.has('final') && !mods.has('abstract');
  } catch { return false; }
}

function stripLeadingPhpNoise(content) {
  let rest = content;
  for (let guard = 0; guard < 10000; guard += 1) {
    rest = rest.replace(/^\s+/, '');
    if (rest.startsWith('//') || (rest.startsWith('#') && !rest.startsWith('#['))) {
      const nl = rest.indexOf('\n'); if (nl < 0) return ''; rest = rest.slice(nl + 1); continue;
    }
    if (rest.startsWith('/*')) { const end = rest.indexOf('*/', 2); if (end < 0) return ''; rest = rest.slice(end + 2); continue; }
    if (rest.startsWith('#[')) { const end = attributeEnd(rest); if (end < 0) return ''; rest = rest.slice(end + 1); continue; }
    return rest;
  }
  return '';
}

function attributeEnd(text) {
  let depth = 0; let quote = null;
  for (let i = 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Tipos del caso: FQCN -> { final, readonly, kind } a partir de los chunks de tipo. */
export function typeIndex(chunks) {
  const idx = new Map();
  for (const x of chunks) {
    if (!isTypeChunk(x)) continue;
    const mods = phpModifiers(x.content, x.symbolKind);
    idx.set(x.symbolName, {
      kind: x.symbolKind,
      final: x.symbolKind === 'ENUM' || (!!mods && mods.has('final') && !mods.has('abstract')),
      readonly: !!mods && mods.has('readonly'),
    });
  }
  return idx;
}

function parseTestFile(text) {
  const ns = /^namespace\s+([\\\w]+)\s*;/m.exec(text);
  const aliases = new Map(); const useLines = [];
  const re = /^use\s+(?!function\s|const\s)([\\\w]+)(?:\s+as\s+(\w+))?\s*;/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const fqcn = stripSlash(m[1]);
    aliases.set(m[2] ?? shortName(fqcn), fqcn);
    useLines.push({ fqcn, line: lineOf(text, m.index), raw: m[0] });
  }
  return { namespace: ns ? ns[1] : '', aliases, useLines };
}

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }
const snippet = (s) => s.trim().slice(0, SNIPPET_MAX);

function resolveTestName(name, parsed) {
  const n = stripSlash(name);
  if (name.startsWith('\\')) return n;
  const first = n.split('\\')[0];
  if (parsed.aliases.has(first)) return [parsed.aliases.get(first), ...n.split('\\').slice(1)].join('\\');
  return parsed.namespace ? `${parsed.namespace}\\${n}` : n;
}

/** M6: reglas estaticas sobre testContent de cada trial (no sustituye a ejecutar la prueba).
 *  R-FINAL: createMock|createStub|getMockBuilder|prophesize|Mockery::mock( X::class ) con X resuelto a tipo final del caso.
 *  R-SAME : assertSame( arg1, arg2 ) con un argumento que es
 *           (a) `new X(` inline con X DateTime/DateTimeImmutable o final readonly del caso; o
 *           (b) una variable $v asignada DENTRO DEL MISMO METODO con `new X(` (DateTime/DateTimeImmutable o final readonly
 *               del caso) o con DateTimeImmutable::createFromFormat(, Y $v no aparece en ninguna otra sentencia de ese metodo
 *               salvo su asignacion y ese assertSame. Si se pasa a un constructor, setter, metodo o expresion, se asume
 *               posible identidad y NO se marca.
 *  R-NS   : `use` de nivel superior cuyo FQCN no aparece en {FQCN de tipos del caso, importsUsed de los chunks,
 *           FQCN de deps.json}, ni es PHPUnit\Framework\*, ni es una clase global de PHP (sin barra).
 * Solo se consideran lineas; las llamadas multilinea de assertSame no se analizan (limitacion documentada).
 * Precision observada: por regla, trials (analizados) con hit y su resultado (valid / fallido con evidencia en errorSummary).
 */
const RULE_IDS = ['R-FINAL', 'R-SAME', 'R-NS', 'R-ANON-FINAL', 'R-STATIC-THIS', 'R-SIG', 'R-NEW-ENUM'];
/** Evidencia en errorSummary de la clase de fallo que cada regla pretende detectar. */
export const FAILURE_EVIDENCE = {
  'R-FINAL': (s) => /ClassIsFinal/.test(s) || (/final/i.test(s) && /mock/i.test(s)),
  'R-SAME': (s) => /same object|reference the same/i.test(s),
  'R-NS': (s) => /not found|Class (?:or interface )?"[^"]*" does not exist|UnknownType/i.test(s),
  'R-ANON-FINAL': (s) => /cannot extend final|final class|cannot implement .* it is not an interface/i.test(s),
  'R-STATIC-THIS': (s) => /Using \$this when not in object context/i.test(s),
  'R-SIG': (s) => /ArgumentCountError|Too few arguments|Unknown named parameter/i.test(s),
  'R-NEW-ENUM': (s) => /Cannot instantiate enum/i.test(s),
};

/** Segmentos de metodo: desde cada `function nombre(` hasta la linea anterior a la siguiente declaracion. */
function functionSegments(lines) {
  const starts = [];
  lines.forEach((l, i) => { if (/\bfunction\s+\w+\s*\(/.test(l)) starts.push(i); });
  return starts.map((start, k) => ({ start, end: (k + 1 < starts.length ? starts[k + 1] : lines.length) - 1 }));
}

/** Tipo que habilita identidad marcable: DateTime, DateTimeImmutable o final readonly del caso. */
function isDateOrVo(fq, types) {
  const info = types.get(fq);
  return shortName(fq) === 'DateTime' || shortName(fq) === 'DateTimeImmutable' || (!!info && info.final && info.readonly);
}

function usedElsewhere(lines, seg, v, assignLines, skipLine) {
  const re = new RegExp(`\\$${v}\\b`);
  for (let j = seg.start; j <= seg.end; j += 1) {
    if (j === skipLine || assignLines.has(j)) continue;
    if (re.test(lines[j])) return true;
  }
  return false;
}

/** R-SAME dentro de un metodo. Llama a hit(numeroDeLinea) por cada argumento marcado. */
function sameHitsInSegment(lines, seg, parsed, types, hit) {
  const qual = new Map();
  const add = (v, i) => { if (!qual.has(v)) qual.set(v, new Set()); qual.get(v).add(i); };
  for (let i = seg.start; i <= seg.end; i += 1) {
    for (const m of lines[i].matchAll(/\$(\w+)\s*=\s*new\s+(\\?[A-Za-z_][\w\\]*)\s*\(/g)) {
      if (isDateOrVo(resolveTestName(m[2], parsed), types)) add(m[1], i);
    }
    for (const m of lines[i].matchAll(/\$(\w+)\s*=\s*\\?DateTimeImmutable::createFromFormat\s*\(/g)) add(m[1], i);
  }
  for (let i = seg.start; i <= seg.end; i += 1) {
    const pos = lines[i].indexOf('assertSame(');
    if (pos < 0) continue;
    const args = splitArgs(lines[i].slice(pos + 'assertSame('.length)).slice(0, 2);
    for (const a of args) {
      const trimmed = a.trim();
      const nm = /^new\s+(\\?[A-Za-z_][\w\\]*)\s*\(/.exec(trimmed);
      const vm = /^\$(\w+)$/.exec(trimmed);
      let bad = false;
      if (nm) bad = isDateOrVo(resolveTestName(nm[1], parsed), types);
      else if (vm && qual.has(vm[1])) bad = !usedElsewhere(lines, seg, vm[1], qual.get(vm[1]), i);
      if (bad) hit(i + 1);
    }
  }
}

/** Ratios de precision/sensibilidad a partir de contadores crudos. 'n/a' si el denominador es 0. */
export function precisionOf(counts) {
  return {
    ...counts,
    precision: counts.hitTrials ? round(counts.hitFailedWithEvidence / counts.hitTrials) : 'n/a',
    sensitivity: counts.failedWithEvidence ? round(counts.hitFailedWithEvidence / counts.failedWithEvidence) : 'n/a',
  };
}

/**
 * Precision observada agregada (suma de contadores crudos de varios casos). Ignora casos sin trials.
 * Devuelve null si ningun caso tiene M6.
 */
export function aggregateM6Precision(m6List) {
  const list = m6List.filter(Boolean);
  if (list.length === 0) return null;
  const out = {};
  for (const r of RULE_IDS) {
    const acc = { hitTrials: 0, hitValid: 0, hitFailed: 0, hitFailedWithEvidence: 0, failedWithEvidence: 0 };
    for (const m of list) for (const k of Object.keys(acc)) acc[k] += m.precision[r][k];
    out[r] = precisionOf(acc);
  }
  return out;
}

export function m6Static(c) {
  if (!c.trials) return null;
  const types = typeIndex(c.chunks);
  const known = new Set();
  for (const x of c.chunks) {
    if (isTypeChunk(x)) known.add(x.symbolName);
    for (const i of x.importsUsed ?? []) known.add(stripSlash(i));
  }
  if (c.deps) for (const e of c.deps.entries) known.add(e.fqcn);
  const rules = Object.fromEntries(RULE_IDS.map((r) => [r, []]));
  const sigs = caseSignatures(c);
  const hitTrials = Object.fromEntries(RULE_IDS.map((r) => [r, new Set()]));
  let trialsAnalyzed = 0;
  c.trials.forEach((t, ti) => {
    if (typeof t.testContent !== 'string') return;
    trialsAnalyzed += 1;
    const where = { strategy: t.strategy, repetition: t.repetition };
    const parsed = parseTestFile(t.testContent);
    const lines = t.testContent.split('\n');
    const hitRules = new Set();
    const pushRule = (rule, entry) => { rules[rule].push({ ...entry, ...where }); hitRules.add(rule); };
    lines.forEach((line, idx) => {
      const ln = idx + 1;
      for (const m of line.matchAll(/(createMock|createStub|getMockBuilder|prophesize|Mockery::mock)\s*\(\s*(\\?[\w\\]+)::class\s*\)/g)) {
        const fq = resolveTestName(m[2], parsed);
        const info = types.get(fq);
        if (info && info.final) pushRule('R-FINAL', { line: ln, snippet: snippet(line), type: fq });
      }
    });
    for (const seg of functionSegments(lines)) {
      sameHitsInSegment(lines, seg, parsed, types, (ln) => pushRule('R-SAME', { line: ln, snippet: snippet(lines[ln - 1]) }));
    }
    // WI-CORE-065: clase anonima que extiende un tipo final del caso (new class extends X / new class(...) extends X).
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(/new\s+class\s*(?:\([^)]*\)\s*)?extends\s+(\\?[A-Za-z_][\w\\]*)/g)) {
        const fq = resolveTestName(m[1], parsed);
        const info = types.get(fq);
        if (info && info.final) pushRule('R-ANON-FINAL', { line: idx + 1, snippet: snippet(line), type: fq });
      }
    });
    // WI-CORE-067: clase anonima que implementa (implements A, B) un tipo final del caso; interfaces y no final no cuentan.
    lines.forEach((line, idx) => {
      const head = /new\s+class\s*(?:\([^)]*\)\s*)?((?:extends|implements)\b[^{]*)/.exec(line);
      const impl = head ? /\bimplements\s+([^{]*)/.exec(head[1]) : null;
      if (!impl) return;
      for (const raw of impl[1].split(',')) {
        const nm = /^\\?[A-Za-z_][\w\\]*/.exec(raw.trim());
        if (!nm) continue;
        const fq = resolveTestName(nm[0], parsed);
        const info = types.get(fq);
        if (info && info.final) pushRule('R-ANON-FINAL', { line: idx + 1, snippet: snippet(line), type: fq });
      }
    });
    // WI-CORE-065: $this-> dentro de closures static (function con balance de llaves; fn hasta fin de expresion).
    const seenThis = new Set();
    for (const body of staticClosureBodies(t.testContent)) {
      const text = t.testContent.slice(body.start, body.end + 1);
      for (const m of text.matchAll(/\$this\s*->/g)) {
        const pos = body.start + m.index;
        if (seenThis.has(pos)) continue;
        seenThis.add(pos);
        const ln = lineOf(t.testContent, pos);
        pushRule('R-STATIC-THIS', { line: ln, snippet: snippet(lines[ln - 1]) });
      }
    }
    // WI-CORE-065: argumentos de `new X(` incompatibles con la firma conocida de X (texto multilinea incluido).
    for (const m of t.testContent.matchAll(/new\s+(\\?[A-Za-z_][\w\\]*)\s*\(/g)) {
      const fq = resolveTestName(m[1], parsed);
      const params = sigs.get(fq);
      if (!params) continue;
      const open = m.index + m[0].length - 1;
      const args = splitArgs(t.testContent.slice(open + 1));
      const reason = signatureMismatch(args, params);
      if (reason) {
        const ln = lineOf(t.testContent, m.index);
        pushRule('R-SIG', { line: ln, snippet: snippet(lines[ln - 1]), type: fq, reason });
      }
    }
    // WI-CORE-067: `new X(` donde X es un enum conocido del caso (un enum no se instancia).
    for (const m of t.testContent.matchAll(/new\s+(\\?[A-Za-z_][\w\\]*)\s*\(/g)) {
      const fq = resolveTestName(m[1], parsed);
      const info = types.get(fq);
      if (info && info.kind === 'ENUM') {
        const ln = lineOf(t.testContent, m.index);
        pushRule('R-NEW-ENUM', { line: ln, snippet: snippet(lines[ln - 1]), type: fq });
      }
    }
    for (const u of parsed.useLines) {
      const ok = known.has(u.fqcn) || u.fqcn.startsWith('PHPUnit\\Framework\\')
        || (!u.fqcn.includes('\\') && GLOBAL_PHP_CLASSES.has(u.fqcn.toLowerCase()));
      if (!ok) pushRule('R-NS', { line: u.line, snippet: snippet(u.raw), fqcn: u.fqcn });
    }
    for (const r of hitRules) hitTrials[r].add(ti);
  });

  const precision = {};
  for (const r of RULE_IDS) {
    const counts = { hitTrials: 0, hitValid: 0, hitFailed: 0, hitFailedWithEvidence: 0, failedWithEvidence: 0 };
    c.trials.forEach((t, ti) => {
      const fail = t.valid === false;
      const ev = fail && FAILURE_EVIDENCE[r](String(t.errorSummary ?? ''));
      if (ev) counts.failedWithEvidence += 1;
      if (!hitTrials[r].has(ti)) return;
      counts.hitTrials += 1;
      if (t.valid === true) counts.hitValid += 1;
      if (fail) { counts.hitFailed += 1; if (ev) counts.hitFailedWithEvidence += 1; }
    });
    precision[r] = precisionOf(counts);
  }
  return {
    trialsAnalyzed,
    rules: Object.entries(rules).map(([rule, hits]) => ({
      rule, count: hits.length, evidence: hits.slice(0, EVIDENCE_MAX),
    })),
    precision,
  };
}

// ---- WI-CORE-065: R-ANON-FINAL, R-STATIC-THIS, R-SIG (M6) ----

/** Indice del delimitador de cierre que empareja el de apertura en `open`, saltando cadenas. -1 si no cierra. */
function matchClose(text, open, o, c) {
  let depth = 0; let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === o) depth += 1;
    else if (ch === c) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Cuerpos de closures `static function` (balance de llaves) y `static fn` (expresion hasta `,`, `;` o cierre a nivel 0). */
export function staticClosureBodies(text) {
  const bodies = [];
  // Solo closures: `static function (` o `static fn (`; un metodo `static function nombre(` no entra.
  const re = /\bstatic\s+(function|fn)(?=\s*\()/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const open = text.indexOf('(', m.index + m[0].length);
    if (open < 0) continue;
    const close = matchClose(text, open, '(', ')');
    if (close < 0) continue;
    if (m[1] === 'function') {
      const brace = text.indexOf('{', close);
      if (brace < 0) continue;
      const end = matchClose(text, brace, '{', '}');
      if (end > 0) bodies.push({ start: brace, end });
    } else {
      const arrow = text.indexOf('=>', close);
      if (arrow < 0) continue;
      let depth = 0; let quote = null; let end = text.length - 1;
      for (let i = arrow + 2; i < text.length; i += 1) {
        const ch = text[i];
        if (quote !== null) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth += 1;
        else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) { end = i - 1; break; } depth -= 1; }
        else if ((ch === ',' || ch === ';') && depth === 0) { end = i - 1; break; }
      }
      bodies.push({ start: arrow, end });
    }
  }
  return bodies;
}

/** Parametros de una lista (texto entre parentesis, sin el `(` inicial): [{ name, required, variadic }]. Null si no legible. */
export function parseParamList(inner) {
  const params = [];
  for (const raw of splitArgs(`${inner})`)) {
    const p = raw.replace(/#\[[^\]]*\]/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (p === '') continue;
    const name = /\$(\w+)/.exec(p);
    if (!name) return null;
    const after = p.slice(p.indexOf(`$${name[1]}`) + name[1].length + 1);
    const hasDefault = /^\s*=/.test(after);
    const variadic = /\.\.\.\s*\$/.test(p);
    params.push({ name: name[1], required: !hasDefault && !variadic, variadic });
  }
  return params;
}

/** Parametros del constructor de un contenido PHP (misma logica que la firma: hasta el parentesis balanceado). */
export function constructorParams(content) {
  if (typeof content !== 'string') return null;
  const m = /\bfunction\s+__construct\s*\(/i.exec(content);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchClose(content, open, '(', ')');
  if (close < 0) return null;
  return parseParamList(content.slice(open + 1, close));
}

/** Firmas por FQCN: deps.json `signatures` si existe (lo que consta en el contexto); si no, chunks CONSTRUCTOR unicos. */
export function caseSignatures(c) {
  const sigs = new Map();
  if (c.deps && Array.isArray(c.deps.signatures)) {
    for (const s of c.deps.signatures) {
      const params = s.signature.startsWith('(') && s.signature.endsWith(')')
        ? parseParamList(s.signature.slice(1, -1)) : null;
      if (params) sigs.set(s.fqcn, params);
    }
    return sigs;
  }
  const byParent = new Map();
  for (const x of c.chunks) {
    if (x.symbolKind !== 'CONSTRUCTOR' || !x.parentSymbolName) continue;
    byParent.set(x.parentSymbolName, [...(byParent.get(x.parentSymbolName) ?? []), x]);
  }
  for (const [parent, list] of byParent) {
    if (list.length !== 1) continue;
    const params = constructorParams(list[0].content);
    if (params) sigs.set(parent, params);
  }
  return sigs;
}

/** R-SIG: `new X(` con firma conocida y argumentos que no la cumplen (faltan obligatorios o nombre desconocido). Sin splat. */
export function signatureMismatch(args, params) {
  if (args.some((a) => a.trim().startsWith('...'))) return null;
  const parts = args.map((a) => a.trim()).filter((a, i, all) => !(all.length === 1 && a === ''));
  const covered = new Set();
  let positional = 0;
  let namedSeen = false;
  for (const a of parts) {
    const named = /^(\w+)\s*:(?!:)/.exec(a);
    if (named) {
      namedSeen = true;
      const idx = params.findIndex((p) => p.name === named[1]);
      if (idx < 0) return 'unknown-named';
      covered.add(idx);
    } else {
      if (namedSeen) return null; // posicional tras nombrado: sintaxis invalida, no se opina
      covered.add(positional);
      positional += 1;
    }
  }
  const missing = params.findIndex((p, i) => p.required && !covered.has(i));
  return missing >= 0 ? 'missing-required' : null;
}

/** Divide los argumentos de una llamada (texto desde tras el '('), respetando parentesis y comillas. */
function splitArgs(rest) {
  const out = []; let depth = 0; let cur = ''; let quote = null;
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (quote) { cur += ch; if (ch === '\\') { cur += rest[i + 1] ?? ''; i += 1; } else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') { if (depth === 0) { out.push(cur); return out; } depth -= 1; }
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ---------- tokenizer ----------
/** Intenta cargar gpt-tokenizer (cl100k_base) desde app/node_modules; si no puede, estima ceil(chars/4). */
export async function loadTokenizer(repoRoot = REPO_ROOT) {
  try {
    const req = createRequire(join(repoRoot, 'app', 'package.json'));
    let mod;
    try { mod = req('gpt-tokenizer/encoding/cl100k_base'); } catch {
      mod = await import(pathToFileURL(req.resolve('gpt-tokenizer/encoding/cl100k_base')).href);
    }
    if (typeof mod.countTokens !== 'function') throw new Error('sin countTokens');
    return { name: 'cl100k_base', count: (text) => (text ? mod.countTokens(text) : 0) };
  } catch {
    return { name: 'estimate', count: (text) => Math.ceil((text ?? '').length / 4) };
  }
}

// ---------- helpers ----------
export function round(x, d = 2) { return x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d; }
function sum(xs) { return xs.reduce((a, b) => a + (b ?? 0), 0); }

/**
 * Evalua una configuracion sobre un caso y devuelve todas las metricas.
 * baseIds: seleccion de la linea base (para M4 delta y M5). Si config es la base, M5 es 10/10 por definicion.
 */
export function evaluate(c, config, tokenizer, baseIds) {
  const rec = recompute(c, config);
  const selected = rec.selected;
  return {
    config: rec.config,
    selected,
    m1: m1Collaborators(c, selected),
    m3: m3Noise(c, selected),
    m4: m4Tokens(c, selected, tokenizer, baseIds),
    m5: m5Stability(baseIds, selected),
  };
}

export const METRIC_VERSION = 'WI-CORE-063/v1';
