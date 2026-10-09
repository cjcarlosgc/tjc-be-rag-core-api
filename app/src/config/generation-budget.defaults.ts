/**
 * Defaults únicos del presupuesto de generación y de experimentos (WI-CORE-025).
 *
 * Son los valores que se usan cuando la variable de entorno no está definida. Viven en
 * `config/` (sin dependencias) para que `env.validation`, la recuperación RAG, el agente
 * generalista y el módulo de experimentos compartan una sola fuente sin ciclos de import.
 */
export const DEFAULT_RETRIEVAL_MAX_CONTEXT_TOKENS = 8000;
export const DEFAULT_AGENT_MAX_TOOL_CALLS = 20;
export const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;
/**
 * Intervalo del latido por repetición en curso (WI-CORE-025, HU17). Debe quedar muy por debajo del
 * umbral de vencimiento: el umbral efectivo nunca es menor que 3 × este intervalo.
 */
export const DEFAULT_EXPERIMENT_HEARTBEAT_INTERVAL_MS = 15_000;
