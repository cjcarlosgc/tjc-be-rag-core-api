export interface LLMGenerationResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Configuración efectiva de un experimento, resuelta una vez y compartida por
 * ambos brazos (DEC-EXP-004). `null` significa que el parámetro no se envía.
 */
export interface LLMEffectiveConfig {
  provider: 'openai';
  model: string;
  modelVersion: string;
  reasoningEffort: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
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
  | { role: 'assistant'; content: string | null; toolCalls?: LLMToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface LLMToolsResult {
  content: string;
  toolCalls: LLMToolCall[];
  assistantMessage: LLMMessage;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LLMProvider {
  /** Sin `config` conserva LLM_MODEL/LLM_REASONING_EFFORT del flujo de producto. */
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
