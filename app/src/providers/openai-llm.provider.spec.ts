import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { LLMConfigurationError } from './llm-configuration.error.js';
import type { LLMEffectiveConfig } from './llm-provider.interface.js';

const createMock = vi.fn();
const retrieveMock = vi.fn();

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
    models = { retrieve: retrieveMock };
  },
}));

const { OpenAiLLMProvider } = await import('./openai-llm.provider.js');

const COMBINATIONS = JSON.stringify([
  { model: 'model-a', efforts: ['low', 'medium', 'high'], toolEfforts: ['low', 'medium'] },
  { model: 'model-b', efforts: ['low'], toolEfforts: ['low'] },
]);

function makeConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    OPENAI_API_KEY: 'sk-test',
    LLM_MODEL: 'gpt-4o-mini',
    LLM_SUPPORTED_COMBINATIONS: COMBINATIONS,
    ...overrides,
  };
  return { get: (key: string, defaultValue?: unknown) => values[key] ?? defaultValue } as never;
}

function makeConfig(overrides: Partial<LLMEffectiveConfig> = {}): LLMEffectiveConfig {
  return {
    provider: 'openai',
    model: 'model-a',
    modelVersion: 'model-a',
    reasoningEffort: 'medium',
    temperature: null,
    maxOutputTokens: null,
    ...overrides,
  };
}

describe('OpenAiLLMProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
    retrieveMock.mockReset();
  });

  describe('generate (flujo de producto, sin config)', () => {
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

      const provider = new OpenAiLLMProvider(makeConfigService({ LLM_REASONING_EFFORT: 'high' }));
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

  describe('generate con config del experimento', () => {
    it('uses the config model and effort instead of LLM_MODEL and never forces none', async () => {
      createMock.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

      const provider = new OpenAiLLMProvider(makeConfigService({ LLM_REASONING_EFFORT: 'low' }));
      await provider.generate('prompt', makeConfig({ reasoningEffort: 'high' }));

      expect(createMock.mock.calls[0][0]).toMatchObject({
        model: 'model-a',
        reasoning_effort: 'high',
      });
    });

    it('rejects an effort that is not supported for generate without calling the API', async () => {
      const provider = new OpenAiLLMProvider(makeConfigService());

      const call = provider.generate('prompt', makeConfig({ reasoningEffort: 'xhigh' }));

      await expect(call).rejects.toBeInstanceOf(LLMConfigurationError);
      await expect(call).rejects.toMatchObject({
        code: 'REASONING_EFFORT_UNSUPPORTED',
        requestedEffort: 'xhigh',
        supportedEfforts: ['low', 'medium', 'high'],
      });
      expect(createMock).not.toHaveBeenCalled();
    });

    it('rejects a model without supported combinations', async () => {
      const provider = new OpenAiLLMProvider(makeConfigService());

      await expect(
        provider.generate('prompt', makeConfig({ model: 'unknown-model', reasoningEffort: 'low' })),
      ).rejects.toMatchObject({ code: 'REASONING_EFFORT_UNSUPPORTED' });
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('generateWithTools', () => {
    const tools = [
      {
        name: 'read_file',
        description: 'Lee un archivo',
        parameters: { type: 'object', properties: { relativePath: { type: 'string' } } },
      },
    ];

    it('sends tools with tool_choice auto and the config effort, never none', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"relativePath":"a.ts"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      });

      const provider = new OpenAiLLMProvider(makeConfigService({ LLM_REASONING_EFFORT: 'none' }));
      const result = await provider.generateWithTools(
        [{ role: 'user', content: 'explora' }],
        tools,
        makeConfig({ reasoningEffort: 'medium' }),
      );

      expect(createMock.mock.calls[0][0]).toEqual({
        model: 'model-a',
        messages: [{ role: 'user', content: 'explora' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Lee un archivo',
              parameters: tools[0].parameters,
            },
          },
        ],
        tool_choice: 'auto',
        reasoning_effort: 'medium',
      });
      expect(result).toEqual({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"relativePath":"a.ts"}' }],
        assistantMessage: {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{"relativePath":"a.ts"}' }],
        },
        inputTokens: 7,
        outputTokens: 3,
      });
    });

    it('omits tools and tool_choice for a final call without tools', async () => {
      createMock.mockResolvedValue({
        choices: [{ message: { content: 'final' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      const provider = new OpenAiLLMProvider(makeConfigService());
      const result = await provider.generateWithTools(
        [
          { role: 'user', content: 'x' },
          { role: 'assistant', content: null, toolCalls: [{ id: 'c', name: 'read_file', arguments: '{}' }] },
          { role: 'tool', toolCallId: 'c', content: 'resultado' },
        ],
        [],
        makeConfig(),
      );

      const sent = createMock.mock.calls[0][0];
      expect(sent).not.toHaveProperty('tools');
      expect(sent).not.toHaveProperty('tool_choice');
      expect(sent.messages).toEqual([
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c', type: 'function', function: { name: 'read_file', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'c', content: 'resultado' },
      ]);
      expect(result.content).toBe('final');
      expect(result.toolCalls).toEqual([]);
      expect(result.assistantMessage).toEqual({ role: 'assistant', content: 'final' });
    });

    it('rejects an effort supported only for generate when tools are used', async () => {
      const provider = new OpenAiLLMProvider(makeConfigService());

      await expect(
        provider.generateWithTools([{ role: 'user', content: 'x' }], tools, makeConfig({ reasoningEffort: 'high' })),
      ).rejects.toMatchObject({
        code: 'REASONING_EFFORT_UNSUPPORTED',
        requestedEffort: 'high',
        supportedEfforts: ['low', 'medium'],
      });
      expect(createMock).not.toHaveBeenCalled();
    });

    it('wraps transport failures as LLM_PROVIDER_UNAVAILABLE', async () => {
      createMock.mockRejectedValue(new Error('timeout'));

      const provider = new OpenAiLLMProvider(makeConfigService());

      await expect(
        provider.generateWithTools([{ role: 'user', content: 'x' }], tools, makeConfig()),
      ).rejects.toMatchObject({ code: ErrorCode.LLM_PROVIDER_UNAVAILABLE });
    });
  });

  describe('resolveEffectiveConfig', () => {
    it('uses the default experiment model and the highest common effort, confirming the model id', async () => {
      retrieveMock.mockResolvedValue({ id: 'model-a' });

      const provider = new OpenAiLLMProvider(
        makeConfigService({ EXPERIMENT_LLM_MODEL: 'model-a' }),
      );
      const config = await provider.resolveEffectiveConfig();

      expect(retrieveMock).toHaveBeenCalledWith('model-a');
      expect(config).toEqual({
        provider: 'openai',
        model: 'model-a',
        modelVersion: 'model-a',
        reasoningEffort: 'medium',
        temperature: null,
        maxOutputTokens: null,
      });
    });

    it('uses gpt-6-luna when EXPERIMENT_LLM_MODEL is not configured', async () => {
      retrieveMock.mockResolvedValue({ id: 'gpt-6-luna-2026' });
      const provider = new OpenAiLLMProvider(
        makeConfigService({
          LLM_SUPPORTED_COMBINATIONS: JSON.stringify([
            { model: 'gpt-6-luna', efforts: ['low', 'xhigh'], toolEfforts: ['low', 'xhigh'] },
          ]),
        }),
      );

      const config = await provider.resolveEffectiveConfig();

      expect(retrieveMock).toHaveBeenCalledWith('gpt-6-luna');
      expect(config.model).toBe('gpt-6-luna');
      expect(config.modelVersion).toBe('gpt-6-luna-2026');
      expect(config.reasoningEffort).toBe('xhigh');
    });

    it('uses the requested effort when it is supported by generate and tools', async () => {
      retrieveMock.mockResolvedValue({ id: 'model-a' });
      const provider = new OpenAiLLMProvider(
        makeConfigService({ EXPERIMENT_LLM_MODEL: 'model-a', EXPERIMENT_LLM_REASONING_EFFORT: 'low' }),
      );

      const config = await provider.resolveEffectiveConfig();

      expect(config.reasoningEffort).toBe('low');
    });

    it('fails without confirming the model when the requested effort is not common to both modes', async () => {
      const provider = new OpenAiLLMProvider(
        makeConfigService({ EXPERIMENT_LLM_MODEL: 'model-a', EXPERIMENT_LLM_REASONING_EFFORT: 'high' }),
      );

      await expect(provider.resolveEffectiveConfig()).rejects.toMatchObject({
        code: 'REASONING_EFFORT_UNSUPPORTED',
        requestedEffort: 'high',
        supportedEfforts: ['low', 'medium'],
      });
      expect(retrieveMock).not.toHaveBeenCalled();
    });

    it('fails when the model has no supported combinations', async () => {
      const provider = new OpenAiLLMProvider(makeConfigService({ EXPERIMENT_LLM_MODEL: 'missing' }));

      await expect(provider.resolveEffectiveConfig()).rejects.toBeInstanceOf(LLMConfigurationError);
      expect(retrieveMock).not.toHaveBeenCalled();
    });

    it('fails with MODEL_UNAVAILABLE when the API cannot retrieve the model', async () => {
      retrieveMock.mockRejectedValue(new Error('404 model not found'));
      const provider = new OpenAiLLMProvider(makeConfigService({ EXPERIMENT_LLM_MODEL: 'model-a' }));

      await expect(provider.resolveEffectiveConfig()).rejects.toMatchObject({
        code: 'MODEL_UNAVAILABLE',
        model: 'model-a',
      });
    });

    it('carries temperature and max output tokens when configured', async () => {
      retrieveMock.mockResolvedValue({ id: 'model-a' });
      const provider = new OpenAiLLMProvider(
        makeConfigService({
          EXPERIMENT_LLM_MODEL: 'model-a',
          EXPERIMENT_LLM_TEMPERATURE: '0.2',
          EXPERIMENT_LLM_MAX_OUTPUT_TOKENS: '4000',
        }),
      );

      const config = await provider.resolveEffectiveConfig();

      expect(config.temperature).toBe(0.2);
      expect(config.maxOutputTokens).toBe(4000);
    });

    it('registers no efforts by default for gpt-6-luna: without LLM_SUPPORTED_COMBINATIONS it fails before confirming the model', async () => {
      const provider = new OpenAiLLMProvider(makeConfigService({ LLM_SUPPORTED_COMBINATIONS: undefined }));

      await expect(provider.resolveEffectiveConfig()).rejects.toMatchObject({
        code: 'REASONING_EFFORT_UNSUPPORTED',
        model: 'gpt-6-luna',
        requestedEffort: null,
        supportedEfforts: [],
      });
      expect(retrieveMock).not.toHaveBeenCalled();
    });

    it('does not fall back to a guessed effort when gpt-6-luna is absent from LLM_SUPPORTED_COMBINATIONS', async () => {
      const provider = new OpenAiLLMProvider(
        makeConfigService({
          LLM_SUPPORTED_COMBINATIONS: JSON.stringify([
            { model: 'model-a', efforts: ['low'], toolEfforts: ['low'] },
          ]),
        }),
      );

      await expect(provider.resolveEffectiveConfig()).rejects.toMatchObject({
        code: 'REASONING_EFFORT_UNSUPPORTED',
        model: 'gpt-6-luna',
        supportedEfforts: [],
      });
      expect(retrieveMock).not.toHaveBeenCalled();
    });
  });

  describe('config persistida frente a entorno posterior (WI-CORE-023)', () => {
    it('generate with a persisted config ignores EXPERIMENT_LLM_* changed after creation', async () => {
      createMock.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

      const provider = new OpenAiLLMProvider(
        makeConfigService({ EXPERIMENT_LLM_MODEL: 'model-b', EXPERIMENT_LLM_REASONING_EFFORT: 'low' }),
      );
      await provider.generate('prompt', makeConfig({ model: 'model-a', reasoningEffort: 'medium' }));

      expect(createMock.mock.calls[0][0]).toMatchObject({ model: 'model-a', reasoning_effort: 'medium' });
      expect(retrieveMock).not.toHaveBeenCalled();
    });

    it('generateWithTools with a persisted config ignores EXPERIMENT_LLM_* changed after creation', async () => {
      createMock.mockResolvedValue({ choices: [{ message: { content: 'x' } }] });

      const provider = new OpenAiLLMProvider(
        makeConfigService({ EXPERIMENT_LLM_MODEL: 'model-b', EXPERIMENT_LLM_REASONING_EFFORT: 'low' }),
      );
      await provider.generateWithTools(
        [{ role: 'user', content: 'hola' }],
        [],
        makeConfig({ model: 'model-a', reasoningEffort: 'medium' }),
      );

      expect(createMock.mock.calls[0][0]).toMatchObject({ model: 'model-a', reasoning_effort: 'medium' });
      expect(retrieveMock).not.toHaveBeenCalled();
    });
  });
});
