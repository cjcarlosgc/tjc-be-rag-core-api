export interface LLMGenerationResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * WI-CORE-027: configuración efectiva con la que el adaptador envió la llamada. Opcional: fakes y adaptadores
   * que no la informan dejan la evidencia de generación con `null`, nunca con un valor inventado.
   * WI-CORE-089: `provider` lo fija cada adaptador (p. ej. `'openai'` en el adaptador de OpenAI).
   */
  effective?: { provider: LLMEffectiveConfig['provider']; model: string; reasoningEffort: string | null };
}

/**
 * Configuración efectiva de un experimento, resuelta una vez y compartida por
 * ambos brazos (DEC-EXP-004). `null` significa que el parámetro no se envía.
 */
export interface LLMEffectiveConfig {
  /**
   * Identificador del adaptador que envía la llamada (WI-CORE-089). El dominio lo trata como texto opaco: cada
   * adaptador fija su valor (el de OpenAI fija `'openai'`) y el dominio no lo reescribe ni lo compara con una lista.
   */
  provider: string;
  model: string;
  modelVersion: string;
  reasoningEffort: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
  /**
   * Endpoint interno del adaptador (WI-CORE-031). Lo escribe resolveEffectiveConfig y
   * queda en ExperimentRun.modelConfig; es opcional para corridas anteriores y nunca
   * forma parte de la respuesta de la API. Es texto opaco para el dominio: el adaptador de
   * OpenAI fija `'responses'` (WI-CORE-089).
   */
  endpoint?: string;
}

/** Definición neutral de herramienta; `parameters` es un JSON Schema. */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type LLMMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      toolCalls?: LLMToolCall[];
      /**
       * Ítems de salida del proveedor del turno (WI-CORE-031), opacos para el dominio:
       * razonamiento cifrado, mensajes y llamadas a función tal cual. Solo el adaptador
       * del proveedor los interpreta; otros proveedores y fakes los ignoran. Nunca se
       * persisten ni entran en trayectoria o logs.
       */
      providerItems?: unknown[];
    }
  | { role: 'tool'; toolCallId: string; content: string };

export interface LLMToolsResult {
  content: string;
  toolCalls: LLMToolCall[];
  assistantMessage: LLMMessage;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LLMProvider {
  /** Sin `config` usa LLM_MODEL/LLM_REASONING_EFFORT (flujo de producto, WI-CORE-076). */
  generate(prompt: string, config?: LLMEffectiveConfig): Promise<LLMGenerationResult>;
  /** Nunca fuerza `none` ni cambia modelo o esfuerzo: usa exactamente `config`. */
  generateWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    config: LLMEffectiveConfig,
  ): Promise<LLMToolsResult>;
  /** Resuelve la configuración del experimento y confirma el modelo contra la API. */
  resolveEffectiveConfig(): Promise<LLMEffectiveConfig>;
}
