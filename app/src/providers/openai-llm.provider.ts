import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIConnectionError, APIError } from 'openai';
import type {
  FunctionTool,
  Response as OpenAiResponse,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseOutputItem,
} from 'openai/resources/responses/responses.js';
import type { ReasoningEffort } from 'openai/resources/shared.js';
import { LLMConfigurationError } from './llm-configuration.error.js';
import { LLMProviderUnavailableError } from './llm-provider-unavailable.error.js';
import type {
  LLMEffectiveConfig,
  LLMGenerationResult,
  LLMMessage,
  LLMProvider,
  LLMToolCall,
  LLMToolDefinition,
  LLMToolsResult,
} from './llm-provider.interface.js';
import { createOpenAiClient } from './openai-client.factory.js';
import { REASONING_EFFORT_SCALE } from './reasoning-effort.scale.js';
import { strictToolSchemaViolations } from './strict-tool-schema.js';

const DEFAULT_EXPERIMENT_MODEL = 'gpt-6-luna';
/** Códigos de un Response con status `failed` que son fallo externo (WI-CORE-031). */
const EXTERNAL_RESPONSE_ERROR_CODES = new Set([
  'server_error',
  'rate_limit_exceeded',
]);

/** Combinación soportada: `efforts` aplica a generate, `toolEfforts` a generateWithTools. */
export interface LLMSupportedCombination {
  model: string;
  efforts: string[];
  toolEfforts: string[];
}

/**
 * Adaptador OpenAI del LLMProvider. Todas las llamadas usan `/v1/responses` sin estado
 * (`store: false`) y devuelven los ítems de salida del turno para reenviarlos (WI-CORE-031).
 */
@Injectable()
export class OpenAiLLMProvider implements LLMProvider {
  private readonly logger = new Logger(OpenAiLLMProvider.name);
  private client: OpenAI | undefined;

  constructor(private readonly configService: ConfigService) {}

  async generate(
    prompt: string,
    config?: LLMEffectiveConfig,
  ): Promise<LLMGenerationResult> {
    let model: string;
    let reasoningEffort: string | null;

    let temperature: number | null = null;
    if (config) {
      this.assertSupported(config.model, config.reasoningEffort, 'efforts');
      this.assertTemperatureCompatible(
        config.model,
        config.temperature,
        config.reasoningEffort,
        this.supportedEfforts(config.model, 'efforts'),
      );
      model = config.model;
      reasoningEffort = config.reasoningEffort;
      temperature = config.temperature;
    } else {
      model = this.configService.get<string>('LLM_MODEL', 'gpt-4o-mini');
      reasoningEffort =
        this.configService.get<string>('LLM_REASONING_EFFORT') || null;
    }

    const params: ResponseCreateParamsNonStreaming = {
      model,
      store: false,
      input: [{ role: 'user', content: prompt }],
      ...reasoningParams(reasoningEffort),
      ...temperatureParam(temperature, reasoningEffort),
      ...(config?.maxOutputTokens != null
        ? { max_output_tokens: config.maxOutputTokens }
        : {}),
    };

    const response = await this.createResponse(params, model);

    return {
      content: outputText(response.output),
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      effective: { provider: 'openai', model, reasoningEffort },
    };
  }

  async generateWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    config: LLMEffectiveConfig,
  ): Promise<LLMToolsResult> {
    this.assertSupported(config.model, config.reasoningEffort, 'toolEfforts');
    this.assertTemperatureCompatible(
      config.model,
      config.temperature,
      config.reasoningEffort,
      this.supportedEfforts(config.model, 'toolEfforts'),
    );

    const params: ResponseCreateParamsNonStreaming = {
      model: config.model,
      store: false,
      input: messages.flatMap(toResponseInputItems),
      ...(tools.length > 0
        ? { tools: tools.map(toFunctionTool), tool_choice: 'auto' as const }
        : {}),
      ...reasoningParams(config.reasoningEffort),
      ...temperatureParam(config.temperature, config.reasoningEffort),
      ...(config.maxOutputTokens != null
        ? { max_output_tokens: config.maxOutputTokens }
        : {}),
    };

    const response = await this.createResponse(params, config.model);
    const output = response.output ?? [];
    const content = outputText(output);
    const toolCalls: LLMToolCall[] = output.flatMap((item) =>
      item.type === 'function_call'
        ? [{ id: item.call_id, name: item.name, arguments: item.arguments }]
        : [],
    );

    return {
      content,
      toolCalls,
      assistantMessage: {
        role: 'assistant',
        content: content.length > 0 ? content : null,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        providerItems: output,
      },
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    };
  }

  async resolveEffectiveConfig(): Promise<LLMEffectiveConfig> {
    const model = this.configService.get<string>(
      'EXPERIMENT_LLM_MODEL',
      DEFAULT_EXPERIMENT_MODEL,
    );
    const combination = this.findCombination(model);
    const common = combination
      ? combination.efforts.filter((effort) =>
          combination.toolEfforts.includes(effort),
        )
      : [];
    const requested =
      this.configService.get<string>('EXPERIMENT_LLM_REASONING_EFFORT') || null;

    let reasoningEffort: string | null;
    if (requested) {
      if (!common.includes(requested)) {
        throw new LLMConfigurationError({
          code: 'REASONING_EFFORT_UNSUPPORTED',
          model,
          requestedEffort: requested,
          supportedEfforts: common,
        });
      }
      reasoningEffort = requested;
    } else {
      reasoningEffort = highestEffort(common);
      if (reasoningEffort === null) {
        throw new LLMConfigurationError({
          code: 'REASONING_EFFORT_UNSUPPORTED',
          model,
          requestedEffort: null,
          supportedEfforts: common,
        });
      }
    }

    const temperature = optionalNumber(
      this.configService.get<string>('EXPERIMENT_LLM_TEMPERATURE'),
    );
    this.assertTemperatureCompatible(model, temperature, reasoningEffort, common);

    const modelVersion = await this.confirmModel(model);

    return {
      provider: 'openai',
      model,
      modelVersion,
      reasoningEffort,
      temperature,
      maxOutputTokens: optionalNumber(
        this.configService.get<string>('EXPERIMENT_LLM_MAX_OUTPUT_TOKENS'),
      ),
      endpoint: 'responses',
    };
  }

  private assertSupported(
    model: string,
    requested: string | null,
    kind: 'efforts' | 'toolEfforts',
  ): void {
    const combination = this.findCombination(model);
    const supported = this.supportedEfforts(model, kind);

    if (
      !combination ||
      (requested !== null && !supported.includes(requested))
    ) {
      throw new LLMConfigurationError({
        code: 'REASONING_EFFORT_UNSUPPORTED',
        model,
        requestedEffort: requested,
        supportedEfforts: supported,
      });
    }
  }

  /** Esfuerzos soportados por un modo; vacío si el modelo no tiene combinación. */
  private supportedEfforts(
    model: string,
    kind: 'efforts' | 'toolEfforts',
  ): string[] {
    return this.findCombination(model)?.[kind] ?? [];
  }

  /**
   * Con razonamiento activo el modelo rechaza `temperature` (400, R2 de WI-CORE-031). Si la
   * configuración la pidió, falla de forma explícita: nunca la omite en silencio. `supported` son
   * los esfuerzos del modo; en el error se informan solo los compatibles con temperatura.
   */
  private assertTemperatureCompatible(
    model: string,
    temperature: number | null,
    effort: string | null,
    supported: string[],
  ): void {
    if (temperature === null || !hasActiveReasoning(effort)) {
      return;
    }
    throw new LLMConfigurationError(
      {
        code: 'TEMPERATURE_UNSUPPORTED_WITH_REASONING',
        model,
        requestedEffort: effort,
        supportedEfforts: supported.filter((level) => !hasActiveReasoning(level)),
        temperature,
      },
      `La temperatura ${temperature} no es compatible con razonamiento activo (esfuerzo "${effort}") del modelo "${model}"; use esfuerzo "none" o quite la temperatura.`,
    );
  }

  private findCombination(model: string): LLMSupportedCombination | undefined {
    return this.supportedCombinations().find(
      (combination) => combination.model === model,
    );
  }

  private supportedCombinations(): LLMSupportedCombination[] {
    const raw = this.configService.get<string>('LLM_SUPPORTED_COMBINATIONS');
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as LLMSupportedCombination[];
  }

  private async confirmModel(model: string): Promise<string> {
    try {
      const retrieved = await this.getClient().models.retrieve(model);
      return retrieved.id;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error desconocido.';
      this.logger.warn(`El modelo "${model}" no está disponible: ${message}`);
      throw new LLMConfigurationError({
        code: 'MODEL_UNAVAILABLE',
        model,
        requestedEffort: null,
        supportedEfforts: [],
      });
    }
  }

  /**
   * Llama a `responses.create` y clasifica el resultado. Un fallo de transporte o HTTP
   * se clasifica por `isExternalProviderFailure`. Una respuesta HTTP 200 con
   * `status: 'failed'` es externa solo si su código es de servidor o límite de tasa;
   * `incomplete` (p. ej. `max_output_tokens` agotado) nunca es externa ni devuelve contenido.
   */
  private async createResponse(
    params: ResponseCreateParamsNonStreaming,
    model: string,
  ): Promise<OpenAiResponse> {
    let response: OpenAiResponse;
    try {
      response = await this.getClient().responses.create(params);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error desconocido.';
      this.logger.warn(`Fallo al generar con el modelo "${model}": ${message}`);

      throw new LLMProviderUnavailableError(
        message,
        isExternalProviderFailure(error),
      );
    }

    if (response.status === 'failed') {
      const code = response.error?.code ?? null;
      const message =
        response.error?.message ??
        'El proveedor devolvió una respuesta fallida.';
      this.logger.warn(
        `Respuesta fallida del modelo "${model}": ${code ?? 'sin código'}`,
      );

      throw new LLMProviderUnavailableError(
        message,
        code !== null && EXTERNAL_RESPONSE_ERROR_CODES.has(code),
      );
    }

    if (response.status !== undefined && response.status !== 'completed') {
      const reason = response.incomplete_details?.reason ?? response.status;
      this.logger.warn(`Respuesta incompleta del modelo "${model}": ${reason}`);

      throw new LLMProviderUnavailableError(
        `Respuesta incompleta: ${reason}.`,
        false,
      );
    }

    return response;
  }

  private getClient(): OpenAI {
    this.client ??= createOpenAiClient(this.configService);
    return this.client;
  }
}

/**
 * Clasificación externa para reintentos de experimentos (WI-CORE-025, plan punto 6):
 * error de conexión o timeout de red del SDK, HTTP 429 o HTTP 5xx. Otros 4xx, respuestas
 * inválidas y errores no reconocidos no son externos.
 */
function isExternalProviderFailure(error: unknown): boolean {
  if (error instanceof APIConnectionError) return true;
  if (error instanceof APIError) {
    return (
      error.status === 429 ||
      (typeof error.status === 'number' && error.status >= 500)
    );
  }
  return false;
}

/** Razonamiento solo si el esfuerzo es explícito; `null` omite `reasoning` e `include`. */
function reasoningParams(
  effort: string | null,
): Pick<ResponseCreateParamsNonStreaming, 'reasoning' | 'include'> {
  return effort === null
    ? {}
    : {
        reasoning: { effort: effort as ReasoningEffort },
        include: ['reasoning.encrypted_content'],
      };
}

/** Razonamiento activo: esfuerzo distinto de `null` y de `none` (WI-CORE-031, R2). */
function hasActiveReasoning(effort: string | null): boolean {
  return effort !== null && effort !== 'none';
}

/**
 * `temperature` solo si no es `null` y no hay razonamiento activo. Con razonamiento activo el
 * modelo responde 400, así que nunca se envía (la configuración pedida ya falló en
 * `assertTemperatureCompatible`).
 */
function temperatureParam(
  temperature: number | null,
  effort: string | null,
): Pick<ResponseCreateParamsNonStreaming, 'temperature'> {
  return temperature !== null && !hasActiveReasoning(effort)
    ? { temperature }
    : {};
}

function highestEffort(efforts: string[]): string | null {
  let best: string | null = null;
  let bestRank = -1;
  for (const effort of efforts) {
    const rank = REASONING_EFFORT_SCALE.indexOf(effort);
    if (rank > bestRank) {
      best = effort;
      bestRank = rank;
    }
  }
  return best;
}

function optionalNumber(raw: string | undefined): number | null {
  return raw === undefined || raw === '' ? null : Number(raw);
}

/** Texto de los ítems `message` (partes `output_text`); no usa el helper `output_text` del SDK. */
function outputText(output: ResponseOutputItem[] | undefined): string {
  return (output ?? [])
    .flatMap((item) =>
      item.type === 'message'
        ? item.content.flatMap((part) =>
            part.type === 'output_text' ? [part.text] : [],
          )
        : [],
    )
    .join('');
}

/**
 * Mapea un mensaje neutro a ítems de `input`. Un assistant con `providerItems` se reenvía
 * tal cual (razonamiento cifrado, mensajes y llamadas); sin ellos se sintetiza un mensaje
 * más un `function_call` por herramienta, con `call_id` = `LLMToolCall.id`.
 */
function toResponseInputItems(message: LLMMessage): ResponseInputItem[] {
  switch (message.role) {
    case 'system':
      return [{ role: 'system', content: message.content }];
    case 'user':
      return [{ role: 'user', content: message.content }];
    case 'assistant': {
      if (message.providerItems !== undefined) {
        return message.providerItems as ResponseInputItem[];
      }
      const items: ResponseInputItem[] = [];
      if (message.content !== null && message.content !== '') {
        items.push({ role: 'assistant', content: message.content });
      }
      for (const call of message.toolCalls ?? []) {
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      return items;
    }
    case 'tool':
      return [
        {
          type: 'function_call_output',
          call_id: message.toolCallId,
          output: message.content,
        },
      ];
  }
}

/**
 * Herramienta con `strict: true`. Un esquema que no cumple las reglas de Responses es un
 * error de programación: se lanza antes de llamar a la API.
 */
function toFunctionTool(tool: LLMToolDefinition): FunctionTool {
  const violations = strictToolSchemaViolations(tool.parameters);
  if (violations.length > 0) {
    throw new Error(
      `Esquema de herramienta "${tool.name}" no cumple strict: ${violations.join(' ')}`,
    );
  }
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  };
}
