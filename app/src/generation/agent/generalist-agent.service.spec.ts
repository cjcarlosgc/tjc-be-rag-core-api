import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { LLMConfigurationError } from '../../providers/llm-configuration.error.js';
import type { LLMEffectiveConfig } from '../../providers/llm-provider.interface.js';
import { AGENT_TOOL_SCHEMAS } from './workspace-agent-tools.js';

const { GeneralistAgentService } = await import('./generalist-agent.service.js');

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
    const result = await service.generate('prompt', makeTools(async () => 'unused'), 5, config);

    expect(result).toEqual({
      content: 'export function test() {}',
      trajectory: [],
      toolCallCount: 0,
      filesInspected: 0,
      inputTokens: 20,
      outputTokens: 10,
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
    const result = await service.generate('prompt', tools, 5, config, callback);

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
    const response = await service.generate('prompt', tools, 5, config);

    expect(response.trajectory[0].resultSummary).toBe(longResult.slice(0, 2_000));
    expect(response.trajectory[0].resultSha256).toBe(sha256(longResult));
    expect(response.trajectory[0].truncated).toBe(true);
    expect(toolMessages(provider.generateWithTools.mock.calls[1])).toEqual([longResult]);
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
    const response = await service.generate('prompt', tools, 5, config);

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
    const result = await service.generate('prompt', makeTools(async () => 'match found'), 1, config);

    expect(result.content).toBe('forced final answer');
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
    await service.generate('prompt', makeTools(async () => 'src/foo.ts'), 5, config);

    for (const call of provider.generateWithTools.mock.calls) {
      expect(call[2]).toBe(config);
      expect(call[2].reasoningEffort).toBe('xhigh');
    }
  });

  it('exposes the agent tool schemas to the provider as neutral definitions', async () => {
    const provider = makeProvider();
    provider.generateWithTools.mockResolvedValue(finalResponse('done'));

    const service = new GeneralistAgentService(provider as never);
    await service.generate('prompt', makeTools(async () => ''), 5, config);

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

    await expect(service.generate('prompt', makeTools(async () => ''), 3, config)).rejects.toBe(
      configurationError,
    );
  });

  it('wraps a provider failure as LLM_PROVIDER_UNAVAILABLE', async () => {
    const provider = makeProvider();
    provider.generateWithTools.mockRejectedValue(new Error('network down'));

    const service = new GeneralistAgentService(provider as never);

    await expect(service.generate('prompt', makeTools(async () => ''), 3, config)).rejects.toMatchObject({
      code: ErrorCode.LLM_PROVIDER_UNAVAILABLE,
    });
  });
});
