import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ErrorCode } from '../../common/errors/error-code.enum.js';

const createMock = vi.fn();

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

const { GeneralistAgentService } =
  await import('./generalist-agent.service.js');

function makeConfigService(overrides: Record<string, unknown> = {}) {
  return {
    get: (key: string, fallback?: unknown) =>
      key in overrides ? overrides[key] : (fallback ?? undefined),
  } as never;
}

function makeTools(
  dispatchImpl: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>,
) {
  return { dispatch: vi.fn(dispatchImpl) } as never;
}

function toolCallMessage(name: string, args: Record<string, unknown>) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call-1',
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('GeneralistAgentService', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('returns the final content directly when the model answers without tool calls', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'export function test() {}',
            tool_calls: undefined,
          },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });

    const service = new GeneralistAgentService(makeConfigService());
    const tools = makeTools(async () => 'unused');

    const result = await service.generate('prompt', tools, 5);

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
    createMock
      .mockResolvedValueOnce({
        choices: [{ message: toolCallMessage('list_files', {}) }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: toolCallMessage('read_file', {
              relativePath: 'src/foo.ts',
            }),
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: 'final test code', tool_calls: undefined } },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

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
        : {
            result: readResult,
            status: 'SUCCEEDED' as const,
            observations: [],
          },
    );
    const tools = { dispatchWithObservations } as never;
    const callback = vi.fn();

    const service = new GeneralistAgentService(makeConfigService());
    const result = await service.generate('prompt', tools, 5, callback);

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
    expect(
      createMock.mock.calls[2][0].messages
        .filter((message: { role: string }) => message.role === 'tool')
        .map((message: { content?: unknown }) => message.content),
    ).toEqual([listResult, readResult]);
  });

  it('hashes the exact long tool result, bounds the stored summary, and sends the full result to the model', async () => {
    const longResult = 'source line\n'.repeat(250);
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: toolCallMessage('read_file', {
              relativePath: 'src/foo.ts',
            }),
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'done', tool_calls: undefined } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    const tools = {
      dispatchWithObservations: vi.fn(async () => ({
        result: longResult,
        status: 'SUCCEEDED' as const,
        observations: [],
      })),
    } as never;

    const service = new GeneralistAgentService(makeConfigService());
    const response = await service.generate('prompt', tools, 5);

    expect(response.trajectory[0].resultSummary).toBe(
      longResult.slice(0, 2_000),
    );
    expect(response.trajectory[0].resultSha256).toBe(sha256(longResult));
    expect(response.trajectory[0].truncated).toBe(true);
    expect(
      createMock.mock.calls[1][0].messages
        .filter((message: { role: string }) => message.role === 'tool')
        .map((message: { content?: unknown }) => message.content),
    ).toEqual([longResult]);
  });

  it('records dispatch exceptions as FAILED and empty tool output as EMPTY', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [
          {
            message: toolCallMessage('read_file', {
              relativePath: 'src/missing.ts',
            }),
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
      .mockResolvedValueOnce({
        choices: [
          { message: toolCallMessage('search_text', { query: 'absent' }) },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'done', tool_calls: undefined } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    const tools = {
      dispatchWithObservations: vi
        .fn()
        .mockRejectedValueOnce(new Error('private source must not be logged'))
        .mockResolvedValueOnce({
          result: '',
          status: 'EMPTY' as const,
          observations: [],
        }),
    } as never;
    const service = new GeneralistAgentService(makeConfigService());

    const response = await service.generate('prompt', tools, 5);

    expect(
      response.trajectory.map(({ status, resultSummary }) => [
        status,
        resultSummary,
      ]),
    ).toEqual([
      ['FAILED', 'No se pudo ejecutar la herramienta.'],
      ['EMPTY', ''],
    ]);
    expect(response.trajectory[0].resultSha256).toBe(
      sha256('No se pudo ejecutar la herramienta.'),
    );
    expect(
      createMock.mock.calls[2][0].messages
        .filter((message: { role: string }) => message.role === 'tool')
        .map((message: { content?: unknown }) => message.content),
    ).toEqual(['No se pudo ejecutar la herramienta.', '']);
  });

  it('forces a final answer once maxToolCalls is reached', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [{ message: toolCallMessage('search_text', { query: 'x' }) }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: { content: 'forced final answer', tool_calls: undefined },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      });

    const tools = makeTools(async () => 'match found');
    const service = new GeneralistAgentService(makeConfigService());

    const result = await service.generate('prompt', tools, 1);

    expect(result.content).toBe('forced final answer');
    expect(createMock).toHaveBeenCalledTimes(2);
    const lastCallArgs = createMock.mock.calls[1][0];
    expect(lastCallArgs.messages.at(-1).content).toContain(
      'límite de herramientas',
    );
  });

  it('forces reasoning_effort "none" on tool-calling requests when a reasoning model is configured (OpenAI rejects tools+reasoning otherwise)', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [{ message: toolCallMessage('list_files', {}) }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: 'final test code', tool_calls: undefined } },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

    const tools = makeTools(async () => 'src/foo.ts');
    const service = new GeneralistAgentService(
      makeConfigService({ LLM_REASONING_EFFORT: 'high' }),
    );

    await service.generate('prompt', tools, 5);

    expect(createMock.mock.calls[0][0]).toMatchObject({
      tools: expect.anything(),
      reasoning_effort: 'none',
    });
  });

  it('never sends reasoning_effort when the configured model does not support it', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'x', tool_calls: undefined } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const tools = makeTools(async () => '');
    const service = new GeneralistAgentService(makeConfigService());

    await service.generate('prompt', tools, 5);

    expect(createMock.mock.calls[0][0]).not.toHaveProperty('reasoning_effort');
  });

  it('wraps a provider failure as LLM_PROVIDER_UNAVAILABLE', async () => {
    createMock.mockRejectedValue(new Error('network down'));

    const tools = makeTools(async () => '');
    const service = new GeneralistAgentService(makeConfigService());

    await expect(service.generate('prompt', tools, 3)).rejects.toMatchObject({
      code: ErrorCode.LLM_PROVIDER_UNAVAILABLE,
    });
  });
});
