import { describe, expect, it } from 'vitest';
import { parseEffectiveConfig } from './experiment-job.helpers.js';

// WI-CORE-089: `parseEffectiveConfig` acepta cualquier identificador de proveedor no vacío y lo conserva;
// con datos existentes (provider 'openai') devuelve lo mismo que antes.
describe('parseEffectiveConfig (WI-CORE-089)', () => {
  const persisted = {
    provider: 'openai',
    model: 'gpt-6-luna',
    modelVersion: 'gpt-6-luna-2026',
    reasoningEffort: 'medium',
    temperature: 0.2,
    maxOutputTokens: 4000,
    endpoint: 'responses',
  };

  it('devuelve exactamente la misma configuración para una corrida de OpenAI con endpoint', () => {
    expect(parseEffectiveConfig(persisted)).toStrictEqual(persisted);
  });

  it('devuelve la misma configuración para una corrida anterior sin endpoint', () => {
    const { endpoint: _endpoint, ...withoutEndpoint } = persisted;
    expect(parseEffectiveConfig(withoutEndpoint)).toStrictEqual(withoutEndpoint);
  });

  it('normaliza campos opcionales ausentes a null como antes', () => {
    expect(
      parseEffectiveConfig({ provider: 'openai', model: 'm', modelVersion: 'm' }),
    ).toStrictEqual({
      provider: 'openai',
      model: 'm',
      modelVersion: 'm',
      reasoningEffort: null,
      temperature: null,
      maxOutputTokens: null,
    });
  });

  it('conserva un identificador de proveedor distinto de openai sin reescribirlo', () => {
    const otherProvider = { ...persisted, provider: 'otro-proveedor', endpoint: 'messages' };
    const parsed = parseEffectiveConfig(otherProvider);
    expect(parsed.provider).toBe('otro-proveedor');
    expect(parsed.endpoint).toBe('messages');
  });

  it('no añade endpoint si no es texto', () => {
    const parsed = parseEffectiveConfig({ ...persisted, endpoint: 42 });
    expect(parsed).not.toHaveProperty('endpoint');
  });

  it.each([
    ['no es objeto', 'openai'],
    ['es null', null],
    ['provider ausente', { model: 'm', modelVersion: 'm' }],
    ['provider vacío', { provider: '  ', model: 'm', modelVersion: 'm' }],
    ['provider no es texto', { provider: 7, model: 'm', modelVersion: 'm' }],
    ['model no es texto', { provider: 'openai', model: 1, modelVersion: 'm' }],
    ['modelVersion no es texto', { provider: 'openai', model: 'm', modelVersion: null }],
  ])('rechaza la configuración cuando %s', (_name, value) => {
    expect(() => parseEffectiveConfig(value)).toThrow(
      'modelConfig del experimento no es válido.',
    );
  });
});
