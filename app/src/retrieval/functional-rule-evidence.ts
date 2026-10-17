import type { GenerationContext } from './generation-context.js';

/** Regla omitida por presupuesto: solo identificador y motivo (sin texto ni procedencia). */
export type FunctionalRuleOmissionEvidence = {
  knowledgeId: string;
  reason: 'TOKEN_BUDGET';
};

/**
 * Auditoría de reglas funcionales de un contexto (obligación heredada de WI-CORE-021, consumida por
 * WI-CORE-026). `functionalRuleIds` sigue el orden determinista del retriever. La procedencia
 * (`confirmedByUserId`, `confirmedRole`, `originHeadSha`, `source`, `sourceRef`) no se incluye: se
 * reconstruye por `knowledgeId` desde Functional Knowledge.
 */
export type FunctionalRuleEvidence = {
  functionalRuleIds: string[];
  retrieved: number;
  selected: number;
  omitted: FunctionalRuleOmissionEvidence[];
};

/**
 * Lee la evidencia de reglas funcionales de un `GenerationContext` ya construido. No muta el contexto
 * ni cambia lo que recibe el prompt.
 */
export function toFunctionalRuleEvidence(context: GenerationContext): FunctionalRuleEvidence {
  const audit = context.audit;

  if (!audit) {
    throw new Error('ContextBuilder no produjo evidencia de reglas funcionales.');
  }

  return {
    functionalRuleIds: context.functionalRules.map((rule) => rule.knowledgeId),
    retrieved: audit.functionalRules.retrieved,
    selected: audit.functionalRules.selected,
    omitted: audit.functionalRules.omitted.map((omission) => ({
      knowledgeId: omission.knowledgeId,
      reason: omission.reason,
    })),
  };
}
