import type { GenerationContext } from '../retrieval/generation-context.js';

/**
 * Compuerta de contexto suficiente (WI-CORE-098, G-01 V1, regla D-5 de CT-05-A5).
 *
 * Decide, sobre el `GenerationContext` ya construido, si hay contexto mínimo para generar una prueba:
 * (a) el target tiene código indexado; (b) hay al menos un candidato sobre el mínimo de relevancia, o
 * no faltan reglas funcionales requeridas por el target. Solo bloquea cuando (a) falla o cuando faltan
 * reglas requeridas y ningún candidato supera el mínimo (cláusulas b y c juntas).
 *
 * Error interno: no es `AppException`, no tiene `ErrorCode` ni llega a ninguna respuesta HTTP. Lo capturan
 * los llamadores (validación y experimentos) y lo traducen a su propio resultado sin generar.
 */

export type InsufficientGenerationContextReason =
  | 'TARGET_WITHOUT_CODE'
  | 'NO_RELEVANT_CANDIDATES_AND_MISSING_RULES';

const INSUFFICIENT_MESSAGES: Record<InsufficientGenerationContextReason, string> = {
  TARGET_WITHOUT_CODE: 'Contexto insuficiente: el target no tiene código indexado.',
  NO_RELEVANT_CANDIDATES_AND_MISSING_RULES:
    'Contexto insuficiente: ningún candidato supera el mínimo de relevancia y faltan reglas funcionales requeridas del target.',
};

export class InsufficientGenerationContextError extends Error {
  constructor(
    readonly reason: InsufficientGenerationContextReason,
    readonly missingScenarioKeys: readonly string[],
    readonly eligibleCandidates: number,
    readonly retrievedCandidates: number,
  ) {
    super(INSUFFICIENT_MESSAGES[reason]);
    this.name = 'InsufficientGenerationContextError';
  }
}

export interface ContextSufficiencyInput {
  generationContext: GenerationContext;
  /** `scenarioKey` de las reglas recuperadas para el target (antes de presupuesto). */
  retrievedRuleScenarioKeys: readonly string[];
  /** `scenarioKey` de las construcciones de comportamiento que exigen regla del símbolo. */
  requiredScenarioKeys: readonly string[];
}

/**
 * Devuelve el error si el contexto es insuficiente, o `null` si puede generarse. Pura: no lee BD ni
 * configuración. Un candidato cuenta como elegible si su descarte no fue `BELOW_MINIMUM_SCORE` ni
 * `BELOW_RELEVANCE_THRESHOLD` (umbral de relevancia de la estrategia `LAYERED`, WI-CORE-103); los que caen
 * después por `TOP_K_LIMIT` o `TOKEN_BUDGET` sí cuentan (D-5 habla de relevancia, no de presupuesto).
 */
export function assessContextSufficiency(
  input: ContextSufficiencyInput,
): InsufficientGenerationContextError | null {
  const { generationContext } = input;
  const retrievedCandidates = generationContext.retrievedChunks;
  const auditCandidates = generationContext.audit?.candidates;
  const eligibleCandidates = auditCandidates
    ? auditCandidates.filter(
        (candidate) =>
          candidate.discardReason !== 'BELOW_MINIMUM_SCORE' &&
          candidate.discardReason !== 'BELOW_RELEVANCE_THRESHOLD',
      ).length
    : retrievedCandidates;

  if (generationContext.target.content.trim() === '') {
    return new InsufficientGenerationContextError(
      'TARGET_WITHOUT_CODE',
      [],
      eligibleCandidates,
      retrievedCandidates,
    );
  }

  const retrieved = new Set(input.retrievedRuleScenarioKeys);
  const missingScenarioKeys = [...new Set(input.requiredScenarioKeys)].filter(
    (scenarioKey) => !retrieved.has(scenarioKey),
  );

  if (eligibleCandidates === 0 && missingScenarioKeys.length > 0) {
    return new InsufficientGenerationContextError(
      'NO_RELEVANT_CANDIDATES_AND_MISSING_RULES',
      missingScenarioKeys,
      eligibleCandidates,
      retrievedCandidates,
    );
  }

  return null;
}
