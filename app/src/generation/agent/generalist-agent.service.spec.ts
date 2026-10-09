import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { LLMConfigurationError } from '../../providers/llm-configuration.error.js';
import type { LLMEffectiveConfig } from '../../providers/llm-provider.interface.js';
import { countTokens } from 'gpt-tokenizer/encoding/cl100k_base';
import { AGENT_TOOL_SCHEMAS } from './workspace-agent-tools.js';

const { GeneralistAgentService } = await import('./generalist-agent.service.js');

function limits(toolCallCap: number, contextTokenBudget = 8000) {
  return { toolCallCap, contextTokenBudget };
}

const TOOL_CAP_MESSAGE = 'Límite de herramientas alcanzado. No se ejecutó esta llamada.';
const BUDGET_MARKER = '\n... (truncado por presupuesto de contexto)';

const config: LLMEffectiveConfig = {
  provider: 'openai',
  model: 'gpt-6-luna',
  modelVersion: 'gpt-6-luna-2026',
  reasoningEffort: 'xhigh',
  temperature: null,
  maxOutputTokens: null,
};

function makeProvider() {
  return {
    generate: vi.fn(),
    generateWithTools: vi.fn(),
    resolveEffectiveConfig: vi.fn(),
  };
}

function makeTools(
  dispatchImpl: (name: string, args: Record<string, unknown>) => Promise<string>,
) {
  return { dispatch: vi.fn(dispatchImpl) } as never;
}

function toolCallResponse(name: string, args: Record<string, unknown>, usage = { in: 1, out: 1 }) {
  const toolCalls = [{ id: 'call-1', name, arguments: JSON.stringify(args) }];
  return {
    content: '',
    toolCalls,
    assistantMessage: { role: 'assistant', content: null, toolCalls },
    inputTokens: usage.in,
    outputTokens: usage.out,
  };
}

function finalResponse(content: string, usage = { in: 1, out: 1 }) {
  return {
    content,
    toolCalls: [],
    assistantMessage: { role: 'assistant', content },
    inputTokens: usage.in,
    outputTokens: usage.out,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function toolMessages(call: unknown[]): unknown[] {
  return (call[0] as Array<{ role: string; content?: unknown }>)
    .filter((message) => message.role === 'tool')
    .map((message) => message.content);
}

describe('GeneralistAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the final content directly when the model answers without tool calls', async () => {
    const provider = makeProvider();
    provider.generateWithTools.mockResolvedValue(finalResponse('export function test() {}', { in: 20, out: 10 }));

    const service = new GeneralistAgentService(provider as never);
    const result = await service.generate('prompt', makeTools(async () => 'unused'), limits(5), config);

    expect(result).toEqual({
      content: 'export function test() {}',
      trajectory: [],
      toolCallCount: 0,
      filesInspected: 0,
      inputTokens: 20,
      outputTokens: 10,
      contextTokensDelivered: 0,
      toolCallCap: 5,
      contextTokenBudget: 8000,
      capReached: false,
      truncatedSteps: 0,
    });
  });

  it('executes tool calls, records the trajectory and tracks distinct files read', async () => {
    const provider = makeProvider();
    provider.generateWithTools
      .mockResolvedValueOnce(toolCallResponse('list_files', {}, { in: 10, out: 5 }))
      .mockResolvedValueOnce(toolCallResponse('read_file', { relativePath: 'src/foo.ts' }, { in: 10, out: 5 }))
      .mockResolvedValueOnce(finalResponse('final test code', { in: 10, out: 5 }));

    const listResult = 'src/foo.ts';
    const readResult = 'content of foo';
    const dispatchWithObservations = vi.fn(async (name: string) =>
      name === 'list_files'
        ? {
            result: listResult,
            status: 'SUCCEEDED' as const,
            observations: [
              {
                kind: 'FILE_LIST_SUMMARY' as const,
                filePath: null,
                symbolName: null,
                excerpt: null,
                discoveredFilesCount: 1,
              },
            ],
            discoveredFiles: ['src/foo.ts'],
          }
        : { result: readResult, status: 'SUCCEEDED' as const, observations: [] },
    );
    const tools = { dispatchWithObservations } as never;
    const callback = vi.fn();

    const service = new GeneralistAgentService(provider as never);
    const result = await service.generate('prompt', tools, limits(5), config, callback);

    expect(result.content).toBe('final test code');
    expect(result.toolCallCount).toBe(2);
    expect(result.filesInspected).toBe(1);
    expect(result.trajectory).toEqual([
      {
        step: 1,
        toolName: 'list_files',
        arguments: {},
        status: 'SUCCEEDED',
        resultSummary: 'Listado disponible: 1 archivos.',
        resultSha256: sha256(listResult),
        truncated: true,
        contextTokens: countTokens(listResult),
        truncationReason: 'CHAR_LIMIT',
        observations: [
          {
            kind: 'FILE_LIST_SUMMARY',
            filePath: null,
            symbolName: null,
            excerpt: null,
            discoveredFilesCount: 1,
          },
        ],
      },
      {
        step: 2,
        toolName: 'read_file',
        arguments: { relativePath: 'src/foo.ts' },
        status: 'SUCCEEDED',
        resultSummary: readResult,
        resultSha256: sha256(readResult),
        truncated: false,
        contextTokens: countTokens(readResult),
        truncationReason: null,
        observations: [],
      },
    ]);
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(15);
    expect(dispatchWithObservations).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls.map(([event]) => event)).toEqual([
      { step: result.trajectory[0], discoveredFiles: ['src/foo.ts'] },
      { step: result.trajectory[1], discoveredFiles: [] },
    ]);
    expect(JSON.stringify(result.trajectory[0])).not.toContain('src/foo.ts');
    expect(toolMessages(provider.generateWithTools.mock.calls[2])).toEqual([listResult, readResult]);
  });

  it('hashes the exact long tool result, bounds the stored summary, and sends the full result to the model', async () => {
    const longResult = 'source line\n'.repeat(250);
    const provider = makeProvider();
    provider.generateWithTools
      .mockResolvedValueOnce(toolCallResponse('read_file', { relativePath: 'src/foo.ts' }))
      .mockResolvedValueOnce(finalResponse('done'));
    const tools = {
      dispatchWithObservations: vi.fn(async () => ({
        result: longResult,
        status: 'SUCCEEDED' as const,
        observations: [],
      })),
    } as never;

    const service = new GeneralistAgentService(provider as never);
    const response = await service.generate('prompt', tools, limits(5), config);

    expect(response.trajectory[0].resultSummary).toBe(longResult.slice(0, 2_000));
    expect(response.trajectory[0].resultSha256).toBe(sha256(longResult));
    expect(response.trajectory[0].truncated).toBe(true);
    expect(response.trajectory[0].truncationReason).toBe('CHAR_LIMIT');
    expect(toolMessages(provider.generateWithTools.mock.calls[1])).toEqual([longResult]);
  });

  it('dispatches only the calls that fit the cap in a multi-call turn and answers the rest with a fixed message', async () => {
    const provider = makeProvider();
    const toolCalls = [
      { id: 'c1', name: 'search_text', arguments: '{"query":"a"}' },
      { id: 'c2', name: 'search_text', arguments: '{"query":"b"}' },
      { id: 'c3', name: 'read_file', arguments: '{"relativePath":"src/x.ts"}' },
    ];
    provider.generateWithTools
      .mockResolvedValueOnce({
        content: '',
        toolCalls,
        assistantMessage: { role: 'assistant', content: null, toolCalls },
        inputTokens: 1,
        outputTokens: 1,
      })
      .mockResolvedValueOnce(finalResponse('final'));
    const dispatch = vi.fn(async (name: string, args: Record<string, unknown>) => `res-${String(args.query)}`);

    const service = new GeneralistAgentService(provider as never);
    const result = await service.generate('prompt', makeTools(dispatch), limits(2), config);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.trajectory.map((step) => step.toolName)).toEqual(['search_text', 'search_text']);
    expect(result.toolCallCount).toBe(2);
    expect(result.capReached).toBe(true);
    expect(provider.generateWithTools).toHaveBeenCalledTimes(2);
    expect(toolMessages(provider.generateWithTools.mock.calls[1])).toEqual([
      'res-a',
      'res-b',
      TOOL_CAP_MESSAGE,
    ]);
    expect(provider.generateWithTools.mock.calls[1][1]).toEqual([]);
    expect(provider.generateWithTools.mock.calls[1][2]).toBe(config);
  });

  it('does not make an extra call when the model answers without tools before the cap', async () => {
    const provider = makeProvider();
    provider.generateWithTools
      .mockResolvedValueOnce(toolCallResponse('search_text', { query: 'x' }))
      .mockResolvedValueOnce(finalResponse('done early'));

    const service = new GeneralistAgentService(provider as never);
    const result = await service.generate('prompt', makeTools(async () => 'hit'), limits(3), config);

    expect(provider.generateWithTools).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ content: 'done early', capReached: false, toolCallCap: 3 });
  });

  it('truncates a result to the remaining context budget, hashes the delivered text and marks the step', async () => {
    const longResult = 'palabra '.repeat(300);
    const provider = makeProvider();
    provider.generateWithTools
      .mockResolvedValueOnce(toolCallResponse('read_file', { relativePath: 'src/foo.ts' }))
      .mockResolvedValueOnce(finalResponse('done'));
    const tools = {
      dispatchWithObservations: vi.fn(async () => ({
        result: longResult,
        status: 'SUCCEEDED' as const,
        observations: [],
      })),
    } as never;

    const service = new GeneralistAgentService(provider as never);
    const response = await service.generate('prompt', tools, limits(5, 20), config);

    const [delivered] = toolMessages(provider.generateWithTools.mock.calls[1]) as string[];
    expect(delivered.endsWith(BUDGET_MARKER)).toBe(true);
    expect(countTokens(delivered.slice(0, -BUDGET_MARKER.length))).toBeLessThanOrEqual(20);
    expect(response.trajectory[0]).toMatchObject({
      truncated: true,
      truncationReason: 'CONTEXT_BUDGET',
      contextTokens: 20,
      resultSha256: sha256(delivered),
    });
    expect(response.trajectory[0].resultSha256).not.toBe(sha256(longResult));
    expect(response).toMatchObject({
      contextTokensDelivered: 20,
      contextTokenBudget: 20,
      truncatedSteps: 1,
    });
  });

  it('delivers only the budget marker once the context budget is exhausted', async () => {
    const provider = makeProvider();
    provider.generateWithTools
      .mockResolvedValueOnce({
        content: '',
        toolCalls: [
          { id: 'c1', name: 'search_text', arguments: '{"query":"a"}' },
          { id: 'c2', name: 'search_text', arguments: '{"query":"b"}' },
        ],
        assistantMessage: { role: 'assistant', content: null },
        inputTokens: 1,
        outputTokens: 1,
      })
      .mockResolvedValueOnce(finalResponse('done'));

    const service = new GeneralistAgentService(provider as never);
    const response = await service.generate(
      'prompt',
      makeTools(async () => 'algun texto de resultado'),
      limits(2, countTokens('algun texto de resultado')),
      config,
    );

    expect(toolMessages(provider.generateWithTools.mock.calls[1])).toEqual([
      'algun texto de resultado',
      BUDGET_MARKER,
    ]);
    expect(response.trajectory[1]).toMatchObject({
      contextTokens: 0,
      truncationReason: 'CONTEXT_BUDGET',
      truncated: true,
    });
    expect(response.contextTokensDelivered).toBe(countTokens('algun texto de resultado'));
  });

  it('records dispatch exceptions as FAILED and empty tool output as EMPTY', async () => {
    const provider = makeProvider();
    provider.generateWithTools
      .mockResolvedValueOnce(toolCallResponse('read_file', { relativePath: 'src/missing.ts' }))
      .mockResolvedValueOnce(toolCallResponse('search_text', { query: 'absent' }))
      .mockResolvedValueOnce(finalResponse('done'));
    const tools = {
      dispatchWithObservations: vi
        .fn()
        .mockRejectedValueOnce(new Error('private source must not be logged'))
        .mockResolvedValueOnce({ result: '', status: 'EMPTY' as const, observations: [] }),
    } as never;

    const service = new GeneralistAgentService(provider as never);
    const response = await service.generate('prompt', tools, limits(5), config);

    expect(
      response.trajectory.map(({ status, resultSummary }) => [status, resultSummary]),
    ).toEqual([
      ['FAILED', 'No se pudo ejecutar la herramienta.'],
      ['EMPTY', ''],
    ]);
    expect(response.trajectory[0].resultSha256).toBe(sha256('No se pudo ejecutar la herramienta.'));
    expect(toolMessages(provider.generateWithTools.mock.calls[2])).toEqual([
      'No se pudo ejecutar la herramienta.',
      '',
    ]);
  });

  it('forces a final answer without tools once maxToolCalls is reached', async () => {
    const provider = makeProvider();
    provider.generateWithTools
      .mockResolvedValueOnce(toolCallResponse('search_text', { query: 'x' }, { in: 5, out: 5 }))
      .mockResolvedValueOnce(finalResponse('forced final answer', { in: 5, out: 5 }));

    const service = new GeneralistAgentService(provider as never);
    const result = await service.generate('prompt', makeTools(async () => 'match found'), limits(1), config);

    expect(result.content).toBe('forced final answer');
    expect(result.capReached).toBe(true);
    expect(provider.generateWithTools).toHaveBeenCalledTimes(2);
    const [messages, tools] = provider.generateWithTools.mock.calls[1];
    expect(messages.at(-1).content).toContain('límite de herramientas');
    expect(tools).toEqual([]);
  });

  it('passes the same effective config to every call, including the final one, without forcing none', async () => {
    const provider = makeProvider();
    provider.generateWithTools
      .mockResolvedValueOnce(toolCallResponse('list_files', {}))
      .mockResolvedValueOnce(finalResponse('done'));

    const service = new GeneralistAgentService(provider as never);
    await service.generate('prompt', makeTools(async () => 'src/foo.ts'), limits(5), config);

    for (const call of provider.generateWithTools.mock.calls) {
      expect(call[2]).toBe(config);
      expect(call[2].reasoningEffort).toBe('xhigh');
    }
  });

  it('exposes the agent tool schemas to the provider as neutral definitions', async () => {
    const provider = makeProvider();
    provider.generateWithTools.mockResolvedValue(finalResponse('done'));

    const service = new GeneralistAgentService(provider as never);
    await service.generate('prompt', makeTools(async () => ''), limits(5), config);

    const definitions = provider.generateWithTools.mock.calls[0][1] as Array<{ name: string }>;
    expect(definitions.map((tool) => tool.name)).toEqual(
      AGENT_TOOL_SCHEMAS.map((schema) => schema.function.name),
    );
  });

  it('propagates LLMConfigurationError unchanged without wrapping it', async () => {
    const provider = makeProvider();
    const configurationError = new LLMConfigurationError({
      code: 'REASONING_EFFORT_UNSUPPORTED',
      model: 'gpt-6-luna',
      requestedEffort: 'xhigh',
      supportedEfforts: ['low'],
    });
    provider.generateWithTools.mockRejectedValue(configurationError);

    const service = new GeneralistAgentService(provider as never);

    await expect(service.generate('prompt', makeTools(async () => ''), limits(3), config)).rejects.toBe(
      configurationError,
    );
  });

  it('wraps a provider failure as LLM_PROVIDER_UNAVAILABLE', async () => {
    const provider = makeProvider();
    provider.generateWithTools.mockRejectedValue(new Error('network down'));

    const service = new GeneralistAgentService(provider as never);

    await expect(service.generate('prompt', makeTools(async () => ''), limits(3), config)).rejects.toMatchObject({
      code: ErrorCode.LLM_PROVIDER_UNAVAILABLE,
    });
  });
});
