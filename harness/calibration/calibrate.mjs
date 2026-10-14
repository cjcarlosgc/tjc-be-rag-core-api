#!/usr/bin/env node
// CLI de calibracion offline (WI-CORE-063). Sin LLM, sin base de datos.
// Uso: node harness/calibration/calibrate.mjs --data <dir> [--candidate <json>] [--out <dir>] [--cases A,B] [--no-verify]
// --candidate: JSON con una config {semanticWeight, structuralWeight, topK, minimumScore, name?} o un array de ellas.
// Escribe report.json, report.md y m2-template.md en --out (por defecto --data). Nunca escribe en la base.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_CONFIG, REPO_ROOT, discoverCases, loadCase, loadDeps, loadTokenizer, baselineTopK, recompute, evaluate,
  m1Collaborators, m3Noise, m4Tokens, m5Stability, m6Static, aggregateM6Precision, METRIC_VERSION, round,
} from './lib.mjs';

function parseArgs(argv) {
  const args = { data: null, candidate: null, out: null, cases: null, verify: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--data') args.data = argv[++i];
    else if (a === '--candidate') args.candidate = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--cases') args.cases = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--no-verify') args.verify = false;
    else throw new Error(`argumento desconocido: ${a}`);
  }
  if (!args.data) throw new Error('falta --data <dir>');
  return args;
}

function normalizeCandidates(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((cfg, i) => {
    const merged = { ...DEFAULT_CONFIG, ...cfg };
    for (const k of ['semanticWeight', 'structuralWeight', 'minimumScore']) {
      if (typeof merged[k] !== 'number' || Number.isNaN(merged[k])) throw new Error(`candidato ${i}: ${k} invalido`);
    }
    if (!Number.isInteger(merged.topK) || merged.topK < 1) throw new Error(`candidato ${i}: topK invalido`);
    return { name: cfg.name ?? `candidato-${i + 1}`, config: merged };
  });
}

const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function chunkReason(c, id) {
  const k = c.cands.find((x) => x.chunkId === id);
  const x = c.byId.get(id);
  const sem = k && k.sem !== null && k.sem !== undefined;
  const st = !!(k && k.struct);
  const why = [sem ? 'semantic' : null, st ? `struct:${k.struct}` : null].filter(Boolean).join('+') || 'sin-candidato';
  return { path: x.filePath, symbol: [x.parentSymbolName, x.symbolName].filter(Boolean).map((s) => s.split('\\').pop()).join('::'), tokens: x.tokenCount ?? 0, why };
}

function pad(s, n) { s = String(s ?? ''); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

function printTable(rows) {
  const headers = Object.keys(rows[0]);
  const widths = headers.map((h) => Math.max(h.length, ...rows.map((r) => String(r[h] ?? '').length)));
  const line = (r) => headers.map((h, i) => pad(r[h], widths[i])).join(' | ');
  console.log(line(Object.fromEntries(headers.map((h) => [h, h]))));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  for (const r of rows) console.log(line(r));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolve(args.data);
  const outDir = resolve(args.out ?? dataDir);
  mkdirSync(outDir, { recursive: true });
  const tok = await loadTokenizer(REPO_ROOT);
  const depsList = loadDeps(dataDir);
  const cands = args.candidate ? normalizeCandidates(JSON.parse(readFileSync(resolve(args.candidate), 'utf8'))) : [];
  const ids = args.cases ?? discoverCases(dataDir);
  if (ids.length === 0) throw new Error(`sin casos (*.meta.json) en ${dataDir}`);

  const verification = [];
  const report = { version: METRIC_VERSION, tokenizer: tok.name, defaultConfig: DEFAULT_CONFIG, cases: {}, verification };
  const summaryRows = [];
  const m2Lines = ['# Plantilla M2 (relevancia R1–R5, manual)', '',
    'Rubrica: R1–R5 de la guia de la tesis (fase3-calibracion-rag-diagnostico.md). Esta plantilla NO puntua nada: el revisor rellena las columnas.',
    'Columnas: R1..R5 (1 = cumple, 0 = no cumple, vacio = pendiente) y Nota. Por caso: seleccion de la linea base (persistida) y chunks solo de candidatos.', ''];

  for (const id of ids) {
    const c = loadCase(dataDir, id, depsList);
    const base = baselineTopK(c);
    const rec = recompute(c, DEFAULT_CONFIG);
    const reproduces = eq(rec.selected, base) && base.length === DEFAULT_CONFIG.topK;
    verification.push({ case: id, selectedPersisted: base.length, recomputedTop10MatchesSelected: reproduces });
    if (!reproduces) console.error(`VERIFICACION FALLIDA: ${id} la linea base no reproduce el SELECTED persistido`);

    const baseline = {
      selected: base,
      m1: m1Collaborators(c, base),
      m3: m3Noise(c, base),
      m4: m4Tokens(c, base, tok, base),
      m5: m5Stability(base, base),
      m6: m6Static(c),
    };
    const candidates = {};
    for (const cand of cands) {
      const ev = evaluate(c, cand.config, tok, base);
      candidates[cand.name] = {
        ...ev,
        acceptance: {
          lostCollaborators: baseline.m1.inTop.filter((f) => !ev.m1.inTop.includes(f)),
          noLostCollaborator: baseline.m1.inTop.every((f) => ev.m1.inTop.includes(f)),
          tokensWithin15Pct: ev.m4.deltaVsBaselinePct === null ? null : ev.m4.deltaVsBaselinePct <= 15,
          m5Stable: ev.m5.sameSet,
        },
      };
    }
    report.cases[id] = { target: `${c.anchorClass}::${c.meta.methodName}`, baseline, candidates };
    summaryRows.push({
      caso: id,
      target: `${c.anchorClass.split('\\').pop()}::${c.meta.methodName}`,
      'M1 top10': `${baseline.m1.inTop.length}/${baseline.m1.total}`,
      'M1 faltan': baseline.m1.missingAnywhere.map((f) => f.split('\\').pop()).join(',') || '-',
      'M1 seccion': baseline.m1.inSection ? `${baseline.m1.inSection.length}/${baseline.m1.total}` : 'n/a',
      'M3 test%': baseline.m3.testNoisePct,
      'M3 miem%': baseline.m3.memberNoisePct,
      'M4 tok sel': baseline.m4.selectedTokensPersisted,
      'M4 sec': baseline.m4.sectionTokens ?? 'n/a',
      'M4 firma extra': baseline.m4.signatureExtraTokens ?? 'n/a',
      'M5 base': baseline.m5.overlapLabel,
      'M6 FINAL/SAME/NS/ANON/THIS/SIG': baseline.m6 ? baseline.m6.rules.map((r) => r.count).join('/') : 'n/a',
      ...(cands.length ? Object.fromEntries(Object.entries(candidates).map(([n, v]) => [`M5 ${n}`, v.m5.overlapLabel])) : {}),
    });

    m2Lines.push(`## ${id} — ${report.cases[id].target}`, '', '| # | ruta | simbolo | tokens | por que entra | R1 | R2 | R3 | R4 | R5 | Nota |',
      '|---|---|---|---|---|---|---|---|---|---|---|', ...base.map((cid, i) => {
        const r = chunkReason(c, cid);
        return `| ${i + 1} | ${r.path} | ${r.symbol} | ${r.tokens} | ${r.why} |  |  |  |  |  |  |`;
      }));
    for (const cand of cands) {
      const extra = candidates[cand.name].selected.filter((cid) => !base.includes(cid));
      if (extra.length) {
        m2Lines.push('', `Solo en ${cand.name}:`, '', '| ruta | simbolo | tokens | por que entra | R1 | R2 | R3 | R4 | R5 | Nota |',
          '|---|---|---|---|---|---|---|---|---|---|', ...extra.map((cid) => {
            const r = chunkReason(c, cid);
            return `| ${r.path} | ${r.symbol} | ${r.tokens} | ${r.why} |  |  |  |  |  |  |`;
          }));
      }
    }
    m2Lines.push('');
    console.log(`${id}: ${verification.at(-1).recomputedTop10MatchesSelected ? 'OK' : 'FALLA'} linea base`);
  }

  console.log('');
  printTable(summaryRows);
  console.log(`\nTokenizador: ${tok.name}. M6 es por caso (testContent de los trials), no depende de la configuracion.`);

  const m6Agg = aggregateM6Precision(Object.values(report.cases).map((x) => x.baseline.m6));
  report.m6Precision = m6Agg;
  const f = (v) => (v === 'n/a' || v === null || v === undefined ? 'n/a' : String(v));
  const precisionLines = m6Agg ? ['## Precision observada (M6)', '',
    'Por regla, sobre los trials analizados (testContent presente) de todos los casos. "Trials con hit" cuenta trials, no hits de linea. '
    + 'Precision = con hit y fallido con evidencia / trials con hit. Sensibilidad = fallidos con evidencia en los que la regla dio hit / fallidos con evidencia. '
    + 'Evidencia en errorSummary: R-FINAL "ClassIsFinal" o "final"+"mock"; R-SAME "same object" o "reference the same"; R-NS "not found", "Class ... does not exist" o "UnknownType"; R-ANON-FINAL "cannot extend final", "final class" o "cannot implement ... it is not an interface"; R-NEW-ENUM "Cannot instantiate enum"; R-STATIC-THIS "Using $this when not in object context"; R-SIG "ArgumentCountError", "Too few arguments" o "Unknown named parameter". '
    + 'Los trials con hit y valid=true son posibles falsos positivos. Muestra pequena: no es una estimacion estable.', '',
    '| regla | trials con hit | hit y valid=true (posibles FP) | hit y fallido | fallidos con evidencia | hit y fallido con evidencia | precision | sensibilidad |',
    '|---|---|---|---|---|---|---|---|',
    ...['R-FINAL', 'R-SAME', 'R-NS', 'R-ANON-FINAL', 'R-STATIC-THIS', 'R-SIG', 'R-NEW-ENUM'].map((r) => { const p = m6Agg[r]; return `| ${r} | ${p.hitTrials} | ${p.hitValid} | ${p.hitFailed} | ${p.failedWithEvidence} | ${p.hitFailedWithEvidence} | ${f(p.precision)} | ${f(p.sensitivity)} |`; }), ''] : [];
  const md = ['# Calibracion offline (WI-CORE-063)', '', `Version de metricas: ${METRIC_VERSION} · tokenizador: ${tok.name}`, '',
    '## Verificacion de linea base', '', '| caso | SELECTED persistido | recalculado top-10 = SELECTED |', '|---|---|---|',
    ...verification.map((v) => `| ${v.case} | ${v.selectedPersisted} | ${v.recomputedTop10MatchesSelected ? 'si' : 'NO'} |`), '',
    '## Resumen linea base', '', '| ' + Object.keys(summaryRows[0]).join(' | ') + ' |',
    '|' + Object.keys(summaryRows[0]).map(() => '---').join('|') + '|',
    ...summaryRows.map((r) => '| ' + Object.values(r).join(' | ') + ' |'), '',
    'Leyenda: M1 top10 = colaboradores con chunk de tipo en el top-10 / total; M1 faltan = sin top-10 ni seccion; M3 test% y miem% = % de tokens seleccionados (ruido de pruebas y de miembros ajenos); M4 = tokens persistidos; M4 firma extra = tokens que anaden las firmas del constructor (WI-CORE-065); M5 = solape con la base (n/K).', '', ...precisionLines];
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'report.md'), md.join('\n'));
  writeFileSync(join(outDir, 'm2-template.md'), m2Lines.join('\n'));
  console.log(`\nEscrito en ${outDir}: report.json, report.md, m2-template.md`);

  const failed = verification.some((v) => !v.recomputedTop10MatchesSelected);
  if (failed && args.verify) {
    console.error('Verificacion de linea base FALLIDA (usa --no-verify solo para diagnostico).');
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(`error: ${err.message}`); process.exitCode = 2; });
