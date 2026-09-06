export interface CostRates {
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
}

/**
 * `estimatedCost` es null cuando el proveedor no reporta tokens suficientes,
 * nunca 0 (ver spec/transversal/experimental-metrics: "sin convertir un dato
 * ausente en cero"). La moneda/metodología viven en la configuración
 * (`LLM_INPUT_COST_PER_1K_TOKENS`/`LLM_OUTPUT_COST_PER_1K_TOKENS`), no en este
 * cálculo.
 */
export function estimateCost(
  inputTokens: number | null,
  outputTokens: number | null,
  rates: CostRates,
): number | null {
  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  return (
    (inputTokens / 1000) * rates.inputCostPer1kTokens +
    (outputTokens / 1000) * rates.outputCostPer1kTokens
  );
}
