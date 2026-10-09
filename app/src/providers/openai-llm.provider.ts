import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { LLMConfigurationError } from './llm-configuration.error.js';
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

const DEFAULT_EXPERIMENT_MODEL = 'gpt-6-luna';
/** Escala para elegir el esfuerzo máximo soportado (de menor a mayor). */
const REASONING_EFFORT_SCALE = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

/** Combinación soportada: `efforts` aplica a generate, `toolEfforts` a generateWithTools. */
export interface LLMSupportedCombination {
  model: string;
  efforts: string[];
  toolEfforts: string[];
}

type ReasoningEffortParam = ChatCompletionCreateParamsNonStreaming['reasoning_effort'];

@Injectable()
export class OpenAiLLMProvider implements LLMProvider {
  private readonly logger = new Logger(OpenAiLLMProvider.name);
  private client: OpenAI | undefined;

  constructor(private readonly configService: ConfigService) {}

  async generate(prompt: string, config?: LLMEffectiveConfig): Promise<LLMGenerationResult> {
    let model: string;
    let reasoningEffort: string | null;

    if (config) {
      this.assertSupported(config.model, config.reasoningEffort, 'efforts');
      model = config.model;
      reasoningEffort = config.reasoningEffort;
    } else {
      model = this.configService.get<string>('LLM_MODEL', 'gpt-4o-mini');
      reasoningEffort = this.configService.get<string>('LLM_REASONING_EFFORT') || null;
    }

    const params: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: [{ role: 'user', content: prompt }],
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort as ReasoningEffortParam } : {}),
      ...(config?.temperature != null ? { temperature: config.temperature } : {}),
      ...(config?.maxOutputTokens != null ? { max_completion_tokens: config.maxOutputTokens } : {}),
    };

    const response = await this.complete(params, model);

    return {
      content: response.choices[0]?.message?.content ?? '',
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
    };
  }

  async generateWithTools(
    messages: LLMMessage[],
    tools: LLMToolDefinition[],
    config: LLMEffectiveConfig,
  ): Promise<LLMToolsResult> {
    this.assertSupported(config.model, config.reasoningEffort, 'toolEfforts');

    const params: ChatCompletionCreateParamsNonStreaming = {
      model: config.model,
      messages: messages.map(toOpenAiMessage),
      ...(tools.length > 0
        ? { tools: tools.map(toOpenAiTool), tool_choice: 'auto' as const }
        : {}),
      ...(config.reasoningEffort
        ? { reasoning_effort: config.reasoningEffort as ReasoningEffortParam }
        : {}),
      ...(config.temperature != null ? { temperature: config.temperature } : {}),
      ...(config.maxOutputTokens != null ? { max_completion_tokens: config.maxOutputTokens } : {}),
    };

    const response = await this.complete(params, config.model);
    const message = response.choices[0]?.message;
    const toolCalls: LLMToolCall[] = (message?.tool_calls ?? []).flatMap((call) =>
      call.type === 'function'
        ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments }]
        : [],
    );

    return {
      content: message?.content ?? '',
      toolCalls,
      assistantMessage: {
        role: 'assistant',
        content: message?.content ?? null,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
    };
  }

  async resolveEffectiveConfig(): Promise<LLMEffectiveConfig> {
    const model = this.configService.get<string>('EXPERIMENT_LLM_MODEL', DEFAULT_EXPERIMENT_MODEL);
    const combination = this.findCombination(model);
    const common = combination
      ? combination.efforts.filter((effort) => combination.toolEfforts.includes(effort))
      : [];
    const requested = this.configService.get<string>('EXPERIMENT_LLM_REASONING_EFFORT') || null;

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

    const modelVersion = await this.confirmModel(model);

    return {
      provider: 'openai',
      model,
      modelVersion,
      reasoningEffort,
      temperature: optionalNumber(this.configService.get<string>('EXPERIMENT_LLM_TEMPERATURE')),
      maxOutputTokens: optionalNumber(
        this.configService.get<string>('EXPERIMENT_LLM_MAX_OUTPUT_TOKENS'),
      ),
    };
  }

  private assertSupported(
    model: string,
    requested: string | null,
    kind: 'efforts' | 'toolEfforts',
  ): void {
    const combination = this.findCombination(model);
    const supported = combination?.[kind] ?? [];

    if (!combination || (requested !== null && !supported.includes(requested))) {
      throw new LLMConfigurationError({
        code: 'REASONING_EFFORT_UNSUPPORTED',
        model,
        requestedEffort: requested,
        supportedEfforts: supported,
      });
    }
  }

  private findCombination(model: string): LLMSupportedCombination | undefined {
    return this.supportedCombinations().find((combination) => combination.model === model);
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
      const message = error instanceof Error ? error.message : 'Error desconocido.';
      this.logger.warn(`El modelo "${model}" no está disponible: ${message}`);
      throw new LLMConfigurationError({
        code: 'MODEL_UNAVAILABLE',
        model,
        requestedEffort: null,
        supportedEfforts: [],
      });
    }
  }

  private async complete(
    params: ChatCompletionCreateParamsNonStreaming,
    model: string,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    try {
      return await this.getClient().chat.completions.create(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido.';
      this.logger.warn(`Fallo al generar con el modelo "${model}": ${message}`);

      throw new AppException(
        ErrorCode.LLM_PROVIDER_UNAVAILABLE,
        'El proveedor de LLM no respondió correctamente.',
        HttpStatus.SERVICE_UNAVAILABLE,
        message,
      );
    }
  }

  private getClient(): OpenAI {
    this.client ??= createOpenAiClient(this.configService);
    return this.client;
  }
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

function toOpenAiMessage(message: LLMMessage): OpenAI.Chat.ChatCompletionMessageParam {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };
    case 'user':
      return { role: 'user', content: message.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
}

function toOpenAiTool(tool: LLMToolDefinition): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
