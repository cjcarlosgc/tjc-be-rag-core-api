import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, afterAll } from 'vitest';
import { ContextBuilder } from './context-builder.service.js';
import { PhpDependencyContextService } from './php-dependency-context.service.js';
import { countPhpDependencyTokens, renderPhpDependencySection } from './php-dependency-context.js';
import type { GenerationContextDependencyContext, StructuralMatch } from './generation-context.js';
import type { RetrievalResult } from './retrieval.service.js';
import type { CodeChunk } from '../generated/prisma/client.js';

/**
 * Replay offline de WI-CORE-057 (corte C). Lee datos reales persistidos fuera del repo desde
 * `PHP_DEP_REPLAY_DIR` y compara la generación de contexto con y sin la sección de dependencias PHP.
 * Se omite cuando la variable no está definida (CI y repositorio normal).
 */

const REPLAY_DIR = process.env.PHP_DEP_REPLAY_DIR;
const OUT_FILE = process.env.PHP_DEP_REPLAY_OUT;
const TYPE_KINDS = new Set(['CLASS', 'INTERFACE', 'TRAIT', 'ENUM']);
const ANCHOR_KINDS = new Set(['METHOD', 'FUNCTION']);

interface ReplayMeta {
  id: string;
  pv: string;
  filePath: string;
  symbolName: string;
  methodName: string;
}

interface ReplayChunk {
  id: string;
  filePath: string;
  symbolKind: string;
  symbolName: string;
  parentSymbolName: string | null;
  importsUsed: string[];
  content: string;
  tokenCount: number | null;
}

interface ReplayCandidate {
  chunkId: string;
  sem: number | null;
  struct: string | null;
  combined: number;
  decision: 'SELECTED' | 'DISCARDED';
  rank: number;
}

interface ReplayCase {
  name: string;
  id: string;
  meta: ReplayMeta;
  chunks: ReplayChunk[];
  candidates: ReplayCandidate[];
}

interface CaseRow {
  caso: string;
  target: string;
  entries: Array<{ typeName: string; fqcn: string; origin: string; resolvedBy: string; final: boolean }>;
  /** WI-CORE-066: firmas de profundidad 2 (`Tipo vía Directa`) y tokens que añaden sobre las directas. */
  depth2Signatures: string[];
  depth2ExtraTokens: number;
  finalCount: number;
  finalEntries: string[];
  unresolvedCount: number;
  sectionTokens: number;
  sectionTokensSinMarcas: number;
  finalExtraTokens: number;
  /** WI-CORE-065: sección con firmas (sectionTokens) y la misma sección sin firmas (repositorio sin constructores). */
  sectionTokensSinFirmas: number;
  signatureExtraTokens: number;
  signatures: Array<{ fqcn: string; signature: string }>;
  truncated: boolean;
  baselineContextTokens: number;
  extraPercent: number;
}

const rows: CaseRow[] = [];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function loadCases(dir: string): ReplayCase[] {
  const lines = readFileSync(join(dir, 'cases.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.map((line) => {
    const [name, id] = line.split(/\s+/);
    const meta = readJson<ReplayMeta>(join(dir, `${name}.meta.json`));
    if (meta.id !== id) throw new Error(`cases.txt (${id}) no coincide con meta.id (${meta.id}) en ${name}`);
    return {
      name,
      id,
      meta,
      chunks: readJson<ReplayChunk[]>(join(dir, `${name}.chunks.json`)),
      candidates: readJson<ReplayCandidate[]>(join(dir, `${name}.cands.json`)),
    };
  });
}

function buildAnchor(replay: ReplayCase): ReplayChunk {
  const anchor = replay.chunks.find(
    (chunk) =>
      chunk.filePath === replay.meta.filePath &&
      ANCHOR_KINDS.has(chunk.symbolKind) &&
      chunk.symbolName === replay.meta.methodName &&
      chunk.parentSymbolName === replay.meta.symbolName,
  );
  if (!anchor) throw new Error(`${replay.name}: ancla no encontrada`);
  return anchor;
}

function buildRetrievalResult(replay: ReplayCase, anchor: ReplayChunk): RetrievalResult {
  const byId = new Map(replay.chunks.map((chunk) => [chunk.id, chunk]));
  const toCodeChunk = (chunk: ReplayChunk): CodeChunk => chunk as unknown as CodeChunk;
  return {
    targetChunks: [toCodeChunk(anchor)],
    candidates: replay.candidates.map((candidate) => {
      const chunk = byId.get(candidate.chunkId);
      if (!chunk) throw new Error(`${replay.name}: chunk ${candidate.chunkId} ausente en chunks.json`);
      return {
        chunk: toCodeChunk(chunk),
        semanticScore: candidate.sem,
        structuralMatch: candidate.struct as StructuralMatch | null,
      };
    }),
  };
}

/**
 * Repositorio falso: sirve los chunks del caso al servicio real de dependencias. Con `withDeclarations`
 * false, `findPhpTypeDeclarations` devuelve vacío (línea base sin marcas final).
 */
function fakeRepository(replay: ReplayCase, withDeclarations = true, withConstructors = true) {
  const typeNames = replay.chunks
    .filter((chunk) => chunk.filePath.endsWith('.php') && TYPE_KINDS.has(chunk.symbolKind))
    .map((chunk) => chunk.symbolName);
  return {
    findByFile: async (_pv: string, filePath: string) => replay.chunks.filter((chunk) => chunk.filePath === filePath),
    findPhpTypeSymbolNames: async () => typeNames,
    // Misma semántica que el repositorio real: CONSTRUCTOR de .php con parent pedido; una sola declaración por padre
    // (partIndex 1 o único; si hay varias, constructores en archivos distintos, el padre se omite).
    findPhpConstructorDeclarations: async (_pv: string, parentSymbolNames: string[]) => {
      if (!withConstructors || parentSymbolNames.length === 0) return [];
      const wanted = new Set(parentSymbolNames);
      const byParent = new Map<string, Array<{ parentSymbolName: string; content: string; importsUsed: string[] }>>();
      for (const chunk of replay.chunks) {
        if (chunk.symbolKind !== 'CONSTRUCTOR' || !chunk.filePath.endsWith('.php')) continue;
        if (chunk.parentSymbolName === null || !wanted.has(chunk.parentSymbolName)) continue;
        const list = byParent.get(chunk.parentSymbolName) ?? [];
        list.push({ parentSymbolName: chunk.parentSymbolName, content: chunk.content, importsUsed: chunk.importsUsed });
        byParent.set(chunk.parentSymbolName, list);
      }
      return [...byParent.values()].filter((list) => list.length === 1).map((list) => list[0]);
    },
    // Misma semántica que el repositorio real: una fila por symbolName, preferir CLASS/ENUM.
    findPhpTypeDeclarations: async (_pv: string, symbolNames: string[]) => {
      if (!withDeclarations || symbolNames.length === 0) return [];
      const wanted = new Set(symbolNames);
      const rank = (kind: string): number => (kind === 'CLASS' || kind === 'ENUM' ? 0 : 1);
      const rows = replay.chunks
        .filter(
          (chunk) =>
            chunk.filePath.endsWith('.php') && TYPE_KINDS.has(chunk.symbolKind) && wanted.has(chunk.symbolName),
        )
        .sort((a, b) => rank(a.symbolKind) - rank(b.symbolKind));
      const bySymbol = new Map<string, { symbolName: string; symbolKind: string; content: string }>();
      for (const row of rows) {
        if (!bySymbol.has(row.symbolName)) {
          bySymbol.set(row.symbolName, { symbolName: row.symbolName, symbolKind: row.symbolKind, content: row.content });
        }
      }
      return [...bySymbol.values()];
    },
  } as never;
}

async function resolveDependencies(
  replay: ReplayCase,
  anchor: ReplayChunk,
  withDeclarations = true,
  withConstructors = true,
): Promise<GenerationContextDependencyContext | undefined> {
  const service = new PhpDependencyContextService(fakeRepository(replay, withDeclarations, withConstructors));
  const resolved = await service.resolve(replay.meta.pv, [anchor as never], 'php');
  if (resolved === null) return undefined;
  return {
    entries: resolved.entries,
    unresolvedCount: resolved.unresolvedCount,
    tokenCount: resolved.tokenCount,
    truncated: resolved.truncated,
    text: resolved.text,
    transitiveEntries: resolved.transitiveEntries,
  };
}

function buildContext(
  replay: ReplayCase,
  result: RetrievalResult,
  anchor: ReplayChunk,
  dependencyContext: GenerationContextDependencyContext | undefined,
) {
  // ConfigService falso: devuelve siempre el valor por defecto, como en la producción replicada.
  const builder = new ContextBuilder({ get: (_key: string, fallback: unknown) => fallback } as never);
  return builder.build(
    result,
    {
      filePath: anchor.filePath,
      symbolName: replay.meta.symbolName,
      methodName: replay.meta.methodName,
      targetType: 'METHOD',
    },
    { framework: 'PHPUNIT', language: 'php' },
    {},
    [],
    dependencyContext,
  );
}

const replayCases = REPLAY_DIR ? loadCases(REPLAY_DIR) : [];

/** Tokens que aporta la profundidad 2: sección completa menos la sección solo con directas. */
function depth2ExtraTokensOf(context: GenerationContextDependencyContext | undefined): number {
  if (!context || (context.transitiveEntries ?? []).length === 0) return 0;
  const directsOnly = countPhpDependencyTokens(renderPhpDependencySection(context.entries as never));
  return context.tokenCount - directsOnly;
}

describe.skipIf(!REPLAY_DIR)('WI-CORE-057 replay de dependencias PHP (datos fuera del repo)', () => {
  afterAll(() => {
    if (rows.length === 0) return;
    const lines = rows.map(
      (row) =>
        `${row.caso} | ${row.target} | entradas=${row.entries.length} | final=${row.finalCount} | sinResolver=${row.unresolvedCount} | ` +
        `tokensSeccion=${row.sectionTokens} | sinFirmas=${row.sectionTokensSinFirmas} | firmaExtra=${row.signatureExtraTokens} | ` +
        `tokensSinMarcas=${row.sectionTokensSinMarcas} | finalExtra=${row.finalExtraTokens} | depth2=${row.depth2Signatures.length} | ` +
        `depth2ExtraTokens=${row.depth2ExtraTokens} | truncated=${row.truncated} | ` +
        `contextTokensBase=${row.baselineContextTokens} | extra=${row.extraPercent.toFixed(2)}%` +
        row.entries
          .map((e) => `\n    - ${e.typeName} → ${e.fqcn} [${e.origin}, ${e.resolvedBy}]${e.final ? ' FINAL' : ''}`)
          .join(''),
    );
    console.info(`\nReplay WI-CORE-057 (${rows.length} casos)\n${lines.join('\n')}`);
    if (OUT_FILE) writeFileSync(OUT_FILE, JSON.stringify(rows, null, 2));
  });

  it.each(replayCases.map((replay) => [replay.name, replay] as const))('caso %s', async (name, replay) => {
    const anchor = buildAnchor(replay);
    const result = buildRetrievalResult(replay, anchor);
    const dependencyContext = await resolveDependencies(replay, anchor);

    const baseline = buildContext(replay, result, anchor, undefined);
    const withSection = buildContext(replay, result, anchor, dependencyContext);

    // Invariancia: la sección no altera selección, ranking, presupuesto ni contadores.
    expect(withSection.relatedChunks).toEqual(baseline.relatedChunks);
    expect(withSection.audit?.candidates).toEqual(baseline.audit?.candidates);
    expect(withSection.contextTokens).toBe(baseline.contextTokens);
    expect(withSection.selectedChunks).toBe(baseline.selectedChunks);
    expect(withSection.retrievedChunks).toBe(baseline.retrievedChunks);

    // Reproduce la línea base real: SELECTED de la traza = decision SELECTED persistida.
    const selectedNow = (baseline.audit?.candidates ?? [])
      .filter((candidate) => candidate.decision === 'SELECTED')
      .map((candidate) => candidate.chunkId)
      .sort();
    const selectedReal = replay.candidates
      .filter((candidate) => candidate.decision === 'SELECTED')
      .map((candidate) => candidate.chunkId)
      .sort();
    expect(selectedNow).toEqual(selectedReal);

    const entries = dependencyContext?.entries ?? [];
    const baseCtx = baseline.contextTokens;
    const sectionTokens = dependencyContext?.tokenCount ?? 0;
    // Línea base sin marcas final: mismo servicio, sin declaraciones del índice.
    const sinMarcas = await resolveDependencies(replay, anchor, false);
    const sectionTokensSinMarcas = sinMarcas?.tokenCount ?? 0;
    // WI-CORE-065: línea base sin firmas: mismo servicio con un repositorio que no devuelve constructores.
    const sinFirmas = await resolveDependencies(replay, anchor, true, false);
    const sectionTokensSinFirmas = sinFirmas?.tokenCount ?? 0;
    // El tipo de contexto del producto no expone `signature`; se lee del objeto que devuelve el servicio real.
    const signatures = (dependencyContext?.entries ?? [])
      .map((e) => ({ fqcn: e.fqcn, signature: (e as { signature?: string }).signature }))
      .filter((e): e is { fqcn: string; signature: string } => e.signature !== undefined);
    const finalEntries = entries.filter((e) => e.final === true).map((e) => e.typeName);
    rows.push({
      caso: name,
      target: `${replay.meta.symbolName.split('\\').pop()}::${replay.meta.methodName}`,
      entries: entries.map((e) => ({
        typeName: e.typeName,
        fqcn: e.fqcn,
        origin: e.origin,
        resolvedBy: e.resolvedBy,
        final: e.final === true,
      })),
      depth2Signatures: (dependencyContext?.transitiveEntries ?? []).map((e) => `${e.typeName} vía ${e.via}: ${e.signature}`),
      depth2ExtraTokens: depth2ExtraTokensOf(dependencyContext),
      finalCount: finalEntries.length,
      finalEntries,
      unresolvedCount: dependencyContext?.unresolvedCount ?? 0,
      sectionTokens,
      sectionTokensSinMarcas,
      finalExtraTokens: sectionTokens - sectionTokensSinMarcas,
      sectionTokensSinFirmas,
      signatureExtraTokens: sectionTokens - sectionTokensSinFirmas,
      signatures,
      truncated: dependencyContext?.truncated ?? false,
      baselineContextTokens: baseCtx,
      extraPercent: baseCtx > 0 ? (sectionTokens / baseCtx) * 100 : 0,
    });

    // WI-CORE-058: tope de tokens y texto de marca con marcas activas.
    expect(sectionTokens).toBeLessThanOrEqual(500);
    expect(sectionTokens).toBeGreaterThanOrEqual(sectionTokensSinFirmas);
    // WI-CORE-066: la traza (entries) solo contiene directas; la profundidad 2 va aparte (transitiveEntries).
    expect(dependencyContext?.entries.every((e) => (e as { via?: string }).via === undefined) ?? true).toBe(true);
    if (finalEntries.length > 0) expect(dependencyContext?.text).toContain('final: no se puede mockear');

    // Helper: entrada presente por typeName; `final` según lo esperado.
    const expectMark = (typeName: string, isFinal: boolean) => {
      const entry = entries.find((e) => e.typeName === typeName);
      expect(entry, `${name}: ${typeName} ausente`).toBeDefined();
      expect(entry?.final === true, `${name}: marca final de ${typeName}`).toBe(isFinal);
    };

    // Afirmaciones específicas de los casos de la aprobación (Fase 2 #1).
    if (name === 'SUB-1' || name === 'SUB-2') {
      const services = entries.find((e) => e.typeName === 'RenewalDatePolicy');
      expect(services?.fqcn).toBe('Pilot\\Subscriptions\\Services\\RenewalDatePolicy');
      expect(services?.resolvedBy).toBe('SAME_NAMESPACE');
      expect(entries.find((e) => e.typeName === 'PaymentGateway')?.fqcn).toBe('Pilot\\Subscriptions\\Contracts\\PaymentGateway');
      expect(entries.find((e) => e.typeName === 'SubscriptionRepository')?.fqcn).toBe(
        'Pilot\\Subscriptions\\Contracts\\SubscriptionRepository',
      );
      expect(entries.some((e) => e.fqcn === 'Pilot\\Subscriptions\\Contracts\\RenewalDatePolicy')).toBe(false);
      expect(dependencyContext?.text).toContain('RenewalDatePolicy → Pilot\\Subscriptions\\Services\\RenewalDatePolicy');
      expectMark('RenewalDatePolicy', true);
      expectMark('Subscription', true);
      expectMark('PaymentGateway', false);
      expectMark('SubscriptionRepository', false);
    }

    if (name === 'SUB-3') {
      expectMark('SubscriptionStatus', true);
      expectMark('Plan', true);
    }

    if (name === 'SAL-1') {
      expectMark('Customer', true);
      expectMark('Promotion', true);
    }

    if (name === 'RES-1' || name === 'RES-2') {
      expectMark('Resource', true);
      expectMark('ReservationPeriod', true);
      expectMark('ReservationRepository', false);
    }

    if (name === 'SAL-2' || name === 'SAL-3' || name === 'RES-3') {
      // Sin colaboradores: vacía, o solo con FQCN que el resolutor verificó (SAME_NAMESPACE contra el índice).
      const knownTypes = new Set(replay.chunks.filter((c) => TYPE_KINDS.has(c.symbolKind)).map((c) => c.symbolName));
      for (const entry of entries) {
        if (entry.resolvedBy === 'SAME_NAMESPACE') expect(knownTypes.has(entry.fqcn)).toBe(true);
      }
    }
  });
});
