import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { createOpenAiClient } from '../../providers/openai-client.factory.js';
import { AGENT_TOOL_SCHEMAS, type WorkspaceAgentTools } from './workspace-agent-tools.js';

export interface AgentTrajectoryStep {
  toolName: string;
  arguments: Record<string, unknown>;
  result: string;
}

export interface AgentGenerationResult {
  content: string;
  trajectory: AgentTrajectoryStep[];
  toolCallCount: number;
  filesInspected: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

const MAX_RESULT_CHARS = 2000;

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

@Injectable()
export class GeneralistAgentService {
  private readonly logger = new Logger(GeneralistAgentService.name);
  private client: OpenAI | undefined;

  constructor(private readonly configService: ConfigService) {}

  async generate(
    instructions: string,
    tools: WorkspaceAgentTools,
    maxToolCalls: number,
  ): Promise<AgentGenerationResult> {
    const client = this.getClient();
    const model = this.configService.get<string>('LLM_MODEL', 'gpt-4o-mini');
    const reasoningEffort = this.configService.get<string>('LLM_REASONING_EFFORT');
    // Los modelos con razonamiento no soportan function tools en
    // /v1/chat/completions salvo que reasoning_effort sea 'none' (400
    // invalid_request_error en caso contrario); un modelo sin razonamiento
    // rechaza el campo por completo si se lo enviamos. Por eso solo se
    // fuerza 'none' cuando el usuario configuró LLM_REASONING_EFFORT (señal
    // de que el modelo sí soporta razonamiento); el resto de las llamadas
    // (sin tools) sí usan el valor configurado normalmente.
    const toolCallReasoningEffort: ChatCompletionCreateParamsNonStreaming['reasoning_effort'] | undefined =
      reasoningEffort ? 'none' : undefined;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'user', content: instructions }];
    const trajectory: AgentTrajectoryStep[] = [];
    const filesInspected = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for (let attempt = 0; attempt < maxToolCalls; attempt += 1) {
        const response = await client.chat.completions.create({
          model,
          messages,
          tools: AGENT_TOOL_SCHEMAS,
          tool_choice: 'auto',
          ...(toolCallReasoningEffort ? { reasoning_effort: toolCallReasoningEffort } : {}),
        });

        inputTokens += response.usage?.prompt_tokens ?? 0;
        outputTokens += response.usage?.completion_tokens ?? 0;

        const message = response.choices[0]?.message;
        const toolCalls = message?.tool_calls;

        if (!message || !toolCalls || toolCalls.length === 0) {
          return {
            content: message?.content ?? '',
            trajectory,
            toolCallCount: trajectory.length,
            filesInspected: filesInspected.size,
            inputTokens,
            outputTokens,
          };
        }

        messages.push(message);

        for (const toolCall of toolCalls) {
          if (toolCall.type !== 'function') {
            continue;
          }

          const args = safeParseJson(toolCall.function.arguments);
          const result = await tools.dispatch(toolCall.function.name, args);

          trajectory.push({
            toolName: toolCall.function.name,
            arguments: args,
            result: result.slice(0, MAX_RESULT_CHARS),
          });

          if (toolCall.function.name === 'read_file' && typeof args.relativePath === 'string') {
            filesInspected.add(args.relativePath);
          }

          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
        }
      }

      const finalResponse = await client.chat.completions.create({
        model,
        messages: [
          ...messages,
          {
            role: 'user',
            content:
              'Alcanzaste el límite de herramientas disponibles. Responde ahora con el código final de la prueba: solo código TypeScript (imports + bloques de test), sin explicaciones ni más llamadas a herramientas.',
          },
        ],
        ...(reasoningEffort
          ? { reasoning_effort: reasoningEffort as ChatCompletionCreateParamsNonStreaming['reasoning_effort'] }
          : {}),
      });

      inputTokens += finalResponse.usage?.prompt_tokens ?? 0;
      outputTokens += finalResponse.usage?.completion_tokens ?? 0;

      return {
        content: finalResponse.choices[0]?.message?.content ?? '',
        trajectory,
        toolCallCount: trajectory.length,
        filesInspected: filesInspected.size,
        inputTokens,
        outputTokens,
      };
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }

      const message = error instanceof Error ? error.message : 'Error desconocido.';
      this.logger.warn(`Fallo al ejecutar el agente generalista con el modelo "${model}": ${message}`);

      throw new AppException(
        ErrorCode.LLM_PROVIDER_UNAVAILABLE,
        'El proveedor de LLM no respondió correctamente durante la exploración del agente.',
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
