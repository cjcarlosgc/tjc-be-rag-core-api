import { createHash } from 'node:crypto';
import { sanitizeFailureMessage } from '../common/sanitize-failure-message.util.js';
import { uuidV5 } from '../common/uuid-v5.util.js';
import {
  toSandboxFailureCategory,
  toSandboxStage,
  toValidFailureCode,
} from '../experiments/experiment-failure-fact.js';
import type { StructuralRelation } from '../retrieval-comparisons/dto/retrieval-comparison.response.js';
import type { RetrievalMetricsResponse } from '../retrieval-comparisons/dto/retrieval-comparison.response.js';
import type { SandboxEvidenceFacts } from '../sandbox/sandbox-evidence-facts.js';
import type { ExecutionProfile } from '../sandbox/sandbox.types.js';
import type {
  EvidenceRetrievalCandidateResponse,
  EvidenceRetrievalConfigResponse,
  EvidenceRunnerHint,
} from './dto/evidence-bundle.response.js';

/**
 * WI-CORE-027 (INTEROP-2.7 §6.16): funciones puras que leen valores persistidos (JSONB y columnas) y los
 * convierten en los tipos de la evidencia. Son la única vía de lectura: nunca se copia un JSON crudo, y un
 * valor que no tiene el tipo esperado queda `null` (nunca `0` ni cadena vacía).
 */

/** SHA-256 de un contenido vacío: la propuesta de excepción se guarda con `content = ''` (sin artefacto real). */
export const EMPTY_CONTENT_SHA256 = createHash('sha256').update('', 'utf8').digest('hex');

/** Namespace de los UUIDv5 de `snapshotRef` (DEC-EVID-005): namespace URL de RFC 4122 (6ba7b811-9dad-11d1-80b4-00c04fd430c8). */
export const SNAPSHOT_REF_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EXECUTION_PROFILES: readonly ExecutionProfile[] = ['NODE_TYPESCRIPT', 'PHP_LARAVEL_PHPUNIT'];
const RUNNER_HINTS: readonly EvidenceRunnerHint[] = ['JEST', 'VITEST', 'PHPUNIT'];
const STRUCTURAL_RELATIONS: readonly StructuralRelation[] = [
  'IMPORTS',
  'IMPORTED_BY',
  'SAME_NAMESPACE',
  'FULLY_QUALIFIED_REFERENCE',
  'DECLARING_CLASS',
];

type RawRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Entradas de un array JSON como registros; una entrada que no lo es queda como registro vacío. */
export function recordsOf(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.map((entry) => (isRecord(entry) ? entry : {})) : [];
}

/** Texto no vacío; cualquier otro valor (incluida la cadena vacía) no es un dato observado. */
export function toText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Entero no negativo; cualquier otro valor es no observado. */
export function toCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toFlag(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function toSha256(value: unknown): string | null {
  return typeof value === 'string' && SHA256_PATTERN.test(value) ? value : null;
}

/** Lista de textos no vacíos; un valor que no es lista da una lista vacía (no hay elementos observados). */
export function toTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

export function toExecutionProfile(value: unknown): ExecutionProfile | null {
  return typeof value === 'string' && (EXECUTION_PROFILES as readonly string[]).includes(value)
    ? (value as ExecutionProfile)
    : null;
}

/**
 * `runnerHint` de §6.16: los valores de `TestRunner` (§7.1), incluido `PHPUNIT` (WI-CORE-029). Un valor fuera de
 * esa lista (o que no es texto) queda `null`; nunca se inventa un runner.
 */
export function toRunnerHint(value: unknown): EvidenceRunnerHint | null {
  return typeof value === 'string' && (RUNNER_HINTS as readonly string[]).includes(value)
    ? (value as EvidenceRunnerHint)
    : null;
}

function toStructuralRelation(value: unknown): StructuralRelation | null {
  return typeof value === 'string' && (STRUCTURAL_RELATIONS as readonly string[]).includes(value)
    ? (value as StructuralRelation)
    : null;
}

/** Posición de un par experimental: solo 1 o 2; filas previas a OE5 quedan `null`. */
export function toPairPosition(value: unknown): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

/**
 * `artifactHash` de un contenido: SHA-256 válido, salvo el de la propuesta de excepción (`content = ''`), que no
 * tiene artefacto y queda `null`.
 */
export function artifactHashOf(contentSha256: unknown): string | null {
  const hash = toSha256(contentSha256);
  return hash === null || hash === EMPTY_CONTENT_SHA256 ? null : hash;
}

/** `snapshotRef` (DEC-EVID-005): UUIDv5 determinista; nunca clave de storage ni URL. */
export function snapshotRefFor(projectVersionId: string | null, headSha: string): string | null {
  if (projectVersionId === null || headSha.length === 0) return null;
  return uuidV5(SNAPSHOT_REF_NAMESPACE, `urn:tjc:snapshot-ref:v1:${projectVersionId}:${headSha}`);
}

/** Nombre calificado como en `AnalysisSymbol.qualifiedName`: `parent.name` o `name`. */
export function qualifiedNameOf(parentSymbolName: unknown, symbolName: unknown): string | null {
  const name = toText(symbolName);
  if (name === null) return null;
  const parent = toText(parentSymbolName);
  return parent === null ? name : `${parent}.${name}`;
}

/**
 * Hechos del Sandbox (14 claves cerradas de §6.16) construidos campo a campo desde un JSON persistido. Cada clave
 * se valida con su tipo; `failureMessage` se vuelve a sanear (idempotente) para filas escritas antes de IDEA-016.
 * `fallbackExecutionProfile` solo rellena `executionProfile` cuando el JSON no lo trae (lo registró Core al aceptar).
 */
export function toEvidenceFacts(raw: unknown, fallbackExecutionProfile: ExecutionProfile | null = null): SandboxEvidenceFacts {
  const record = isRecord(raw) ? raw : {};
  const failureMessage = toText(record.failureMessage);

  return {
    executionProfile: toExecutionProfile(record.executionProfile) ?? fallbackExecutionProfile,
    runner: toRunnerHint(record.runner),
    compiled: toFlag(record.compiled),
    executed: toFlag(record.executed),
    passed: toFlag(record.passed),
    totalTests: toCount(record.totalTests),
    passedTests: toCount(record.passedTests),
    failedTests: toCount(record.failedTests),
    skippedTests: toCount(record.skippedTests),
    testCasesTruncated: toFlag(record.testCasesTruncated),
    failureStage: toSandboxStage(record.failureStage),
    failureCategory: toSandboxFailureCategory(record.failureCategory),
    failureCode: toValidFailureCode(record.failureCode),
    failureMessage: failureMessage === null ? null : toText(sanitizeFailureMessage(failureMessage)),
  };
}

/** `config` de SE de un AnalysisRun: solo `vectorTopK` se persistió; el resto de la forma es `null`. */
export function toRunRetrievalConfig(raw: unknown): EvidenceRetrievalConfigResponse {
  const record = isRecord(raw) ? raw : {};
  return {
    semanticTopK: toCount(record.vectorTopK),
    finalTopK: null,
    semanticWeight: null,
    structuralWeight: null,
    embeddingModel: null,
  };
}

/** `config` de un resultado de comparación (`retrieval_comparison_results.config`), campo a campo. */
export function toComparisonRetrievalConfig(raw: unknown): EvidenceRetrievalConfigResponse {
  const record = isRecord(raw) ? raw : {};
  return {
    semanticTopK: toCount(record.semanticTopK),
    finalTopK: toCount(record.finalTopK),
    semanticWeight: toFiniteNumber(record.semanticWeight),
    structuralWeight: toFiniteNumber(record.structuralWeight),
    embeddingModel: toText(record.embeddingModel),
  };
}

/**
 * `config` del brazo RAG de un experimento (`ContextTrace.detail.configuration`). `semanticTopK` y el modelo de
 * embedding no se persistieron en la traza, así que quedan `null`.
 */
export function toRagRetrievalConfig(raw: unknown): EvidenceRetrievalConfigResponse {
  const record = isRecord(raw) ? raw : {};
  return {
    semanticTopK: null,
    finalTopK: toCount(record.topK),
    semanticWeight: toFiniteNumber(record.semanticWeight),
    structuralWeight: toFiniteNumber(record.structuralWeight),
    embeddingModel: null,
  };
}

/**
 * Candidatos de un AnalysisRun (`analysis_retrievals.candidates`). `rank` es la posición persistida; `selected`
 * sale de `selectedChunkIds` del contexto del mismo símbolo (`null` si no hay contexto). `combinedScore` no se
 * persistió en SE.
 */
export function toRunCandidates(
  raw: unknown,
  selectedChunkIds: ReadonlySet<string> | null,
): EvidenceRetrievalCandidateResponse[] {
  return recordsOf(raw).map((candidate, index) => {
    const chunkId = toText(candidate.chunkId);
    return {
      rank: index + 1,
      chunkId,
      filePath: toText(candidate.filePath),
      symbolQualifiedName: qualifiedNameOf(candidate.parentSymbolName, candidate.symbolName),
      semanticScore: toFiniteNumber(candidate.semanticScore),
      structuralRelation: toStructuralRelation(candidate.structuralMatch),
      combinedScore: null,
      selected: selectedChunkIds === null || chunkId === null ? null : selectedChunkIds.has(chunkId),
    };
  });
}

/** Candidatos de un resultado de comparación (`retrieval_comparison_results.candidates`), campo a campo. */
export function toComparisonCandidates(raw: unknown): EvidenceRetrievalCandidateResponse[] {
  return recordsOf(raw).map((candidate) => ({
    rank: toCount(candidate.rank),
    chunkId: toText(candidate.chunkId),
    filePath: toText(candidate.filePath),
    symbolQualifiedName: toText(candidate.symbolQualifiedName),
    semanticScore: toFiniteNumber(candidate.semanticScore),
    structuralRelation: toStructuralRelation(candidate.structuralRelation),
    combinedScore: toFiniteNumber(candidate.combinedScore),
    selected: toFlag(candidate.selected),
  }));
}

/**
 * Candidatos del brazo RAG de un experimento (`ContextTrace.detail.candidates`). Se leen solo los campos del
 * contrato: nunca `excerpt` (código). `filePath` y el nombre calificado salen de la ubicación del fragmento
 * (`excerpt`), que es metadato, no código; `selected` deriva de `decision`.
 */
export function toRagCandidates(raw: unknown): EvidenceRetrievalCandidateResponse[] {
  return recordsOf(raw).map((candidate) => {
    const location = isRecord(candidate.excerpt) ? candidate.excerpt : {};
    const decision = candidate.decision;

    return {
      rank: toCount(candidate.rank),
      chunkId: toText(candidate.chunkId),
      filePath: toText(location.filePath),
      symbolQualifiedName: qualifiedNameOf(location.parentSymbolName, location.symbolName),
      semanticScore: toFiniteNumber(candidate.semanticScore),
      structuralRelation: toStructuralRelation(candidate.structuralMatch),
      combinedScore: toFiniteNumber(candidate.combinedScore),
      selected: decision === 'SELECTED' ? true : decision === 'DISCARDED' ? false : null,
    };
  });
}

/** Métricas de OE2 (`retrieval_comparison_results.metrics`): todas o ninguna; un valor incompleto es `null`. */
export function toRetrievalMetrics(raw: unknown): RetrievalMetricsResponse | null {
  if (!isRecord(raw)) return null;

  const precisionAt5 = toFiniteNumber(raw.precisionAt5);
  const recallAt5 = toFiniteNumber(raw.recallAt5);
  const precisionAt10 = toFiniteNumber(raw.precisionAt10);
  const recallAt10 = toFiniteNumber(raw.recallAt10);
  if (precisionAt5 === null || recallAt5 === null || precisionAt10 === null || recallAt10 === null) {
    return null;
  }

  return { precisionAt5, recallAt5, precisionAt10, recallAt10 };
}

/** Clave del contexto RAG de un experimento: ids de candidatos según `decision`, tokens y reglas funcionales. */
export function ragCandidateIdsByDecision(detail: unknown, decision: 'SELECTED' | 'DISCARDED'): string[] {
  const record = isRecord(detail) ? detail : {};
  return recordsOf(record.candidates)
    .filter((candidate) => candidate.decision === decision)
    .map((candidate) => toText(candidate.chunkId))
    .filter((chunkId): chunkId is string => chunkId !== null);
}

/** Pasos de exploración de un agente: solo `step`, `toolName` y `status` (sin argumentos, resultados ni razonamiento). */
export function toAgentSteps(trajectory: unknown): Array<{ step: number | null; toolName: string | null; status: string | null }> {
  return recordsOf(trajectory).map((step) => ({
    step: toCount(step.step),
    toolName: toText(step.toolName),
    status: toText(step.status),
  }));
}
