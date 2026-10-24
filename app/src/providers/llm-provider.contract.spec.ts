/**
 * CT-09-A3 (WI-CORE-089): suite de contrato del puerto `LLMProvider`, parametrizada contra el adaptador de OpenAI
 * (con el cliente del SDK simulado, sin red) y contra el adaptador falso. Cada prueba exige el mismo
 * comportamiento observable en ambos: contenido y tokens, bucle de herramientas, configuración efectiva,
 * fallos externos, configuración no soportada y ausencia de credenciales en errores y logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { APIConnectionError, APIError } from 'openai';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { LLMConfigurationError } from './llm-configuration.error.js';
import { LLMProviderUnavailableError } from './llm-provider-unavailable.error.js';
import type {
  LLMEffectiveConfig,
  LLMProvider,
  LLMToolDefinition,
} from './llm-provider.interface.js';
import { FakeLLMProvider } from './testing/fake-llm.provider.js';

const createMock = vi.fn();
const retrieveMock = vi.fn();

// Mismo patrón que openai-llm.provider.spec.ts: se conservan las clases reales de error del SDK y el cliente
// simulado expone solo `responses.create` y `models.retrieve`.
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

const CONTRACT_MODEL = 'gpt-6-luna';
const CONTRACT_EFFORT = 'low';
/** Clave ficticia: no debe aparecer en ningún error ni log del adaptador. */
const CONTRACT_SECRET = 'sk-contrato-SECRETO-0123456789';

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

interface Tokens {
  input: number | null;
  output: number | null;
}

/** Una llamada enviada al proveedor, en la forma que comparan las pruebas de contrato. */
interface SentRequest {
  model: string;
  reasoningEffort: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
  messages: unknown;
}

/** Operaciones de guion y de inspección que cada adaptador implementa a su manera. */
interface ProviderUnderTest {
  provider: LLMProvider;
  queueText(content: string, tokens?: Tokens): void;
  queueToolCall(callId: string, name: string, args: string): void;
  queueHttpFault(status: number, message: string): void;
  queueConnectionFault(message: string): void;
  allowModel(id: string): void;
  makeModelUnavailable(): void;
  sent(): SentRequest[];
}

interface ContractHarness {
  name: string;
  setup(): ProviderUnderTest;
}

function effectiveConfig(overrides: Partial<LLMEffectiveConfig> = {}): LLMEffectiveConfig {
  return {
    provider: 'contrato',
    model: CONTRACT_MODEL,
    modelVersion: CONTRACT_MODEL,
    reasoningEffort: CONTRACT_EFFORT,
    temperature: null,
    maxOutputTokens: null,
    ...overrides,
  };
}

const openAiHarness: ContractHarness = {
  name: 'OpenAiLLMProvider',
  setup() {
    createMock.mockReset();
    retrieveMock.mockReset();
    const configService = {
      get: (key: string, defaultValue?: unknown) =>
        ({
          OPENAI_API_KEY: CONTRACT_SECRET,
          LLM_MODEL: CONTRACT_MODEL,
          LLM_REASONING_EFFORT: CONTRACT_EFFORT,
        })[key] ?? defaultValue,
    } as never;
    return {
      provider: new OpenAiLLMProvider(configService),
      queueText(content, tokens = { input: 10, output: 5 }) {
        createMock.mockResolvedValueOnce({
          status: 'completed',
          error: null,
          incomplete_details: null,
          output: [
            {
              type: 'message',
              id: 'msg_1',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: content, annotations: [] }],
            },
          ],
          usage: { input_tokens: tokens.input, output_tokens: tokens.output },
        });
      },
      queueToolCall(callId, name, args) {
        createMock.mockResolvedValueOnce({
          status: 'completed',
          error: null,
          incomplete_details: null,
          output: [
            {
              type: 'function_call',
              id: `fc_${callId}`,
              call_id: callId,
              name,
              arguments: args,
              status: 'completed',
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      },
      queueHttpFault(status, message) {
        createMock.mockRejectedValueOnce(APIError.generate(status, undefined, message, new Headers()));
      },
      queueConnectionFault(message) {
        createMock.mockRejectedValueOnce(new APIConnectionError({ message }));
      },
      allowModel(id) {
        retrieveMock.mockResolvedValueOnce({ id });
      },
      makeModelUnavailable() {
        retrieveMock.mockRejectedValueOnce(new Error('model not found'));
      },
      sent() {
        return createMock.mock.calls.map(([params]) => ({
          model: params.model,
          reasoningEffort: params.reasoning?.effort ?? null,
          temperature: params.temperature ?? null,
          maxOutputTokens: params.max_output_tokens ?? null,
          messages: params.input,
        }));
      },
    };
  },
};

const fakeHarness: ContractHarness = {
  name: 'FakeLLMProvider',
  setup() {
    const fake = new FakeLLMProvider({ model: CONTRACT_MODEL, reasoningEffort: CONTRACT_EFFORT });
    return {
      provider: fake,
      queueText(content, tokens = { input: 10, output: 5 }) {
        fake.enqueueTurn({ content, inputTokens: tokens.input, outputTokens: tokens.output });
      },
      queueToolCall(callId, name, args) {
        fake.enqueueTurn({ toolCalls: [{ id: callId, name, arguments: args }] });
      },
      queueHttpFault(status, message) {
        fake.enqueueFault({ kind: 'http', status, message });
      },
      queueConnectionFault(message) {
        fake.enqueueFault({ kind: 'connection', message });
      },
      allowModel() {
        // El doble tiene el modelo disponible por defecto.
      },
      makeModelUnavailable() {
        fake.setModelAvailable(false);
      },
      sent() {
        return fake.requests.map((request) => ({
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          messages: request.messages,
        }));
      },
    };
  },
};

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('se esperaba un fallo');
    },
    (error: unknown) => error,
  );
}

describe.each([openAiHarness, fakeHarness])('contrato de LLMProvider: $name', (harness) => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('contenido y conteo de tokens', () => {
    it('devuelve el contenido y los tokens informados por el proveedor', async () => {
      const under = harness.setup();
      under.queueText('hola', { input: 12, output: 3 });

      const result = await under.provider.generate('saluda', effectiveConfig());

      expect(result.content).toBe('hola');
      expect(result.inputTokens).toBe(12);
      expect(result.outputTokens).toBe(3);
    });

    it('devuelve null, nunca cero, cuando el proveedor no informa el uso de tokens', async () => {
      const under = harness.setup();
      under.queueText('sin uso', { input: null, output: null });

      const result = await under.provider.generate('prompt', effectiveConfig());

      expect(result.inputTokens).toBeNull();
      expect(result.outputTokens).toBeNull();
    });
  });

  describe('bucle de herramientas', () => {
    it('ejecuta llamada, resultado y parada: sin llamadas nuevas termina el bucle', async () => {
      const under = harness.setup();
      under.queueToolCall('call_1', 'read_file', '{"relativePath":"a.ts"}');
      under.queueText('listo');
      const config = effectiveConfig();

      const first = await under.provider.generateWithTools(
        [{ role: 'user', content: 'lee a.ts' }],
        TOOLS,
        config,
      );
      expect(first.toolCalls).toEqual([
        { id: 'call_1', name: 'read_file', arguments: '{"relativePath":"a.ts"}' },
      ]);

      const second = await under.provider.generateWithTools(
        [
          { role: 'user', content: 'lee a.ts' },
          first.assistantMessage,
          { role: 'tool', toolCallId: 'call_1', content: 'contenido de a.ts' },
        ],
        TOOLS,
        config,
      );

      expect(second.content).toBe('listo');
      expect(second.toolCalls).toEqual([]);
      const sent = under.sent();
      expect(sent).toHaveLength(2);
      expect(JSON.stringify(sent[1].messages)).toContain('call_1');
      expect(JSON.stringify(sent[1].messages)).toContain('contenido de a.ts');
    });
  });

  describe('configuración efectiva', () => {
    it('envía exactamente la configuración pedida y la informa en el resultado', async () => {
      const under = harness.setup();
      under.queueText('ok');

      const result = await under.provider.generate(
        'hola',
        effectiveConfig({ model: 'modelo-contrato', reasoningEffort: 'high', maxOutputTokens: 256 }),
      );

      expect(under.sent()[0]).toMatchObject({ model: 'modelo-contrato', reasoningEffort: 'high' });
      expect(result.effective).toMatchObject({ model: 'modelo-contrato', reasoningEffort: 'high' });
      expect(typeof result.effective?.provider).toBe('string');
    });

    it('generateWithTools envía exactamente la configuración pedida, sin cambiar modelo ni esfuerzo', async () => {
      const under = harness.setup();
      under.queueText('ok');

      await under.provider.generateWithTools(
        [{ role: 'user', content: 'hola' }],
        TOOLS,
        effectiveConfig({ model: 'modelo-herramientas', reasoningEffort: 'high', maxOutputTokens: 512 }),
      );

      expect(under.sent()[0]).toMatchObject({
        model: 'modelo-herramientas',
        reasoningEffort: 'high',
        maxOutputTokens: 512,
      });
    });

    it('envía la temperatura solo sin razonamiento activo', async () => {
      const under = harness.setup();
      under.queueText('ok');

      await under.provider.generate('hola', effectiveConfig({ reasoningEffort: 'none', temperature: 0.5 }));

      expect(under.sent()[0]).toMatchObject({ reasoningEffort: 'none', temperature: 0.5 });
    });

    it('resuelve la configuración del experimento con el proveedor y el modelo configurados', async () => {
      const under = harness.setup();
      under.allowModel(CONTRACT_MODEL);

      const resolved = await under.provider.resolveEffectiveConfig();

      expect(typeof resolved.provider).toBe('string');
      expect(resolved.provider.length).toBeGreaterThan(0);
      expect(resolved.model).toBe(CONTRACT_MODEL);
      expect(resolved.reasoningEffort).toBe(CONTRACT_EFFORT);
      expect(resolved.modelVersion.length).toBeGreaterThan(0);
    });

    it('falla con MODEL_UNAVAILABLE cuando el modelo no se puede confirmar', async () => {
      const under = harness.setup();
      under.makeModelUnavailable();

      const error = await rejectionOf(under.provider.resolveEffectiveConfig());

      expect(error).toBeInstanceOf(LLMConfigurationError);
      expect(error).toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    });
  });

  describe('fallos externos del proveedor', () => {
    it.each([429, 500, 503])('HTTP %i se traduce a LLM_PROVIDER_UNAVAILABLE marcado como externo', async (status) => {
      const under = harness.setup();
      under.queueHttpFault(status, `fallo HTTP ${status}`);

      const error = await rejectionOf(under.provider.generate('prompt', effectiveConfig()));

      expect(error).toBeInstanceOf(LLMProviderUnavailableError);
      expect(error).toMatchObject({ code: ErrorCode.LLM_PROVIDER_UNAVAILABLE, externalFailure: true });
    });

    it('un error de conexión se traduce a LLM_PROVIDER_UNAVAILABLE marcado como externo', async () => {
      const under = harness.setup();
      under.queueConnectionFault('socket hang up');

      const error = await rejectionOf(under.provider.generateWithTools(
        [{ role: 'user', content: 'x' }],
        TOOLS,
        effectiveConfig(),
      ));

      expect(error).toBeInstanceOf(LLMProviderUnavailableError);
      expect(error).toMatchObject({ code: ErrorCode.LLM_PROVIDER_UNAVAILABLE, externalFailure: true });
    });

    it('un 400 no es externo y no se reintenta como fallo del proveedor', async () => {
      const under = harness.setup();
      under.queueHttpFault(400, 'petición inválida');

      const error = await rejectionOf(under.provider.generate('prompt', effectiveConfig()));

      expect(error).toBeInstanceOf(LLMProviderUnavailableError);
      expect(error).toMatchObject({ externalFailure: false });
    });
  });

  describe('configuración no soportada', () => {
    it('temperatura con razonamiento activo falla con LLMConfigurationError sin llamar al proveedor', async () => {
      const under = harness.setup();

      const error = await rejectionOf(under.provider.generate(
        'prompt',
        effectiveConfig({ reasoningEffort: 'low', temperature: 0.5 }),
      ));

      expect(error).toBeInstanceOf(LLMConfigurationError);
      expect(error).toMatchObject({ code: 'TEMPERATURE_UNSUPPORTED_WITH_REASONING' });
      expect(under.sent()).toHaveLength(0);
    });

    it('la misma regla se aplica en generateWithTools', async () => {
      const under = harness.setup();

      const error = await rejectionOf(under.provider.generateWithTools(
        [{ role: 'user', content: 'x' }],
        TOOLS,
        effectiveConfig({ reasoningEffort: 'medium', temperature: 0.3 }),
      ));

      expect(error).toBeInstanceOf(LLMConfigurationError);
      expect(error).toMatchObject({ code: 'TEMPERATURE_UNSUPPORTED_WITH_REASONING' });
      expect(under.sent()).toHaveLength(0);
    });
  });

  describe('ausencia de credenciales', () => {
    it('ni el mensaje de error ni los logs exponen la clave configurada', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const under = harness.setup();
      under.queueHttpFault(429, 'Rate limit exceeded.');

      const error = await rejectionOf(under.provider.generate('prompt', effectiveConfig()));

      const logged = [...warn.mock.calls, ...errorLog.mock.calls].flat().map(String).join('\n');
      expect(String((error as Error).message)).not.toContain(CONTRACT_SECRET);
      expect(JSON.stringify((error as LLMProviderUnavailableError).getResponse())).not.toContain(
        CONTRACT_SECRET,
      );
      expect(logged).not.toContain(CONTRACT_SECRET);
      expect(logged).not.toContain('SECRETO');
    });
  });
});
