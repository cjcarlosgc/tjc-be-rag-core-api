import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/errors/error-code.enum.js';

const createMock = vi.fn();

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

const { OpenAiLLMProvider } = await import('./openai-llm.provider.js');

function makeConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    OPENAI_API_KEY: 'sk-test',
    LLM_MODEL: 'gpt-4o-mini',
    ...overrides,
  };
  return { get: (key: string, defaultValue?: unknown) => values[key] ?? defaultValue } as never;
}

describe('OpenAiLLMProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('sends the prompt and returns content plus token usage', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'export function test() {}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });

    const provider = new OpenAiLLMProvider(makeConfigService());
    const result = await provider.generate('write a test');

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'write a test' }],
      }),
    );
    expect(result).toEqual({
      content: 'export function test() {}',
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  it('includes reasoning_effort only when LLM_REASONING_EFFORT is configured', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

    const provider = new OpenAiLLMProvider(
      makeConfigService({ LLM_REASONING_EFFORT: 'high' }),
    );
    await provider.generate('prompt');

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ reasoning_effort: 'high' }));
  });

  it('omits reasoning_effort when LLM_REASONING_EFFORT is not configured', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

    const provider = new OpenAiLLMProvider(makeConfigService());
    await provider.generate('prompt');

    expect(createMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ reasoning_effort: expect.anything() }),
    );
  });

  it('returns null token counts when usage is not reported', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

    const provider = new OpenAiLLMProvider(makeConfigService());
    const result = await provider.generate('prompt');

    expect(result).toEqual({ content: 'x', inputTokens: null, outputTokens: null });
  });

  it('wraps provider failures as LLM_PROVIDER_UNAVAILABLE', async () => {
    createMock.mockRejectedValue(new Error('network down'));

    const provider = new OpenAiLLMProvider(makeConfigService());

    await expect(provider.generate('prompt')).rejects.toMatchObject({
      code: ErrorCode.LLM_PROVIDER_UNAVAILABLE,
    });
  });
});
