/**
 * Tipos, constantes y funciones auxiliares del trabajo de experimentos (agenda de slots, límites de concurrencia,
 * saneo de configuración y de objetivos). Extraídas de `experiment-job.handler.ts` sin cambios de lógica
 * (refactor SDD 3.1).
 */
import { createHash } from 'node:crypto';
import type { RetrievalTarget } from '../retrieval/generation-context.js';
import type { LLMEffectiveConfig } from '../providers/llm-provider.interface.js';
import type { SandboxExecutionEvidence } from '../sandbox/sandbox-evidence-facts.js';
import type { RepetitionArtifact, SandboxEvidenceArtifact } from './repetition-artifact.js';
import type { ExperimentBudget } from './persistence/experiment-runs.repository.js';
import type { TestTarget } from '../generated/prisma/client.js';
import type { ExecutionProfile } from '../sandbox/sandbox.types.js';
import { experimentPairId, pairOrder } from './pair-order.js';

export type Strategy = 'RAG' | 'GENERALIST_AGENT';

export const STRATEGIES: Strategy[] = ['RAG', 'GENERALIST_AGENT'];

export const REPETITIONS_PER_STRATEGY = 3;

/** Identidad lógica de un slot (estrategia + repetición) y de su par (WI-CORE-025). */
export interface SlotIdentity {
  strategy: Strategy;
  repetition: number;
  pairId: string | null;
  pairPosition: number | null;
}

/** Contexto común de una corrida; `runAttempt` lo amplía con el slot y el número de intento. */
export interface RunContext {
  jobId: string;
  experimentId: string;
  projectId: string;
  projectVersionId: string;
  snapshotKey: string;
  snapshotBuffer: Buffer;
  framework: 'JEST' | 'VITEST' | 'PHPUNIT' | null;
  /** WI-CORE-029: lenguaje del proyecto (`version.language`); PHP usa la ruta DEC-PHP-GEN-001. */
  language: 'php' | 'typescript';
  /** Raíz efectiva congelada por ProjectVersion; solo se transporta para PHP. */
  projectRoot: string;
  target: TestTarget;
  config: LLMEffectiveConfig;
  budget: ExperimentBudget;
  executionProfile: ExecutionProfile | undefined;
}

export interface AttemptContext extends RunContext, SlotIdentity {
  /** 1 = intento inicial; 2 = único reintento por fallo externo (nunca hay 3). */
  attempt: 1 | 2;
}

/** Resumen de un fallo externo del proveedor LLM (WI-CORE-025). */
export const LLM_EXTERNAL_FAILURE_SUMMARY =
  'El proveedor de LLM no respondió correctamente durante la generación.';

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer),
  ) as Promise<T>;
}

/**
 * Ejecuta `items` a través de `worker` con a lo sumo `concurrency` corridas
 * simultáneas. Cada repetición de un experimento ya es independiente
 * (workspace y contenedor Sandbox propios), así que correrlas en serie solo
 * suma latencia sin necesidad: el tiempo total pasa a ser el de los lotes
 * concurrentes en vez de la suma de las 6.
 */
export function parseEffectiveConfig(value: unknown): LLMEffectiveConfig {
  const candidate = value as Partial<
    Record<keyof LLMEffectiveConfig, unknown>
  > | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.provider !== 'string' ||
    candidate.provider.trim() === '' ||
    typeof candidate.model !== 'string' ||
    typeof candidate.modelVersion !== 'string'
  ) {
    throw new Error('modelConfig del experimento no es válido.');
  }
  return {
    // WI-CORE-089: el identificador del adaptador se conserva tal cual (texto opaco para el dominio).
    provider: candidate.provider,
    model: candidate.model,
    modelVersion: candidate.modelVersion,
    reasoningEffort:
      typeof candidate.reasoningEffort === 'string'
        ? candidate.reasoningEffort
        : null,
    temperature:
      typeof candidate.temperature === 'number' ? candidate.temperature : null,
    maxOutputTokens:
      typeof candidate.maxOutputTokens === 'number'
        ? candidate.maxOutputTokens
        : null,
    // WI-CORE-031: corridas anteriores no tienen endpoint; solo se conserva si es texto (WI-CORE-089).
    ...(typeof candidate.endpoint === 'string'
      ? { endpoint: candidate.endpoint }
      : {}),
  };
}

/**
 * Ejecuta `items` con a lo sumo `concurrency` corridas simultáneas y no rechaza hasta que TODAS las
 * corridas en vuelo terminen (WI-CORE-025 (3c)): si un slot falla, no se lanzan slots nuevos, se espera
 * a los que ya corren y entonces se relanza el primer error. Así un job nunca se reprograma con un
 * slot todavía vivo dentro del proceso.
 */
export async function runWithConcurrencyLimit<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const failure: { failed: boolean; error: unknown } = {
    failed: false,
    error: undefined,
  };

  async function runNext(): Promise<void> {
    while (!failure.failed && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        await worker(items[index]);
      } catch (error) {
        if (!failure.failed) {
          failure.failed = true;
          failure.error = error;
        }
        return;
      }
    }
  }

  const lanes = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runNext(),
  );
  await Promise.allSettled(lanes);

  if (failure.failed) {
    throw failure.error;
  }
}

export function slotKey(strategy: string, repetition: number): string {
  return `${strategy}:${repetition}`;
}

/** Pares 1..3 en orden (plan punto 5): dentro de cada par, la posición 1 corre primero. */
export function buildPairSchedule(
  experimentId: string,
  seed: string,
): SlotIdentity[][] {
  return Array.from({ length: REPETITIONS_PER_STRATEGY }, (_, index) => {
    const repetition = index + 1;
    const pairId = experimentPairId(experimentId, repetition);
    return pairOrder(seed, repetition).map((strategy, position) => ({
      strategy,
      repetition,
      pairId,
      pairPosition: position + 1,
    }));
  });
}

/** Corridas previas sin semilla: orden y slots actuales, sin identidad de par. */
export function buildLegacySchedule(): SlotIdentity[] {
  return STRATEGIES.flatMap((strategy) =>
    Array.from({ length: REPETITIONS_PER_STRATEGY }, (_, index) => ({
      strategy,
      repetition: index + 1,
      pairId: null,
      pairPosition: null,
    })),
  );
}

/** Resumen persistido al cerrar un intento cuyo latido venció (WI-CORE-025 (3c)). */
export const INTERRUPTED_ATTEMPT_SUMMARY =
  'El intento quedó interrumpido: su latido venció antes de terminar.';

/** Valores ausentes (`null` o no presentes en corridas previas) no son error: usan la versión actual. */
export function parseRunnerHint(
  value: string | null | undefined,
): 'JEST' | 'VITEST' | 'PHPUNIT' | null {
  if (value === null || value === undefined) return null;
  if (value === 'JEST' || value === 'VITEST' || value === 'PHPUNIT')
    return value;
  throw new Error('runnerHint del experimento no es válido.');
}

export function parseExecutionProfile(
  value: string | null | undefined,
): ExecutionProfile | undefined {
  if (value === null || value === undefined) return undefined;
  if (value === 'NODE_TYPESCRIPT' || value === 'PHP_LARAVEL_PHPUNIT')
    return value;
  throw new Error('executionProfile del experimento no es válido.');
}

/** WI-CORE-060: artefacto interno con la evidencia del Sandbox ya saneada (campos opcionales). */
export type RepetitionArtifactRecord = RepetitionArtifact & Partial<SandboxEvidenceArtifact>;

/** SHA-256 hex (utf8) de un prompt. Solo se persiste el hash, nunca el texto (DEC-VAL-001 PENDING). */
export function promptDigest(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}

export interface GenerationOutcome {
  content: string;
  /** WI-CORE-060: hash del prompt final enviado al LLM (o instrucciones del agente); null si no hubo prompt. */
  promptSha256: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  retrievedChunks: number | null;
  selectedChunks: number | null;
  contextTokens: number | null;
  toolCalls: number | null;
  filesInspected: number | null;
  trajectory: unknown;
}

/** WI-CORE-027 (DEC-EVID-003): evidencia de una repetición; todo es null si no hubo invocación al Sandbox. */
export interface RepetitionEvidence {
  sandbox: SandboxExecutionEvidence | null;
  /** SHA-256 del contenido de prueba enviado al Sandbox; null si no hubo contenido ni invocación. */
  artifactHash: string | null;
  /** WI-CORE-053: artefacto interno (contenido y hechos del Sandbox); null si no hubo contenido enviado. */
  artifact: RepetitionArtifactRecord | null;
  /** WI-CORE-060: inicio del intento; la escritura terminal guarda este valor como startedAt. */
  startedAt: Date;
}

/** Target de recuperación a partir de la fila persistida (misma forma que usa el brazo RAG). */
export function toRetrievalTarget(target: TestTarget): RetrievalTarget {
  return {
    filePath: target.filePath,
    symbolName: target.symbolName,
    methodName: target.methodName,
    targetType: target.targetType as 'METHOD' | 'FUNCTION',
  };
}
