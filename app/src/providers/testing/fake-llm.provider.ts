import { LLMConfigurationError, type LLMConfigurationErrorCode } from '../llm-configuration.error.js';
import { LLMProviderUnavailableError } from '../llm-provider-unavailable.error.js';
import type {
  LLMEffectiveConfig,
  LLMGenerationResult,
  LLMMessage,
  LLMProvider,
  LLMToolCall,
  LLMToolDefinition,
  LLMToolsResult,
} from '../llm-provider.interface.js';

/**
 * Doble de contrato del puerto `LLMProvider` (WI-CORE-089, CT-09-A3). Es determinista, no usa red, no importa
 * ningún SDK de proveedor y cuenta tokens de forma fija. Sirve para probar el dominio y para la suite de contrato
 * que compara este doble con el adaptador de OpenAI. No es un adaptador de producción: no se registra en
 * `ProvidersModule`.
 */

/** Identificador que informa el doble en `effective.provider` (el puerto lo trata como texto opaco). */
export const FAKE_PROVIDER_ID = 'fake';
/** Contenido por defecto cuando no hay respuesta guionada. */
export const FAKE_DEFAULT_CONTENT = 'Respuesta determinista del adaptador falso.';
/** Tokens fijos por defecto de cada llamada; no dependen del texto. */
export const FAKE_INPUT_TOKENS = 10;
export const FAKE_OUTPUT_TOKENS = 5;

/** Respuesta guionada de una llamada. Lo omitido toma el valor por defecto. */
export interface FakeTurn {
  content?: string | null;
  toolCalls?: LLMToolCall[];
  /** `null` simula un proveedor que no informa el uso de tokens. */
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/**
 * Fallo inyectado en la siguiente llamada. `http` y `connection` se clasifican como lo hace el adaptador de
 * OpenAI (429, 5xx y conexión son externos); `configuration` lanza un `LLMConfigurationError` concreto.
 */
export type FakeFault =
  | { kind: 'http'; status: number; message?: string }
  | { kind: 'connection'; message?: string }
  | { kind: 'configuration'; code: LLMConfigurationErrorCode; model?: string };

/** Llamada efectivamente enviada al doble (no se registran las rechazadas antes de enviar). */
export interface FakeRequest {
  operation: 'generate' | 'generateWithTools';
  model: string;
  reasoningEffort: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
  messages: LLMMessage[];
  toolNames: string[];
}

export interface FakeLLMProviderOptions {
  model?: string;
  modelVersion?: string;
  reasoningEffort?: string | null;
}

type QueuedStep = FakeTurn | FakeFault;

export class FakeLLMProvider implements LLMProvider {
  /** Llamadas enviadas, en orden. */
  readonly requests: FakeRequest[] = [];

  private readonly queue: QueuedStep[] = [];
  private readonly model: string;
  private readonly modelVersion: string;
  private readonly reasoningEffort: string | null;
  private modelAvailable = true;

  constructor(options: FakeLLMProviderOptions = {}) {
    this.model = options.model ?? 'fake-model';
    this.modelVersion = options.modelVersion ?? `${this.model}@fake`;
    this.reasoningEffort = options.reasoningEffort === undefined ? 'low' : options.reasoningEffort;
  }

  /** Encola la respuesta de la siguiente llamada (`generate` o `generateWithTools`). */
  enqueueTurn(turn: FakeTurn): this {
    this.queue.push(turn);
    return this;
  }

  /** Encola un fallo para la siguiente llamada. */
  enqueueFault(fault: FakeFault): this {
    this.queue.push(fault);
    return this;
  }

  /** `false` hace que `resolveEffectiveConfig` falle con `MODEL_UNAVAILABLE`, como el adaptador de OpenAI. */
  setModelAvailable(available: boolean): this {
    this.modelAvailable = available;
    return this;
  }

  async generate(prompt: string, config?: LLMEffectiveConfig): Promise<LLMGenerationResult> {
    const settings = this.settingsFor(config);
    this.assertTemperatureCompatible(settings);
    const turn = this.nextTurn(settings.model);
    this.requests.push({
      operation: 'generate',
      ...settings,
      messages: [{ role: 'user', content: prompt }],
      toolNames: [],
    });
    return {
      content: turn.content ?? '',
      inputTokens: tokenCount(turn.inputTokens, FAKE_INPUT_TOKENS),
      outputTokens: tokenCount(turn.outputTokens, FAKE_OUTPUT_TOKENS),
      effective: { provider: FAKE_PROVIDER_ID, model: settings.model, reasoningEffort: settings.reasoningEffort },
    };
  }

  async generateWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    config: LLMEffectiveConfig,
  ): Promise<LLMToolsResult> {
    const settings = this.settingsFor(config);
    this.assertTemperatureCompatible(settings);
    const turn = this.nextTurn(settings.model);
    this.requests.push({
      operation: 'generateWithTools',
      ...settings,
      messages: [...messages],
      toolNames: tools.map((tool) => tool.name),
    });
    const content = turn.content ?? '';
    const toolCalls = [...(turn.toolCalls ?? [])];
    return {
      content,
      toolCalls,
      assistantMessage: {
        role: 'assistant',
        content: content.length > 0 ? content : null,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      inputTokens: tokenCount(turn.inputTokens, FAKE_INPUT_TOKENS),
      outputTokens: tokenCount(turn.outputTokens, FAKE_OUTPUT_TOKENS),
    };
  }

  async resolveEffectiveConfig(): Promise<LLMEffectiveConfig> {
    if (!this.modelAvailable) {
      throw new LLMConfigurationError({
        code: 'MODEL_UNAVAILABLE',
        model: this.model,
        requestedEffort: null,
        supportedEfforts: [],
      });
    }
    return {
      provider: FAKE_PROVIDER_ID,
      model: this.model,
      modelVersion: this.modelVersion,
      reasoningEffort: this.reasoningEffort,
      temperature: null,
      maxOutputTokens: null,
    };
  }

  /** Configuración de la llamada: la pedida o, sin `config`, la del doble. */
  private settingsFor(config: LLMEffectiveConfig | undefined): CallSettings {
    if (config === undefined) {
      return { model: this.model, reasoningEffort: this.reasoningEffort, temperature: null, maxOutputTokens: null };
    }
    return {
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
  }

  /** Misma regla que el adaptador de OpenAI: temperatura con razonamiento activo es un error de configuración. */
  private assertTemperatureCompatible(settings: CallSettings): void {
    const { temperature, reasoningEffort, model } = settings;
    if (temperature === null || reasoningEffort === null || reasoningEffort === 'none') {
      return;
    }
    throw new LLMConfigurationError(
      {
        code: 'TEMPERATURE_UNSUPPORTED_WITH_REASONING',
        model,
        requestedEffort: reasoningEffort,
        supportedEfforts: ['none'],
        temperature,
      },
      `La temperatura ${temperature} no es compatible con razonamiento activo (esfuerzo "${reasoningEffort}") del modelo "${model}"; use esfuerzo "none" o quite la temperatura.`,
    );
  }

  /** Devuelve el turno guionado o el turno por defecto; un fallo encolado se lanza en lugar de devolver. */
  private nextTurn(model: string): FakeTurn {
    const step = this.queue.shift();
    if (step === undefined) return {};
    if (!isFault(step)) return step;
    throw faultToError(step, model);
  }
}

interface CallSettings {
  model: string;
  reasoningEffort: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
}

function isFault(step: QueuedStep): step is FakeFault {
  return 'kind' in step;
}

/** Clasificación igual a la del adaptador de OpenAI: 429, 5xx y conexión son fallos externos. */
function faultToError(fault: FakeFault, model: string): Error {
  switch (fault.kind) {
    case 'http':
      return new LLMProviderUnavailableError(
        fault.message ?? `Error HTTP ${fault.status} del proveedor.`,
        fault.status === 429 || fault.status >= 500,
      );
    case 'connection':
      return new LLMProviderUnavailableError(fault.message ?? 'Error de conexión con el proveedor.', true);
    case 'configuration':
      return new LLMConfigurationError({
        code: fault.code,
        model: fault.model ?? model,
        requestedEffort: null,
        supportedEfforts: [],
      });
  }
}

/** Un valor `undefined` usa el conteo fijo; `null` se conserva como «no informado». */
function tokenCount(value: number | null | undefined, fixed: number): number | null {
  if (value === null) return null;
  return value ?? fixed;
}
