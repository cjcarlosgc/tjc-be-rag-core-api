import { countTokens } from 'gpt-tokenizer/encoding/cl100k_base';
import type { FunctionalRule } from './generation-context.js';

/**
 * Texto con el que `PromptBuilder` presenta una regla funcional. Es la única fuente del formato: el
 * presupuesto de `ContextBuilder` cuenta exactamente este texto (WI-CORE-021). No incluye
 * `confirmedByUserId` para no exponer identidades de personas al modelo.
 */
export function renderFunctionalRule(rule: FunctionalRule): string {
  const provenance = [
    `origen: ${rule.source}`,
    rule.provenance.confirmedRole ? `confirmada por rol ${rule.provenance.confirmedRole}` : null,
    rule.provenance.originHeadSha ? `headSha: ${rule.provenance.originHeadSha}` : null,
    rule.provenance.sourceRef ? `referencia: ${rule.provenance.sourceRef}` : null,
  ].filter((part): part is string => part !== null);

  return `- [${rule.scenarioKey}] ${rule.normalizedRule} (${provenance.join('; ')})`;
}

/** Mismo tokenizador que los chunks (`cl100k_base`) sobre el texto renderizado de la regla. */
export function countFunctionalRuleTokens(rule: FunctionalRule): number {
  return countTokens(renderFunctionalRule(rule));
}
