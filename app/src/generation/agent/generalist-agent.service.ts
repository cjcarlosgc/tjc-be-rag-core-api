import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { LLMConfigurationError } from '../../providers/llm-configuration.error.js';
import type {
  LLMEffectiveConfig,
  LLMMessage,
  LLMProvider,
  LLMToolDefinition,
} from '../../providers/llm-provider.interface.js';
import { LLM_PROVIDER } from '../../providers/providers.constants.js';
import {
  AGENT_TOOL_SCHEMAS,
  type AgentStepStatus,
  type AgentToolDispatchResult,
  type AgentToolName,
  type AgentToolObservation,
  type WorkspaceAgentTools,
} from './workspace-agent-tools.js';

export interface AgentTrajectoryStep {
  step: number;
  toolName: AgentToolName | (string & {});
  arguments: Record<string, unknown>;
  status: AgentStepStatus;
  resultSummary: string;
  resultSha256: string;
  truncated: boolean;
  observations: AgentToolObservation[];
}

export interface AgentDiscoveredFile {
  step: number;
  filePath: string;
}

export interface AgentToolStepEvent {
  step: AgentTrajectoryStep;
  /** Full paths are separated from the summary for paged persistence. */
  discoveredFiles: string[];
}

export type AgentToolStepCallback = (
  event: AgentToolStepEvent,
) => void | Promise<void>;

export interface AgentGenerationResult {
  content: string;
  trajectory: AgentTrajectoryStep[];
  toolCallCount: number;
  filesInspected: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

const MAX_RESULT_CHARS = 2000;

const AGENT_TOOL_DEFINITIONS: LLMToolDefinition[] = AGENT_TOOL_SCHEMAS.map(
  (schema) => ({
    name: schema.function.name,
    description: schema.function.description,
    parameters: schema.function.parameters,
  }),
);

function hashResult(result: string): string {
  return createHash('sha256').update(result, 'utf8').digest('hex');
}

function normalizeFallbackResult(result: string): AgentToolDispatchResult {
  return {
    result,
    status: result.length === 0 ? 'EMPTY' : 'SUCCEEDED',
    observations: [],
  };
}

function trajectorySummary(
  toolName: string,
  execution: AgentToolDispatchResult,
): string {
  if (toolName === 'list_files') {
    const count =
      execution.observations.find((item) => item.kind === 'FILE_LIST_SUMMARY')
        ?.discoveredFilesCount ??
      execution.discoveredFiles?.length ??
      0;
    return `Listado disponible: ${count} archivos.`;
  }

  return execution.result.slice(0, MAX_RESULT_CHARS);
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Bucle de herramientas del agente generalista. Habla solo con LLMProvider:
 * no conoce el SDK ni lee configuración del modelo. La configuración efectiva
 * del experimento llega de fuera y se usa idéntica en cada llamada, incluida
 * la final sin herramientas; nunca se fuerza `none` ni se cambia el esfuerzo.
 */
@Injectable()
export class GeneralistAgentService {
  private readonly logger = new Logger(GeneralistAgentService.name);

  constructor(@Inject(LLM_PROVIDER) private readonly llmProvider: LLMProvider) {}

  async generate(
    instructions: string,
    tools: WorkspaceAgentTools,
    maxToolCalls: number,
    config: LLMEffectiveConfig,
    onToolStep?: AgentToolStepCallback,
  ): Promise<AgentGenerationResult> {
    const messages: LLMMessage[] = [{ role: 'user', content: instructions }];
    const trajectory: AgentTrajectoryStep[] = [];
    const filesInspected = new Set<string>();
    let stepNumber = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for (let attempt = 0; attempt < maxToolCalls; attempt += 1) {
        const response = await this.llmProvider.generateWithTools(
          messages,
          AGENT_TOOL_DEFINITIONS,
          config,
        );

        inputTokens += response.inputTokens ?? 0;
        outputTokens += response.outputTokens ?? 0;

        if (response.toolCalls.length === 0) {
          return {
            content: response.content,
            trajectory,
            toolCallCount: trajectory.length,
            filesInspected: filesInspected.size,
            inputTokens,
            outputTokens,
          };
        }

        messages.push(response.assistantMessage);

        for (const toolCall of response.toolCalls) {
          const args = safeParseJson(toolCall.arguments);
          stepNumber += 1;
          let execution: AgentToolDispatchResult;

          try {
            const detailedDispatch = (
              tools as WorkspaceAgentTools & {
                dispatchWithObservations?: (
                  name: string,
                  args: Record<string, unknown>,
                ) => Promise<AgentToolDispatchResult>;
              }
            ).dispatchWithObservations;
            execution = detailedDispatch
              ? await detailedDispatch.call(tools, toolCall.name, args)
              : normalizeFallbackResult(
                  await tools.dispatch(toolCall.name, args),
                );
          } catch {
            // Dispatch exceptions are represented as a safe tool result. Never
            // log or persist the exception text, which may contain source data.
            execution = {
              result: 'No se pudo ejecutar la herramienta.',
              status: 'FAILED',
              observations: [],
            };
          }

          const summary = trajectorySummary(toolCall.name, execution);
          const step: AgentTrajectoryStep = {
            step: stepNumber,
            toolName: toolCall.name,
            arguments: args,
            status: execution.status,
            resultSummary: summary,
            resultSha256: hashResult(execution.result),
            // `list_files` deliberately stores only its count; its actual paths
            // are passed separately to the callback for paged persistence.
            truncated: summary !== execution.result,
            observations: execution.observations,
          };
          trajectory.push(step);

          if (onToolStep) {
            try {
              await onToolStep({
                step,
                discoveredFiles: execution.discoveredFiles ?? [],
              });
            } catch {
              // Keep source data and callback errors out of ordinary logs.
              throw new Error(
                'No se pudo guardar la evidencia de la herramienta.',
              );
            }
          }

          if (
            toolCall.name === 'read_file' &&
            typeof args.relativePath === 'string'
          ) {
            filesInspected.add(args.relativePath);
          }

          // Keep the raw result byte-for-byte equivalent to the dispatch return
          // value. The trajectory stores only a bounded summary and its hash.
          messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: execution.result,
          });
        }
      }

      const finalResponse = await this.llmProvider.generateWithTools(
        [
          ...messages,
          {
            role: 'user',
            content:
              'Alcanzaste el límite de herramientas disponibles. Responde ahora con el código final de la prueba: solo código TypeScript (imports + bloques de test), sin explicaciones ni más llamadas a herramientas.',
          },
        ],
        [],
        config,
      );

      inputTokens += finalResponse.inputTokens ?? 0;
      outputTokens += finalResponse.outputTokens ?? 0;

      return {
        content: finalResponse.content,
        trajectory,
        toolCallCount: trajectory.length,
        filesInspected: filesInspected.size,
        inputTokens,
        outputTokens,
      };
    } catch (error) {
      // La configuración no compatible se propaga tal cual; WI-CORE-025 la mapea.
      if (error instanceof AppException || error instanceof LLMConfigurationError) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Error desconocido.';
      this.logger.warn(
        `Fallo al ejecutar el agente generalista con el modelo "${config.model}": ${message}`,
      );

      throw new AppException(
        ErrorCode.LLM_PROVIDER_UNAVAILABLE,
        'El proveedor de LLM no respondió correctamente durante la exploración del agente.',
        HttpStatus.SERVICE_UNAVAILABLE,
        message,
      );
    }
  }
}
