import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../../common/errors/error-code.enum.js';

const createMock = vi.fn();

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

const { GeneralistAgentService } = await import('./generalist-agent.service.js');

function makeConfigService() {
  return { get: (key: string, fallback?: unknown) => fallback ?? undefined } as never;
}

function makeTools(dispatchImpl: (name: string, args: Record<string, unknown>) => Promise<string>) {
  return { dispatch: vi.fn(dispatchImpl) } as never;
}

function toolCallMessage(name: string, args: Record<string, unknown>) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  };
}

describe('GeneralistAgentService', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('returns the final content directly when the model answers without tool calls', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'export function test() {}', tool_calls: undefined } }],
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
        choices: [{ message: toolCallMessage('read_file', { relativePath: 'src/foo.ts' }) }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'final test code', tool_calls: undefined } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

    const dispatch = vi.fn(async (name: string) =>
      name === 'list_files' ? 'src/foo.ts' : 'content of foo',
    );
    const tools = { dispatch } as never;

    const service = new GeneralistAgentService(makeConfigService());
    const result = await service.generate('prompt', tools, 5);

    expect(result.content).toBe('final test code');
    expect(result.toolCallCount).toBe(2);
    expect(result.filesInspected).toBe(1);
    expect(result.trajectory).toEqual([
      { toolName: 'list_files', arguments: {}, result: 'src/foo.ts' },
      { toolName: 'read_file', arguments: { relativePath: 'src/foo.ts' }, result: 'content of foo' },
    ]);
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(15);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('forces a final answer once maxToolCalls is reached', async () => {
    createMock
      .mockResolvedValueOnce({
        choices: [{ message: toolCallMessage('search_text', { query: 'x' }) }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'forced final answer', tool_calls: undefined } }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      });

    const tools = makeTools(async () => 'match found');
    const service = new GeneralistAgentService(makeConfigService());

    const result = await service.generate('prompt', tools, 1);

    expect(result.content).toBe('forced final answer');
    expect(createMock).toHaveBeenCalledTimes(2);
    const lastCallArgs = createMock.mock.calls[1][0];
    expect(lastCallArgs.messages.at(-1).content).toContain('límite de herramientas');
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
