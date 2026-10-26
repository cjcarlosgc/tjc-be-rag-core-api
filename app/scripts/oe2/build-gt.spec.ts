// WI-CORE-108: pruebas de `build-gt` con llaves, plantillas, hojas y samples escritos a mano (fixtures sintéticos).
// Cubren la forma exacta de gt.json, la validación estricta (sin descartar nada en silencio y con la lista completa de
// ids), la normalización de decisiones y criterios, targets sin relevantes, orden y bytes deterministas, hashes y
// salidas, y (ciclo 2, M-1) la comprobación de hojas: llave de otra ejecución, candidatos extra o faltantes, bloques
// de código con `###`, CRLF y filas en blanco al final de la plantilla.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsageError } from '../evidence-extractor/options.mjs';
import { toCsv, stableStringify } from '../evidence-extractor/util.mjs';
import { Oe2DataError } from './io-primitives.mjs';
import { TEMPLATE_COLUMNS, renderSheet } from './pool.mjs';
import { CRITERIA, buildGroundTruth, normalizeDecision, parseCriteria, parseKey, runBuildGt, stripTrailingBlankRows } from './build-gt.mjs';
import { parseSheet } from './sheets.mjs';
import { REPO_ROOT } from './wi108-fixtures.mjs';

let scratch: string;
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

const A = 'src/A.php::App\\A.run';
const B = 'src/B.php::App\\B.run';
const C = 'src/C.php::App\\C.run';
const SAMPLE_COLUMNS = ['role', 'order', 'repo', 'filePath', 'qualifiedName', 'kind', 'closureSize', 'closureTypes'];

function sampleOf(rows: Array<[string, number, string, string]>) {
  return toCsv(SAMPLE_COLUMNS, rows.map(([role, order, filePath, qualifiedName]) => ({
    role, order, repo: 'money', filePath, qualifiedName, kind: 'METHOD', closureSize: 0, closureTypes: '',
  })));
}

const SAMPLE = sampleOf([
  ['oficial', 1, 'src/A.php', 'App\\A.run'],
  ['oficial', 2, 'src/B.php', 'App\\B.run'],
  ['calibracion', 3, 'src/C.php', 'App\\C.run'],
]);

type Cand = [string, string]; // [filePath, qualifiedName]

/** Llave mínima con ids `<targetId>-NN` (mismo formato que `pool`) y hoja `T0k.md` por target (orden k). */
function keyOf(targets: Record<string, Cand[]>) {
  const built: Record<string, unknown> = {};
  Object.entries(targets).forEach(([targetId, candidates], index) => {
    const map: Record<string, unknown> = {};
    candidates.forEach(([filePath, qualifiedName], position) => {
      map[`${targetId}-${String(position + 1).padStart(2, '0')}`] = { filePath, qualifiedName, kind: 'METHOD', inClosure: false, SE: null, SEM: null };
    });
    built[targetId] = { sheet: `ciego/hojas/T0${index + 1}.md`, order: index + 1, candidates: map };
  });
  return JSON.stringify({ schemaVersion: 1, seedSha256: 'x', targets: built });
}

const TARGETS: Record<string, Cand[]> = {
  [A]: [['src/X.php', 'App\\X.one'], ['src/Y.php', 'App\\Y.two'], ['src/Z.php', 'App\\Z.three']],
  [B]: [['src/X.php', 'App\\X.one'], ['src/Q.php', 'App\\Q.four']],
  [C]: [['src/R.php', 'App\\R.five']],
};
const KEY = keyOf(TARGETS);

/** Código de prueba para una hoja: incluye `###`, una línea «- Archivo:» falsa y cercas de tres comillas. */
const TRICKY_CODE = 'function f() {\n    return 1;\n}\n### App\\Falso.id\n- Archivo: src/evil.php\n```\n';

/** Hoja de un target con `renderSheet` (el formato real de `pool`). `omit`/`extra` para simular hojas incoherentes. */
function sheetFor(targetId: string, index: number, candidates: Array<{ id: string; filePath: string; qualifiedName: string; code?: string }>) {
  const [filePath, qualifiedName] = targetId.split('::');
  return renderSheet({
    index,
    targetId,
    target: { filePath, qualifiedName, kind: 'METHOD', code: 'function t() {}\n' },
    candidates: candidates.map((item) => ({
      candidateId: item.id, filePath: item.filePath, qualifiedName: item.qualifiedName, kind: 'METHOD', code: item.code ?? 'function c() {}\n',
    })),
    maxChars: 6000,
    guideSha256: 'a'.repeat(64),
  });
}

/** Hojas coherentes con una llave (una por target, en el orden de la llave). */
function sheetsFrom(keyText: string, { overrideText }: { overrideText?: Record<string, string> } = {}) {
  const parsed = JSON.parse(keyText) as { targets: Record<string, { sheet: string; candidates: Record<string, { filePath: string; qualifiedName: string }> }> };
  return Object.entries(parsed.targets).map(([targetId, target]) => {
    const name = path.posix.basename(target.sheet);
    const candidates = Object.entries(target.candidates).map(([id, value]) => ({ id, filePath: value.filePath, qualifiedName: value.qualifiedName, code: TRICKY_CODE }));
    const text = overrideText?.[targetId] ?? sheetFor(targetId, Number(name.slice(1, 3)), candidates);
    return { name, text };
  });
}

const SHEETS = sheetsFrom(KEY);

type Row = { candidate_id: string; target_id: string; adjudicacion: string; adjudicacion_criterio: string };

function row(candidateId: string, targetId: string, adjudicacion: string, criterio = ''): Row {
  return { candidate_id: candidateId, target_id: targetId, adjudicacion, adjudicacion_criterio: criterio };
}

function templateOf(rows: Row[]) {
  return toCsv(TEMPLATE_COLUMNS, rows.map((item) => ({
    ...item, anotador_A_decision: '', anotador_A_criterio: '', anotador_B_decision: '', anotador_B_criterio: '',
  })));
}

/** Plantilla válida para A y B; C (calibración) queda sin adjudicar a propósito. */
function validRows(): Row[] {
  return [
    row(`${A}-01`, A, 'relevante', 'R1'),
    row(`${A}-02`, A, 'no relevante'),
    row(`${A}-03`, A, 'relevante', 'R2; R4'),
    row(`${B}-01`, B, 'no relevante'),
    row(`${B}-02`, B, 'relevante', 'r3'),
    row(`${C}-01`, C, ''),
  ];
}

interface BuildOverrides { sample?: string; key?: string; sheets?: Array<{ name: string; text: string }> | undefined; roles?: string[]; templateText?: string }

function build(rows: Row[], overrides: BuildOverrides = {}) {
  return buildGroundTruth({
    templateText: overrides.templateText ?? templateOf(rows),
    keyText: overrides.key ?? KEY,
    sampleText: overrides.sample ?? SAMPLE,
    sheets: 'sheets' in overrides ? overrides.sheets as never : SHEETS,
    roles: overrides.roles ?? ['oficial'],
  });
}

function expectError(fn: () => unknown, fragments: string[]) {
  let message = '';
  try {
    fn();
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message, 'debe lanzar').not.toBe('');
  for (const fragment of fragments) expect(message).toContain(fragment);
  return message;
}

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'oe2-buildgt-'));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('build-gt: forma de gt.json', () => {
  it('construye la GT con la forma que lee score: solo relevantes, claves y elementos ordenados, 2 espacios y salto final', () => {
    const built = build(validRows());
    expect(built.gt).toEqual({
      [A]: [
        { filePath: 'src/X.php', symbolQualifiedName: 'App\\X.one' },
        { filePath: 'src/Z.php', symbolQualifiedName: 'App\\Z.three' },
      ],
      [B]: [{ filePath: 'src/Q.php', symbolQualifiedName: 'App\\Q.four' }],
    });
    expect(built.gtText).toBe(`${JSON.stringify(built.gt, null, 2)}\n`);
    expect(built.gtText).toBe(stableStringify(built.gt));
  });

  it('un target sin relevantes queda con lista vacía y se resume con sus candidatos y no relevantes', () => {
    const rows = validRows().map((item) => (item.target_id === B ? { ...item, adjudicacion: 'no relevante', adjudicacion_criterio: '' } : item));
    const built = build(rows);
    expect(built.gt[B]).toEqual([]);
    expect(built.summaryRows.find((item) => item.targetId === B)).toEqual({ targetId: B, role: 'oficial', candidatos: 2, relevantes: 0, noRelevantes: 2 });
    expect(built.summaryRows.find((item) => item.targetId === A)).toEqual({ targetId: A, role: 'oficial', candidatos: 3, relevantes: 2, noRelevantes: 1 });
  });

  it('bytes deterministas: mismas entradas o plantilla en otro orden producen el mismo gt.json', () => {
    const first = build(validRows());
    expect(build(validRows()).gtText).toBe(first.gtText);
    expect(build([...validRows()].reverse()).gtText).toBe(first.gtText);
  });

  it('acepta un BOM al inicio de la plantilla (CSV guardado desde una hoja de cálculo)', () => {
    const built = build(validRows(), { templateText: `﻿${templateOf(validRows())}` });
    expect(built.counts.relevant).toBe(3);
  });

  it('solo los targets seleccionados van a la GT; las filas de los demás se cuentan y no se exigen', () => {
    const built = build(validRows());
    expect(Object.keys(built.gt)).toEqual([A, B].sort());
    expect(built.counts.templateRowsIgnored).toBe(1);
    // Con «calibracion» seleccionada, la fila de C debe estar adjudicada (una vacía sería un problema).
    const withC = [...validRows().filter((item) => item.target_id !== C), row(`${C}-01`, C, 'relevante', 'R5')];
    const both = build(withC, { roles: ['oficial', 'calibracion'] }).gt;
    expect(Object.keys(both)).toEqual([A, B, C].sort());
    expect(both[C]).toEqual([{ filePath: 'src/R.php', symbolQualifiedName: 'App\\R.five' }]);
    expectError(() => build(validRows(), { roles: ['oficial', 'calibracion'] }), [`${C}-01`, 'vacía']);
  });
});

describe('build-gt: normalización de decisiones y criterios', () => {
  it('normaliza espacios internos, recortes y mayúsculas en la decisión', () => {
    expect(normalizeDecision('  NO    Relevante ')).toBe('no relevante');
    expect(normalizeDecision('RELEVANTE')).toBe('relevante');
    const rows = validRows().map((item) => {
      if (item.candidate_id === `${A}-02`) return { ...item, adjudicacion: '  NO    Relevante ' };
      if (item.candidate_id === `${A}-03`) return { ...item, adjudicacion: ' RELEVANTE ' };
      return item;
    });
    expect(build(rows).gt[A]).toHaveLength(2);
  });

  it('acepta criterios separados por ; o , con espacios libres y en minúsculas; rechaza vacío, fuera de R1…R5 y tokens vacíos', () => {
    expect(parseCriteria('R1; r3 ,R5')).toEqual({ criteria: ['R1', 'R3', 'R5'] });
    expect(parseCriteria('')).toEqual({ error: 'vacío' });
    expect(parseCriteria('R6')).toEqual({ error: 'fuera de R1…R5' });
    expect(parseCriteria('R1;')).toEqual({ error: 'fuera de R1…R5' });
    expect(CRITERIA).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
  });

  it('un relevante sin criterio aborta; un no relevante puede no tenerlo', () => {
    const missing = validRows().map((item) => (item.candidate_id === `${A}-01` ? { ...item, adjudicacion_criterio: '' } : item));
    expectError(() => build(missing), [`${A}-01`, 'adjudicacion_criterio vacío']);
    expect(() => build(validRows())).not.toThrow();
  });
});

describe('build-gt: validación estricta (todo problema se acumula, nada se descarta)', () => {
  it('candidate_id duplicado: aborta e indica el id', () => {
    expectError(() => build([...validRows(), row(`${A}-01`, A, 'no relevante')]), [`${A}-01`, 'duplicado']);
  });

  it('candidate_id desconocido en la llave: aborta e indica el id', () => {
    expectError(() => build([...validRows(), row(`${A}-99`, A, 'no relevante')]), [`${A}-99`, 'no existe en la llave']);
  });

  it('target_id que no coincide con la llave: aborta e indica el id y el target declarado', () => {
    const rows = validRows().map((item) => (item.candidate_id === `${B}-01` ? { ...item, target_id: A } : item));
    expectError(() => build(rows), [`${B}-01`, 'no coincide', B]);
  });

  it('candidato de un target seleccionado sin fila adjudicada: aborta con la lista de ids', () => {
    const rows = validRows().filter((item) => item.candidate_id !== `${A}-03` && item.candidate_id !== `${B}-02`);
    expectError(() => build(rows), [`${A}-03`, `${B}-02`, 'sin fila adjudicada']);
  });

  it('valores de decisión inválidos o vacíos: aborta listando todos los ids, no solo el primero', () => {
    const rows = validRows().map((item) => {
      if (item.candidate_id === `${A}-01`) return { ...item, adjudicacion: 'quizás' };
      if (item.candidate_id === `${A}-02`) return { ...item, adjudicacion: '' };
      if (item.candidate_id === `${B}-01`) return { ...item, adjudicacion: 'relevant' };
      return item;
    });
    const message = expectError(() => build(rows), [`${A}-01`, `${A}-02`, `${B}-01`, 'adjudicacion no válida']);
    expect(message).toContain('3 problema(s)');
  });

  it('criterios inválidos en relevantes y en no relevantes (si se rellenan): aborta con todos los ids', () => {
    const rows = validRows().map((item) => {
      if (item.candidate_id === `${A}-03`) return { ...item, adjudicacion_criterio: 'R6' };
      if (item.candidate_id === `${B}-02`) return { ...item, adjudicacion_criterio: '' };
      if (item.candidate_id === `${A}-02`) return { ...item, adjudicacion_criterio: 'R9' };
      return item;
    });
    expectError(() => build(rows), [`${A}-03`, `${B}-02`, `${A}-02`]);
  });

  it('target seleccionado sin filas en la plantilla: aborta', () => {
    const rows = validRows().filter((item) => item.target_id !== B);
    expectError(() => build(rows), [`target ${B}: sin filas en la plantilla`]);
  });

  it('target seleccionado ausente de la llave: aborta', () => {
    const sample = sampleOf([
      ['oficial', 1, 'src/A.php', 'App\\A.run'],
      ['oficial', 2, 'src/D.php', 'App\\D.run'],
    ]);
    const rows = validRows().filter((item) => item.target_id === A);
    expectError(() => build(rows, { sample, sheets: sheetsFrom(KEY).filter((sheet) => sheet.name === 'T01.md') }), ['target src/D.php::App\\D.run: no está en la llave']);
  });

  it('una selección de roles sin filas en el sample es un uso incorrecto', () => {
    expect(() => build(validRows(), { roles: ['reserva'] })).toThrow(UsageError);
  });

  it('un error de validación no produce GT: sigue siendo Oe2DataError', () => {
    const rows = validRows().map((item) => (item.candidate_id === `${A}-01` ? { ...item, adjudicacion: 'x' } : item));
    expect(() => build(rows)).toThrow(Oe2DataError);
  });

  it('la llave debe tener la forma de pool (schemaVersion 1, targets)', () => {
    expect(() => parseKey('no json')).toThrow(/JSON/);
    expect(() => parseKey('{"targets": {}}')).toThrow(/forma/);
    expect(() => parseKey(JSON.stringify({ schemaVersion: 1, targets: { [A]: { candidates: { [`${A}-01`]: { filePath: 1 } } } } })))
      .toThrow(/filePath o qualifiedName/);
  });

  it('la plantilla debe tener las columnas de adjudicación', () => {
    const noColumns = toCsv(['candidate_id', 'target_id'], [{ candidate_id: `${A}-01`, target_id: A }]);
    expect(() => build([], { templateText: noColumns })).toThrow(/columna adjudicacion|columna adjudicacion_criterio/);
  });

  it('sin --sheets (sheets indefinido) es un uso incorrecto', () => {
    expect(() => build(validRows(), { sheets: undefined })).toThrow(UsageError);
  });
});

describe('build-gt: plantilla con filas en blanco al final (M-B4)', () => {
  it('ignora las filas totalmente en blanco del final, sea línea vacía o solo comas, y lo cuenta', () => {
    const text = `${templateOf(validRows())}\n,,,,,,,,\n\n\n`;
    const built = build(validRows(), { templateText: text });
    expect(built.counts.templateBlankRowsIgnored).toBeGreaterThan(0);
    expect(built.gtText).toBe(build(validRows()).gtText);
  });

  it('una fila parcialmente rellena al final sigue fallando, con el id', () => {
    // Fila 8 (cabecera + 6 filas): candidate_id relleno y target_id vacío, con las 8 columnas.
    expectError(() => build(validRows(), { templateText: `${templateOf(validRows())}${A}-02,,,,,,,\n` }), ['fila 8', 'target_id vacío']);
    // Una fila con menos columnas que la cabecera sigue siendo un error de CSV.
    expectError(() => build(validRows(), { templateText: `${templateOf(validRows())}${A}-02,${A}\n` }), ['columnas']);
  });

  it('stripTrailingBlankRows solo quita el final y conserva la cabecera', () => {
    expect(stripTrailingBlankRows('a,b\n1,2\n,,\n\n')).toEqual({ text: 'a,b\n1,2', removed: 1 });
    expect(stripTrailingBlankRows('a,b\n,\n1,2\n').removed).toBe(0);
    expect(stripTrailingBlankRows('a,b\n').removed).toBe(0);
  });
});

describe('build-gt: hojas de --sheets (M-1: la llave es de la misma ejecución que la plantilla)', () => {
  it('hoja y llave coherentes pasan, con bloques de código que contienen ###, cercas y «- Archivo:» falsos', () => {
    const built = build(validRows());
    expect(built.counts.sheetsVerified).toBe(3);
    expect(built.gt[A]).toHaveLength(2);
  });

  it('hojas con CRLF pasan igual', () => {
    const crlf = SHEETS.map((sheet) => ({ name: sheet.name, text: sheet.text.replace(/\n/g, '\r\n') }));
    expect(build(validRows(), { sheets: crlf }).gtText).toBe(build(validRows()).gtText);
  });

  it('una llave de otra semilla (mismos ids, otro orden) falla: la hoja muestra otro candidato para cada id', () => {
    // Misma llave de pool con los candidatos de A reordenados: los ids no cambian, la asignación sí.
    const reordered = keyOf({ ...TARGETS, [A]: [...TARGETS[A]].reverse() });
    const message = expectError(() => build(validRows(), { key: reordered }), [`${A}-01`, `${A}-03`, 'la hoja muestra', 'la llave']);
    expect(message).toContain('2 problema(s)');
  });

  it('un candidato extra en la hoja (no está en la llave) aborta con su id', () => {
    const candidates = [
      ...Object.entries(JSON.parse(KEY).targets[A].candidates).map(([id, value]) => ({ id, filePath: (value as Record<string, string>).filePath, qualifiedName: (value as Record<string, string>).qualifiedName })),
      { id: `${A}-04`, filePath: 'src/Extra.php', qualifiedName: 'App\\Extra.five' },
    ];
    const overrideText = { [A]: sheetFor(A, 1, candidates) };
    expectError(() => build(validRows(), { sheets: sheetsFrom(KEY, { overrideText }) }), [`${A}-04`, 'está en la hoja', 'no en la llave']);
  });

  it('un candidato faltante en la hoja aborta con su id', () => {
    const candidates = [
      { id: `${A}-01`, filePath: 'src/X.php', qualifiedName: 'App\\X.one' },
      { id: `${A}-03`, filePath: 'src/Z.php', qualifiedName: 'App\\Z.three' },
    ];
    const overrideText = { [A]: sheetFor(A, 1, candidates) };
    expectError(() => build(validRows(), { sheets: sheetsFrom(KEY, { overrideText }) }), [`${A}-02`, 'está en la llave pero no en la hoja']);
  });

  it('un target seleccionado sin hoja aborta', () => {
    expectError(() => build(validRows(), { sheets: SHEETS.filter((sheet) => sheet.name !== 'T02.md') }), [`target ${B}: sin hoja en --sheets`]);
  });

  it('una hoja de un target que no está en la llave aborta (hoja de otra ejecución)', () => {
    const foreign = sheetFor('src/Foreign.php::App\\Foreign.run', 9, [{ id: 'src/Foreign.php::App\\Foreign.run-01', filePath: 'src/F.php', qualifiedName: 'App\\F' }]);
    expectError(() => build(validRows(), { sheets: [...SHEETS, { name: 'T09.md', text: foreign }] }), ['no está en la llave', 'otra ejecución']);
  });

  it('una hoja sin línea «Target:» o con bloque de código sin cerrar aborta con el nombre de la hoja', () => {
    expectError(() => build(validRows(), { sheets: [{ name: 'T01.md', text: '# Hoja\n\nsin nada\n' }, ...SHEETS.slice(1)] }), ['hoja T01.md', 'Target']);
    expect(() => parseSheet('Target: x::y\n\n### x-01\n- Archivo: a.php\n- Símbolo: A\n\n```php\nabierto\n', 'hoja T01.md')).toThrow(/sin cerrar/);
  });

  it('parseSheet ignora ### y «- Archivo:» dentro de bloques de código, y acepta una cerca más larga que la del código', () => {
    const parsed = parseSheet(sheetFor(A, 1, [{ id: `${A}-01`, filePath: 'src/X.php', qualifiedName: 'App\\X.one', code: TRICKY_CODE }]), 'T01.md');
    expect(parsed.targetId).toBe(A);
    expect([...parsed.candidates.keys()]).toEqual([`${A}-01`]);
    expect(parsed.candidates.get(`${A}-01`)).toEqual({ filePath: 'src/X.php', qualifiedName: 'App\\X.one' });
    expect(parsed.targetFile).toBe('src/A.php');
    expect(parsed.targetSymbol).toBe('App\\A.run');
  });

  it('un candidate_id repetido en la hoja aborta', () => {
    const dup = sheetFor(A, 1, [
      { id: `${A}-01`, filePath: 'src/X.php', qualifiedName: 'App\\X.one' },
      { id: `${A}-01`, filePath: 'src/X.php', qualifiedName: 'App\\X.one' },
    ]);
    expect(() => parseSheet(dup, 'T01.md')).toThrow(/repetido/);
  });
});

describe('build-gt: salidas en disco (runBuildGt)', () => {
  async function writeInputs(name: string, rows: Row[], sheets = SHEETS) {
    const sheetsDir = path.join(scratch, `${name}-hojas`);
    await mkdir(sheetsDir, { recursive: true });
    for (const sheet of sheets) await writeFile(path.join(sheetsDir, sheet.name), sheet.text);
    await writeFile(path.join(scratch, `${name}-template.csv`), templateOf(rows));
    await writeFile(path.join(scratch, `${name}-key.json`), KEY);
    await writeFile(path.join(scratch, `${name}-sample.csv`), SAMPLE);
    return {
      dir: path.join(scratch, `${name}-out`),
      template: path.join(scratch, `${name}-template.csv`),
      key: path.join(scratch, `${name}-key.json`),
      sample: path.join(scratch, `${name}-sample.csv`),
      sheets: sheetsDir,
    };
  }

  const optionsOf = (inputs: Awaited<ReturnType<typeof writeInputs>>, out = inputs.dir) => ({
    template: inputs.template, key: inputs.key, sample: inputs.sample, sheets: inputs.sheets, roles: ['oficial'], out, allowOutInRepo: false,
  });

  it('escribe gt.json, gt.sha256, gt-summary.csv y manifest.json con entradas y SHA-256 de las hojas leídas', async () => {
    const inputs = await writeInputs('disk-ok', validRows());
    const result = await runBuildGt({ options: optionsOf(inputs), cwd: scratch, repoRoot: REPO_ROOT });
    expect(result.exitCode).toBe(0);
    const gtBytes = await readFile(path.join(inputs.dir, 'gt.json'));
    const gtSha = sha(gtBytes);
    expect((await readFile(path.join(inputs.dir, 'gt.sha256'), 'utf8')).startsWith(`${gtSha}  gt.json`)).toBe(true);
    expect(result.lines.join('\n')).toContain(gtSha);
    expect(result.lines.join('\n')).toContain('Hojas verificadas contra la llave: 3');
    const summary = await readFile(path.join(inputs.dir, 'gt-summary.csv'), 'utf8');
    expect(summary.split('\n')[0]).toBe('targetId,role,candidatos,relevantes,noRelevantes');
    const manifest = JSON.parse(await readFile(path.join(inputs.dir, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ subcommand: 'build-gt', gtSha256: gtSha, gtFile: 'gt.json', rolesSelected: ['oficial'], sheetsVerified: 3 });
    expect(manifest.sheets).toEqual(SHEETS.map((sheet) => ({ file: sheet.name, sha256: sha(sheet.text), bytes: Buffer.byteLength(sheet.text) })));
    expect(manifest.inputs.template.sha256).toBe(sha(await readFile(inputs.template)));
    expect(manifest.inputs.key.sha256).toBe(sha(await readFile(inputs.key)));
    expect(manifest.inputs.sample.sha256).toBe(sha(await readFile(inputs.sample)));
    expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'gt.json', sha256: gtSha })]));
  });

  it('dos ejecuciones con las mismas entradas producen los mismos bytes de gt.json', async () => {
    const inputs = await writeInputs('disk-twice', validRows());
    const outA = path.join(scratch, 'disk-twice-a');
    const outB = path.join(scratch, 'disk-twice-b');
    for (const out of [outA, outB]) await runBuildGt({ options: optionsOf(inputs, out), cwd: scratch, repoRoot: REPO_ROOT });
    expect(await readFile(path.join(outA, 'gt.json'))).toEqual(await readFile(path.join(outB, 'gt.json')));
  });

  it('con errores no escribe nada en la carpeta de salida', async () => {
    const inputs = await writeInputs('disk-bad', [...validRows(), row(`${A}-99`, A, 'no relevante')]);
    await expect(runBuildGt({ options: optionsOf(inputs), cwd: scratch, repoRoot: REPO_ROOT })).rejects.toThrow(/run-99: no existe en la llave/);
    await expect(readdir(inputs.dir)).rejects.toThrow();
  });

  it('una carpeta de --sheets inexistente o sin hojas aborta', async () => {
    const inputs = await writeInputs('disk-nosheets', validRows());
    await expect(runBuildGt({ options: { ...optionsOf(inputs), sheets: path.join(scratch, 'no-existe') }, cwd: scratch, repoRoot: REPO_ROOT }))
      .rejects.toThrow(/--sheets/);
    const empty = path.join(scratch, 'disk-empty-sheets');
    await mkdir(empty, { recursive: true });
    await expect(runBuildGt({ options: { ...optionsOf(inputs), sheets: empty }, cwd: scratch, repoRoot: REPO_ROOT })).rejects.toThrow(/sin hojas|no tiene hojas/);
  });

  it('una salida dentro del repositorio sin --allow-out-in-repo es un uso incorrecto', async () => {
    const inputs = await writeInputs('disk-repo', validRows());
    const out = path.join(REPO_ROOT, 'tmp-build-gt-no-debe-existir');
    await expect(runBuildGt({ options: optionsOf(inputs, out), cwd: scratch, repoRoot: REPO_ROOT })).rejects.toBeInstanceOf(UsageError);
  });
});
