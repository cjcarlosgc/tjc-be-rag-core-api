// WI-CORE-107: subcomando `sample`. Universo de símbolos METHOD/FUNCTION, elegibilidad ex ante (D-OE2-5, sin retrieval)
// y sorteo con semilla registrada. Solo lee el volcado de chunks y escribe archivos en --out.
import { readFile } from 'node:fs/promises';
import { Oe2DataError, createMulberry32, hex32, identityKey, readChunksFile, seedStateFromText, shuffleInPlace } from './io-primitives.mjs';
import { UNIVERSE_COLUMNS, buildUniverse, universeCsvRow } from './universe.mjs';
import { resolveOe2OutputDir, writeOe2Package, PackagePlan } from './output.mjs';
import { toCsv, sha256Hex } from '../evidence-extractor/util.mjs';

/** Columnas de `sample.csv`: el rol y el orden del sorteo, el repositorio y el símbolo con su cierre. */
export const SAMPLE_COLUMNS = Object.freeze([
  'role', 'order', 'repo', 'filePath', 'qualifiedName', 'kind', 'closureSize', 'closureTypes',
]);

/** Algoritmo documentado en `sample.json` (la misma secuencia que implementa `drawSample`). */
export const SAMPLE_ALGORITHM = Object.freeze([
  '1. Universo: chunks METHOD y FUNCTION agrupados por símbolo (CONSTRUCTOR y tipos fuera). Clave de símbolo: (filePath, kind, symbolName, parentSymbolName).',
  '2. Elegibilidad ex ante sin retrieval: archivo PHP que no es de prueba (isTestFile) ni está en directorio ignorado; partes completas; firma con cuerpo ({); cierre estático de profundidad 1 no vacío (excluida la clase declarante); no excluido por --exclude.',
  '3. Ordenación: elegibles ordenados por (filePath, qualifiedName) comparando por unidades de código UTF-16.',
  '4. Semilla: state = primeros 32 bits, big-endian, de SHA-256(semilla en UTF-8). Generador mulberry32: state = (state + 0x6D2B79F5) | 0; t = state; t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); salida cruda = (t ^ (t >>> 14)) >>> 0; valor en [0,1) = salida / 2^32.',
  '5. Barajado de Fisher-Yates descendente: para i = n-1 hasta 1, j = floor(valor * (i + 1)), intercambiar i y j.',
  '6. Roles por posición en la lista barajada: primeros N_calibracion = calibracion, siguientes N_oficial = oficial, siguientes N_reserva = reserva. Si hay menos elegibles, se usan todos sin relajar criterios y se advierte.',
  '7. El cierre se recalcula en pool con el mismo módulo (closure.mjs); sample.csv lo registra para comprobarlo.',
]);

/**
 * Sorteo puro. `eligible` debe venir ordenado por (filePath, qualifiedName). Devuelve las filas con rol y orden, las
 * primeras cinco salidas crudas en hexadecimal y las advertencias por falta de elegibles.
 */
export function drawSample(eligible, { seed, calibration, official, reserve }) {
  const state = seedStateFromText(seed);
  const shuffled = shuffleInPlace([...eligible], createMulberry32(state));
  // Documentación del generador: las cinco primeras salidas crudas de la semilla, con independencia de cuántas
  // consuma el barajado (con pocos elegibles el barajado consume menos de cinco).
  const documentation = createMulberry32(state);
  const firstRaw = Array.from({ length: 5 }, () => documentation());

  const rows = [];
  const warnings = [];
  let cursor = 0;
  for (const [role, count] of [['calibracion', calibration], ['oficial', official], ['reserva', reserve]]) {
    for (let taken = 0; taken < count && cursor < shuffled.length; taken += 1) {
      rows.push({ role, order: rows.length + 1, row: shuffled[cursor] });
      cursor += 1;
    }
  }
  const requested = calibration + official + reserve;
  if (shuffled.length < requested) {
    warnings.push(`solo ${shuffled.length} elegibles para ${requested} targets pedidos; se usan todos sin relajar criterios`);
  }
  return {
    state,
    rows,
    warnings,
    firstRawHex: firstRaw.map(hex32),
  };
}

/** Lee `--exclude`: una identidad `filePath::qualifiedName` por línea; vacías y las que empiezan por `#` se ignoran. */
export async function readExclusions(filePath) {
  const text = (await readFile(filePath)).toString('utf8');
  const excluded = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('::');
    if (separator <= 0 || separator + 2 >= line.length) throw new Oe2DataError('--exclude: línea sin formato filePath::qualifiedName');
    excluded.add(identityKey(line.slice(0, separator), line.slice(separator + 2)));
  }
  return excluded;
}

/** Filas de `sample.csv` a partir del sorteo. */
export function sampleCsvRows(drawn, repo) {
  return drawn.rows.map(({ role, order, row }) => ({
    role,
    order,
    repo,
    filePath: row.filePath,
    qualifiedName: row.qualifiedName,
    kind: row.kind,
    closureSize: row.closureSize,
    closureTypes: row.closure.join(';'),
  }));
}

/** Subcomando `sample`: escribe universe.csv, eligible.csv, sample.csv, sample.json, README.txt y el manifiesto. */
export async function runSample({ options, cwd, repoRoot }) {
  const outDir = await resolveOe2OutputDir(options, { cwd, repoRoot });
  const exclusions = options.exclude ? await readExclusions(options.exclude) : new Set();
  const { chunks, sha256: dumpSha256 } = await readChunksFile(options.dump);
  const universe = buildUniverse(chunks, { excluded: exclusions });
  const drawn = drawSample(universe.eligible, {
    seed: options.seed,
    calibration: options.calibration,
    official: options.official,
    reserve: options.reserve,
  });
  const repo = options.repo ?? '';
  const sampleRows = sampleCsvRows(drawn, repo);

  const reasonCounts = {};
  for (const row of universe.rows) {
    const key = row.eligible ? 'elegible' : row.reason;
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }
  const sampledCounts = { calibracion: 0, oficial: 0, reserva: 0 };
  for (const { role } of drawn.rows) sampledCounts[role] += 1;

  const plan = new PackagePlan();
  plan.addText('universe.csv', toCsv(UNIVERSE_COLUMNS, universe.rows.map(universeCsvRow)));
  plan.addText('eligible.csv', toCsv(UNIVERSE_COLUMNS, universe.eligible.map(universeCsvRow)));
  plan.addText('sample.csv', toCsv(SAMPLE_COLUMNS, sampleRows));
  plan.addJson('sample.json', {
    schemaVersion: 1,
    seed: options.seed,
    seedSha256: sha256Hex(options.seed),
    seedStateHex: hex32(drawn.state),
    algorithm: SAMPLE_ALGORITHM,
    firstRawOutputsHex: drawn.firstRawHex,
    parameters: {
      calibration: options.calibration,
      official: options.official,
      reserve: options.reserve,
      repo,
      exclusions: exclusions.size,
    },
    counts: {
      chunks: chunks.length,
      universe: universe.rows.length,
      eligible: universe.eligible.length,
      byReason: reasonCounts,
      sampled: sampledCounts,
    },
    inputs: { chunksJsonlSha256: dumpSha256 },
    warnings: drawn.warnings,
  });
  plan.addText('README.txt', readmeText());
  const written = await writeOe2Package(outDir, plan, 'sample', { inputChunksSha256: dumpSha256 });
  return {
    exitCode: 0,
    lines: [
      `Universo: ${universe.rows.length} símbolos; elegibles: ${universe.eligible.length}.`,
      `Sorteados: calibración ${sampledCounts.calibracion}, oficiales ${sampledCounts.oficial}, reserva ${sampledCounts.reserva}.`,
      ...drawn.warnings.map((warning) => `Aviso: ${warning}`),
      `Archivos escritos: ${written.length}.`,
    ],
    outDir,
  };
}

function readmeText() {
  return [
    'Muestra OE2 (WI-CORE-107): universo, elegibilidad y sorteo de targets.',
    '',
    'universe.csv: todos los símbolos METHOD y FUNCTION del volcado con sus banderas y el motivo de no elegibilidad.',
    'eligible.csv: los elegibles, en el orden de (filePath, qualifiedName).',
    'sample.csv: los targets sorteados con su rol (calibracion, oficial, reserva), orden y cierre de profundidad 1.',
    'sample.json: parámetros, semilla, algoritmo, primeras salidas crudas del generador, recuentos y hash de entrada.',
    '',
    'Las columnas de sample.csv no contienen resultados de recuperación. El sorteo se hace antes de ejecutar retrieval.',
    '',
  ].join('\n');
}

