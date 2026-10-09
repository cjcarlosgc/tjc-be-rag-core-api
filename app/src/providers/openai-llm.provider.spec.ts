import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpException } from '@nestjs/common';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from 'openai';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { LLMConfigurationError } from './llm-configuration.error.js';
import { LLMProviderUnavailableError } from './llm-provider-unavailable.error.js';
import type {
  LLMEffectiveConfig,
  LLMToolDefinition,
} from './llm-provider.interface.js';

const createMock = vi.fn();
const retrieveMock = vi.fn();

// Se conservan las clases reales de error del SDK para clasificar fallos (WI-CORE-025).
// El cliente simulado expone solo `responses.create` y `models.retrieve` (WI-CORE-031).
vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  return {
    ...actual,
    default: class FakeOpenAI {
      responses = { create: createMock };
      models = { retrieve: retrieveMock };
    },
  };
});

const { OpenAiLLMProvider } = await import('./openai-llm.provider.js');

const COMBINATIONS = JSON.stringify([
  {
    model: 'model-a',
    efforts: ['low', 'medium', 'high'],
    toolEfforts: ['low', 'medium'],
  },
  { model: 'model-b', efforts: ['low'], toolEfforts: ['low'] },
]);

function makeConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    OPENAI_API_KEY: 'sk-test',
    LLM_MODEL: 'gpt-4o-mini',
    LLM_SUPPORTED_COMBINATIONS: COMBINATIONS,
    ...overrides,
  };
  return {
    get: (key: string, defaultValue?: unknown) => values[key] ?? defaultValue,
  } as never;
}

function makeConfig(
  overrides: Partial<LLMEffectiveConfig> = {},
): LLMEffectiveConfig {
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

/** Ítem `message` de salida de Responses con un bloque `output_text`. */
function messageItem(text: string) {
  return {
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
}

/** Ítem `function_call`: `call_id` es el identificador que usa el bucle (LLMToolCall.id). */
function functionCallItem(
  callId: string,
  name: string,
  args: string,
  id = `fc_${callId}`,
) {
  return {
    type: 'function_call',
    id,
    call_id: callId,
    name,
    arguments: args,
    status: 'completed',
  };
}

/** Ítem de razonamiento cifrado (store=false, include reasoning.encrypted_content). */
function reasoningItem() {
  return {
    type: 'reasoning',
    id: 'rs_1',
    summary: [],
    encrypted_content: 'ENCRYPTED-BLOB',
  };
}

function completed(
  output: unknown[],
  usage: { input_tokens: number; output_tokens: number } | null = {
    input_tokens: 10,
    output_tokens: 5,
  },
) {
  return {
    status: 'completed',
    error: null,
    incomplete_details: null,
    output,
    usage:
      usage === null
        ? undefined
        : { ...usage, output_tokens_details: { reasoning_tokens: 2 } },
  };
}

const TOOLS: LLMToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Lee un archivo',
    parameters: {
      type: 'object',
      properties: { relativePath: { type: 'string' } },
      required: ['relativePath'],
      additionalProperties: false,
    },
  },
];

const READ_FILE_TOOL = {
  type: 'function',
  name: 'read_file',
  description: 'Lee un archivo',
  parameters: TOOLS[0].parameters,
  strict: true,
};

describe('OpenAiLLMProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
    retrieveMock.mockReset();
  });

  describe('generate (flujo de producto, sin config)', () => {
    it('sends the prompt through responses with store false and returns content plus token usage', async () => {
      createMock.mockResolvedValue(
        completed([messageItem('export function test() {}')], {
          input_tokens: 100,
          output_tokens: 20,
        }),
      );

      const provider = new OpenAiLLMProvider(makeConfigService());
      const result = await provider.generate('write a test');

      expect(createMock).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        store: false,
        input: [{ role: 'user', content: 'write a test' }],
      });
      expect(result).toEqual({
        content: 'export function test() {}',
        inputTokens: 100,
        outputTokens: 20,
      });
    });

    it('does not send reasoning, include or max_output_tokens when no effort or limit is configured', async () => {
      createMock.mockResolvedValue(completed([messageItem('x')]));

      const provider = new OpenAiLLMProvider(makeConfigService());
      await provider.generate('prompt');

      const sent = createMock.mock.calls[0][0];
      expect(sent).not.toHaveProperty('reasoning');
      expect(sent).not.toHaveProperty('include');
      expect(sent).not.toHaveProperty('max_output_tokens');
      expect(sent).not.toHaveProperty('temperature');
      expect(sent).not.toHaveProperty('max_completion_tokens');
    });

    it('includes reasoning effort and encrypted reasoning only when LLM_REASONING_EFFORT is configured', async () => {
      createMock.mockResolvedValue(completed([messageItem('x')]));

      const provider = new OpenAiLLMProvider(
        makeConfigService({ LLM_REASONING_EFFORT: 'high' }),
      );
      await provider.generate('prompt');

      expect(createMock.mock.calls[0][0]).toMatchObject({
        reasoning: { effort: 'high' },
        include: ['reasoning.encrypted_content'],
      });
    });

    it('returns null token counts when usage is not reported', async () => {
      createMock.mockResolvedValue(completed([messageItem('x')], null));

      const provider = new OpenAiLLMProvider(makeConfigService());
      const result = await provider.generate('prompt');

      expect(result).toEqual({
        content: 'x',
        inputTokens: null,
        outputTokens: null,
      });
    });

    it('concatenates only message output text and ignores reasoning items', async () => {
      createMock.mockResolvedValue(
        completed([reasoningItem(), messageItem('uno '), messageItem('dos')]),
      );

      const provider = new OpenAiLLMProvider(makeConfigService());
      const result = await provider.generate('prompt');

      expect(result.content).toBe('uno dos');
    });

    it('reports output_tokens without adding reasoning_tokens again', async () => {
      createMock.mockResolvedValue(
        completed([reasoningItem(), messageItem('x')], {
          input_tokens: 7,
          output_tokens: 30,
        }),
      );

      const provider = new OpenAiLLMProvider(makeConfigService());
      const result = await provider.generate('prompt');

      expect(result).toMatchObject({ inputTokens: 7, outputTokens: 30 });
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
      createMock.mockResolvedValue(completed([messageItem('x')]));

      const provider = new OpenAiLLMProvider(
        makeConfigService({ LLM_REASONING_EFFORT: 'low' }),
      );
      await provider.generate(
        'prompt',
        makeConfig({ reasoningEffort: 'high' }),
      );

      expect(createMock.mock.calls[0][0]).toMatchObject({
        model: 'model-a',
        store: false,
        reasoning: { effort: 'high' },
        include: ['reasoning.encrypted_content'],
      });
    });

    it('sends max_output_tokens and temperature only when configured', async () => {
      createMock.mockResolvedValue(completed([messageItem('x')]));

      const provider = new OpenAiLLMProvider(makeConfigService());
      await provider.generate(
        'prompt',
        makeConfig({ temperature: 0.2, maxOutputTokens: 4000 }),
      );

      expect(createMock.mock.calls[0][0]).toMatchObject({
        temperature: 0.2,
        max_output_tokens: 4000,
      });
    });

    it('omits reasoning, include and temperature when the config has null effort and temperature', async () => {
      createMock.mockResolvedValue(completed([messageItem('x')]));

      const provider = new OpenAiLLMProvider(makeConfigService());
      await provider.generate(
        'prompt',
        makeConfig({ model: 'model-b', reasoningEffort: null }),
      );

      const sent = createMock.mock.calls[0][0];
      expect(sent).not.toHaveProperty('reasoning');
      expect(sent).not.toHaveProperty('include');
      expect(sent).not.toHaveProperty('temperature');
      expect(sent).not.toHaveProperty('max_output_tokens');
    });

    it('rejects an effort that is not supported for generate without calling the API', async () => {
      const provider = new OpenAiLLMProvider(makeConfigService());

      const call = provider.generate(
        'prompt',
        makeConfig({ reasoningEffort: 'xhigh' }),
      );

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
        provider.generate(
          'prompt',
          makeConfig({ model: 'unknown-model', reasoningEffort: 'low' }),
        ),
      ).rejects.toMatchObject({ code: 'REASONING_EFFORT_UNSUPPORTED' });
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe('generateWithTools', () => {
    it('sends strict tools, tool_choice auto, reasoning and encrypted include, and maps the function call', async () => {
      createMock.mockResolvedValue(
        completed(
          [functionCallItem('call-1', 'read_file', '{"relativePath":"a.ts"}')],
          {
            input_tokens: 7,
            output_tokens: 3,
          },
        ),
      );

      const provider = new OpenAiLLMProvider(
        makeConfigService({ LLM_REASONING_EFFORT: 'none' }),
      );
      const result = await provider.generateWithTools(
        [{ role: 'user', content: 'explora' }],
        TOOLS,
        makeConfig({ reasoningEffort: 'medium' }),
      );

      expect(createMock.mock.calls[0][0]).toEqual({
        model: 'model-a',
        store: false,
        input: [{ role: 'user', content: 'explora' }],
        tools: [READ_FILE_TOOL],
        tool_choice: 'auto',
        reasoning: { effort: 'medium' },
        include: ['reasoning.encrypted_content'],
      });
      const functionCall = functionCallItem(
        'call-1',
        'read_file',
        '{"relativePath":"a.ts"}',
      );
      expect(result).toEqual({
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            name: 'read_file',
            arguments: '{"relativePath":"a.ts"}',
          },
        ],
        assistantMessage: {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'call-1',
              name: 'read_file',
              arguments: '{"relativePath":"a.ts"}',
            },
          ],
          providerItems: [functionCall],
        },
        inputTokens: 7,
        outputTokens: 3,
      });
    });

    it('omits tools and tool_choice for a final call without tools, keeping reasoning', async () => {
      createMock.mockResolvedValue(
        completed([messageItem('final')], {
          input_tokens: 1,
          output_tokens: 1,
        }),
      );

      const provider = new OpenAiLLMProvider(makeConfigService());
      const result = await provider.generateWithTools(
        [{ role: 'user', content: 'x' }],
        [],
        makeConfig(),
      );

      const sent = createMock.mock.calls[0][0];
      expect(sent).not.toHaveProperty('tools');
      expect(sent).not.toHaveProperty('tool_choice');
      expect(sent).toMatchObject({
        reasoning: { effort: 'medium' },
        include: ['reasoning.encrypted_content'],
      });
      expect(result.content).toBe('final');
      expect(result.toolCalls).toEqual([]);
      expect(result.assistantMessage).toMatchObject({
        role: 'assistant',
        content: 'final',
      });
    });

    it('omits reasoning and include when the config effort is null', async () => {
      createMock.mockResolvedValue(completed([messageItem('x')]));

      const provider = new OpenAiLLMProvider(makeConfigService());
      await provider.generateWithTools(
        [{ role: 'user', content: 'x' }],
        TOOLS,
        makeConfig({ model: 'model-b', reasoningEffort: null }),
      );

      const sent = createMock.mock.calls[0][0];
      expect(sent).not.toHaveProperty('reasoning');
      expect(sent).not.toHaveProperty('include');
      expect(sent.tools).toEqual([READ_FILE_TOOL]);
    });

    it('maps a neutral assistant with tool calls and a tool result to function_call and function_call_output', async () => {
      createMock.mockResolvedValue(completed([messageItem('ok')]));

      const provider = new OpenAiLLMProvider(makeConfigService());
      await provider.generateWithTools(
        [
          { role: 'user', content: 'x' },
          {
            role: 'assistant',
            content: 'voy a leer',
            toolCalls: [
              {
                id: 'c1',
                name: 'read_file',
                arguments: '{"relativePath":"a"}',
              },
            ],
          },
          { role: 'tool', toolCallId: 'c1', content: 'resultado' },
        ],
        TOOLS,
        makeConfig(),
      );

      expect(createMock.mock.calls[0][0].input).toEqual([
        { role: 'user', content: 'x' },
        { role: 'assistant', content: 'voy a leer' },
        {
          type: 'function_call',
          call_id: 'c1',
          name: 'read_file',
          arguments: '{"relativePath":"a"}',
        },
        { type: 'function_call_output', call_id: 'c1', output: 'resultado' },
      ]);
    });

    it('omits the assistant text item when the content is null or empty', async () => {
      createMock.mockResolvedValue(completed([messageItem('ok')]));

      const provider = new OpenAiLLMProvider(makeConfigService());
      await provider.generateWithTools(
        [
          {
            role: 'assistant',
            content: null,
            toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{}' }],
          },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c2', name: 'read_file', arguments: '{}' }],
          },
          { role: 'tool', toolCallId: 'c1', content: 'r1' },
          { role: 'tool', toolCallId: 'c2', content: 'r2' },
        ],
        TOOLS,
        makeConfig(),
      );

      const input = createMock.mock.calls[0][0].input as Array<{
        type?: string;
        role?: string;
      }>;
      expect(input.filter((item) => item.role === 'assistant')).toEqual([]);
      expect(input.map((item) => item.type)).toEqual([
        'function_call',
        'function_call',
        'function_call_output',
        'function_call_output',
      ]);
    });

    it('forwards providerItems verbatim instead of synthesizing the assistant turn', async () => {
      createMock.mockResolvedValue(completed([messageItem('ok')]));
      const providerItems = [
        reasoningItem(),
        functionCallItem('c1', 'read_file', '{"relativePath":"a"}'),
      ];

      const provider = new OpenAiLLMProvider(makeConfigService());
      await provider.generateWithTools(
        [
          { role: 'user', content: 'x' },
          {
            role: 'assistant',
            content: 'texto que no debe duplicarse',
            toolCalls: [
              {
                id: 'c1',
                name: 'read_file',
                arguments: '{"relativePath":"a"}',
              },
            ],
            providerItems,
          },
          { role: 'tool', toolCallId: 'c1', content: 'resultado' },
        ],
        TOOLS,
        makeConfig(),
      );

      const input = createMock.mock.calls[0][0].input as unknown[];
      expect(input).toHaveLength(4);
      expect(input[1]).toBe(providerItems[0]);
      expect(input[2]).toBe(providerItems[1]);
      expect(input[3]).toEqual({
        type: 'function_call_output',
        call_id: 'c1',
        output: 'resultado',
      });
    });

    it('keeps reasoning, message and several function calls of one turn in providerItems and in toolCalls', async () => {
      const output = [
        reasoningItem(),
        messageItem('voy a explorar'),
        functionCallItem('call-a', 'list_files', '{}'),
        functionCallItem('call-b', 'read_file', '{"relativePath":"a.ts"}'),
      ];
      createMock.mockResolvedValue(completed(output));

      const provider = new OpenAiLLMProvider(makeConfigService());
      const result = await provider.generateWithTools(
        [{ role: 'user', content: 'x' }],
        TOOLS,
        makeConfig(),
      );

      expect(result.content).toBe('voy a explorar');
      expect(result.toolCalls).toEqual([
        { id: 'call-a', name: 'list_files', arguments: '{}' },
        {
          id: 'call-b',
          name: 'read_file',
          arguments: '{"relativePath":"a.ts"}',
        },
      ]);
      expect(result.assistantMessage).toEqual({
        role: 'assistant',
        content: 'voy a explorar',
        toolCalls: result.toolCalls,
        providerItems: output,
      });
    });

    it('returns null tokens when usage is not reported', async () => {
      createMock.mockResolvedValue(completed([messageItem('x')], null));

      const provider = new OpenAiLLMProvider(makeConfigService());
      const result = await provider.generateWithTools(
        [{ role: 'user', content: 'x' }],
        [],
        makeConfig(),
      );

      expect(result).toMatchObject({ inputTokens: null, outputTokens: null });
    });

    it('rejects an effort supported only for generate when tools are used', async () => {
      const provider = new OpenAiLLMProvider(makeConfigService());

      await expect(
        provider.generateWithTools(
          [{ role: 'user', content: 'x' }],
          TOOLS,
          makeConfig({ reasoningEffort: 'high' }),
        ),
      ).rejects.toMatchObject({
        code: 'REASONING_EFFORT_UNSUPPORTED',
        requestedEffort: 'high',
        supportedEfforts: ['low', 'medium'],
      });
      expect(createMock).not.toHaveBeenCalled();
    });

    it('refuses to send a tool whose schema does not meet the strict rules, as a programming error', async () => {
      const provider = new OpenAiLLMProvider(makeConfigService());
      const badTool: LLMToolDefinition = {
        name: 'loose_tool',
        description: 'sin additionalProperties',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
      };

      const call = provider.generateWithTools(
        [{ role: 'user', content: 'x' }],
        [badTool],
        makeConfig(),
      );

      await expect(call).rejects.toThrow(/loose_tool.*additionalProperties/);
      await expect(call).rejects.not.toBeInstanceOf(
        LLMProviderUnavailableError,
      );
      expect(createMock).not.toHaveBeenCalled();
    });

    it('wraps transport failures as LLM_PROVIDER_UNAVAILABLE', async () => {
      createMock.mockRejectedValue(new Error('timeout'));

      const provider = new OpenAiLLMProvider(makeConfigService());

      await expect(
        provider.generateWithTools(
          [{ role: 'user', content: 'x' }],
          TOOLS,
          makeConfig(),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.LLM_PROVIDER_UNAVAILABLE });
    });
  });

  describe('respuestas con status (WI-CORE-031)', () => {
    async function responseFailure(
      response: unknown,
      operation: 'generate' | 'generateWithTools' = 'generate',
    ) {
      createMock.mockResolvedValue(response);
      const provider = new OpenAiLLMProvider(makeConfigService());
      const call =
        operation === 'generate'
          ? provider.generate('prompt')
          : provider.generateWithTools(
              [{ role: 'user', content: 'prompt' }],
              [],
              makeConfig(),
            );
      return call.then(
        () => {
          throw new Error('expected a failure');
        },
        (caught: unknown) => caught,
      );
    }

    it('treats status failed with server_error or rate_limit_exceeded as external', async () => {
      for (const code of ['server_error', 'rate_limit_exceeded']) {
        const caught = await responseFailure({
          status: 'failed',
          error: { code, message: 'boom' },
          output: [],
        });
        expect(caught).toBeInstanceOf(LLMProviderUnavailableError);
        expect((caught as LLMProviderUnavailableError).externalFailure).toBe(
          true,
        );
        expect(caught).toMatchObject({
          code: ErrorCode.LLM_PROVIDER_UNAVAILABLE,
        });
      }
    });

    it('treats status failed with any other code, or without error, as not external', async () => {
      const others = [
        {
          status: 'failed',
          error: { code: 'invalid_prompt', message: 'bad' },
          output: [],
        },
        { status: 'failed', error: null, output: [] },
      ];
      for (const response of others) {
        const caught = await responseFailure(response);
        expect(caught).toBeInstanceOf(LLMProviderUnavailableError);
        expect((caught as LLMProviderUnavailableError).externalFailure).toBe(
          false,
        );
      }
    });

    it('rejects status incomplete without partial content and never as external', async () => {
      const caught = await responseFailure(
        {
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          error: null,
          output: [reasoningItem(), messageItem('parcial')],
        },
        'generateWithTools',
      );

      expect(caught).toBeInstanceOf(LLMProviderUnavailableError);
      expect((caught as LLMProviderUnavailableError).externalFailure).toBe(
        false,
      );
      expect((caught as LLMProviderUnavailableError).details).toContain(
        'max_output_tokens',
      );
    });

    it('rejects status incomplete for generate too, returning no content', async () => {
      const caught = await responseFailure({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        error: null,
        output: [messageItem('parcial')],
      });

      expect(caught).toBeInstanceOf(LLMProviderUnavailableError);
      expect((caught as LLMProviderUnavailableError).externalFailure).toBe(
        false,
      );
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
        endpoint: 'responses',
      });
    });

    it('uses gpt-6-luna when EXPERIMENT_LLM_MODEL is not configured', async () => {
      retrieveMock.mockResolvedValue({ id: 'gpt-6-luna-2026' });
      const provider = new OpenAiLLMProvider(
        makeConfigService({
          LLM_SUPPORTED_COMBINATIONS: JSON.stringify([
            {
              model: 'gpt-6-luna',
              efforts: ['low', 'xhigh'],
              toolEfforts: ['low', 'xhigh'],
            },
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
        makeConfigService({
          EXPERIMENT_LLM_MODEL: 'model-a',
          EXPERIMENT_LLM_REASONING_EFFORT: 'low',
        }),
      );

      const config = await provider.resolveEffectiveConfig();

      expect(config.reasoningEffort).toBe('low');
    });

    it('fails without confirming the model when the requested effort is not common to both modes', async () => {
      const provider = new OpenAiLLMProvider(
        makeConfigService({
          EXPERIMENT_LLM_MODEL: 'model-a',
          EXPERIMENT_LLM_REASONING_EFFORT: 'high',
        }),
      );

      await expect(provider.resolveEffectiveConfig()).rejects.toMatchObject({
        code: 'REASONING_EFFORT_UNSUPPORTED',
        requestedEffort: 'high',
        supportedEfforts: ['low', 'medium'],
      });
      expect(retrieveMock).not.toHaveBeenCalled();
    });

    it('fails when the model has no supported combinations', async () => {
      const provider = new OpenAiLLMProvider(
        makeConfigService({ EXPERIMENT_LLM_MODEL: 'missing' }),
      );

      await expect(provider.resolveEffectiveConfig()).rejects.toBeInstanceOf(
        LLMConfigurationError,
      );
      expect(retrieveMock).not.toHaveBeenCalled();
    });

    it('fails with MODEL_UNAVAILABLE when the API cannot retrieve the model', async () => {
      retrieveMock.mockRejectedValue(new Error('404 model not found'));
      const provider = new OpenAiLLMProvider(
        makeConfigService({ EXPERIMENT_LLM_MODEL: 'model-a' }),
      );

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
      const provider = new OpenAiLLMProvider(
        makeConfigService({ LLM_SUPPORTED_COMBINATIONS: undefined }),
      );

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
      createMock.mockResolvedValue(completed([messageItem('x')]));

      const provider = new OpenAiLLMProvider(
        makeConfigService({
          EXPERIMENT_LLM_MODEL: 'model-b',
          EXPERIMENT_LLM_REASONING_EFFORT: 'low',
        }),
      );
      await provider.generate(
        'prompt',
        makeConfig({ model: 'model-a', reasoningEffort: 'medium' }),
      );

      expect(createMock.mock.calls[0][0]).toMatchObject({
        model: 'model-a',
        reasoning: { effort: 'medium' },
      });
      expect(retrieveMock).not.toHaveBeenCalled();
    });

    it('generateWithTools with a persisted config ignores EXPERIMENT_LLM_* changed after creation', async () => {
      createMock.mockResolvedValue(completed([messageItem('x')]));

      const provider = new OpenAiLLMProvider(
        makeConfigService({
          EXPERIMENT_LLM_MODEL: 'model-b',
          EXPERIMENT_LLM_REASONING_EFFORT: 'low',
        }),
      );
      await provider.generateWithTools(
        [{ role: 'user', content: 'hola' }],
        [],
        makeConfig({ model: 'model-a', reasoningEffort: 'medium' }),
      );

      expect(createMock.mock.calls[0][0]).toMatchObject({
        model: 'model-a',
        reasoning: { effort: 'medium' },
      });
      expect(retrieveMock).not.toHaveBeenCalled();
    });
  });

  describe('clasificación externa de fallos del proveedor (WI-CORE-025)', () => {
    async function failureOf(
      error: unknown,
      operation: 'generate' | 'generateWithTools' = 'generate',
    ) {
      createMock.mockRejectedValue(error);
      const provider = new OpenAiLLMProvider(makeConfigService());
      const call =
        operation === 'generate'
          ? provider.generate('prompt')
          : provider.generateWithTools(
              [{ role: 'user', content: 'prompt' }],
              [],
              makeConfig(),
            );
      return call.then(
        () => {
          throw new Error('expected a failure');
        },
        (caught: unknown) => caught,
      );
    }

    it('marks HTTP 5xx, HTTP 429 and connection or timeout errors as external', async () => {
      const externals = [
        APIError.generate(500, undefined, 'server down', new Headers()),
        APIError.generate(503, undefined, 'unavailable', new Headers()),
        APIError.generate(429, undefined, 'rate limited', new Headers()),
        new APIConnectionError({ message: 'socket hang up' }),
        new APIConnectionTimeoutError({ message: 'request timed out' }),
      ];

      for (const error of externals) {
        const caught = await failureOf(error);
        expect(caught).toBeInstanceOf(LLMProviderUnavailableError);
        expect((caught as LLMProviderUnavailableError).externalFailure).toBe(
          true,
        );
      }
    });

    it('does not mark other 4xx, invalid responses or unrecognized errors as external', async () => {
      const notExternals = [
        APIError.generate(400, undefined, 'bad request', new Headers()),
        APIError.generate(401, undefined, 'unauthorized', new Headers()),
        APIError.generate(404, undefined, 'model not found', new Headers()),
        APIError.generate(422, undefined, 'unprocessable', new Headers()),
        new Error('respuesta inválida'),
      ];

      for (const error of notExternals) {
        const caught = await failureOf(error);
        expect(caught).toBeInstanceOf(LLMProviderUnavailableError);
        expect((caught as LLMProviderUnavailableError).externalFailure).toBe(
          false,
        );
      }
    });

    it('keeps the public contract unchanged: code, 503 status and details', async () => {
      const error = APIError.generate(
        500,
        undefined,
        'server down',
        new Headers(),
      );

      const caught = (await failureOf(error)) as HttpException & {
        code: string;
        details: unknown;
      };

      expect(caught.code).toBe(ErrorCode.LLM_PROVIDER_UNAVAILABLE);
      expect(caught.getStatus()).toBe(503);
      expect(caught.getResponse()).toMatchObject({
        code: ErrorCode.LLM_PROVIDER_UNAVAILABLE,
        message: 'El proveedor de LLM no respondió correctamente.',
        details: error.message,
      });
      expect(caught.details).toBe(error.message);
    });

    it('classifies failures of generateWithTools the same way', async () => {
      const transport = await failureOf(
        new APIConnectionError({ message: 'reset' }),
        'generateWithTools',
      );
      const invalid = await failureOf(
        new Error('bad payload'),
        'generateWithTools',
      );

      expect((transport as LLMProviderUnavailableError).externalFailure).toBe(
        true,
      );
      expect((invalid as LLMProviderUnavailableError).externalFailure).toBe(
        false,
      );
      expect(transport).toMatchObject({
        code: ErrorCode.LLM_PROVIDER_UNAVAILABLE,
      });
    });
  });
});
