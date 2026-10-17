/**
 * Escala de esfuerzo de razonamiento de menor a mayor (WI-CORE-031). Solo ordena: qué niveles
 * están disponibles para un modelo lo decide `LLM_SUPPORTED_COMBINATIONS`. `max` existe solo en
 * `/v1/responses` (verificado 2026-10-09); `minimal` queda rankeado pero no se soporta salvo que
 * la combinación lo liste. No importa el SDK: la usan el adaptador y la validación de entorno.
 */
export const REASONING_EFFORT_SCALE: readonly string[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
