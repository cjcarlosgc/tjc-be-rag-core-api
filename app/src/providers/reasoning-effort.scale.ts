/**
 * Escala de esfuerzo de razonamiento de menor a mayor (WI-CORE-031). Valida la sintaxis de
 * `LLM_REASONING_EFFORT` al arrancar (WI-CORE-076); no dice qué acepta cada modelo. `max` existe
 * solo en `/v1/responses` (verificado 2026-10-09). `minimal` está en la escala, pero `gpt-6-luna`
 * lo rechaza con 400: un esfuerzo que la API no admita falla en la llamada con error explícito.
 * No importa el SDK: la usan el adaptador y la validación de entorno.
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
