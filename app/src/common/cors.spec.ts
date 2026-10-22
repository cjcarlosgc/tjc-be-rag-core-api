import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsoleCorsOrigin, parseConsoleCorsOrigins } from './cors.js';

const decide = (read: () => string | undefined, origin: string | undefined) => {
  const callback = vi.fn();
  createConsoleCorsOrigin(read)(origin, callback);
  return callback.mock.calls[0];
};

describe('CORS de la Console', () => {
  it('normaliza la lista y descarta vacíos y barras finales', () => {
    expect(parseConsoleCorsOrigins(' https://a.test/ , ,https://b.test ')).toEqual(['https://a.test', 'https://b.test']);
    expect(parseConsoleCorsOrigins('')).toBeNull();
    expect(parseConsoleCorsOrigins(undefined)).toBeNull();
  });

  it('con lista configurada solo permite esos orígenes y las peticiones sin Origin', () => {
    const read = () => 'https://console.test';
    expect(decide(read, 'https://console.test')).toEqual([null, true]);
    expect(decide(read, 'https://otro.test')).toEqual([null, false]);
    expect(decide(read, undefined)).toEqual([null, true]);
  });

  it('sin configurar conserva el comportamiento abierto', () => {
    expect(decide(() => undefined, 'https://cualquiera.test')).toEqual([null, true]);
  });
});

describe('aviso de CORS abierto (WI-CORE-074, F5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Carga un módulo de CORS y de Nest frescos: el flag de aviso es de módulo y dura lo que el módulo. */
  async function freshCors() {
    vi.resetModules();
    const { Logger } = await import('@nestjs/common');
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const cors = await import('./cors.js');
    return { cors, warn };
  }

  it('avisa una sola vez aunque HTTP y el gateway creen cada uno su delegado', async () => {
    const { cors, warn } = await freshCors();
    const http = cors.createConsoleCorsOrigin(() => undefined);
    const gateway = cors.createConsoleCorsOrigin(() => undefined);

    for (const delegate of [http, gateway, http, gateway]) {
      delegate(undefined, vi.fn());
    }

    const openWarnings = warn.mock.calls.filter(([message]) => String(message).includes('CORS queda abierto'));
    expect(openWarnings).toHaveLength(1);
  });

  it('no avisa cuando la lista está configurada y el comportamiento de CORS no cambia', async () => {
    const { cors, warn } = await freshCors();
    const callback = vi.fn();

    cors.createConsoleCorsOrigin(() => 'https://console.test')('https://otro.test', callback);

    expect(callback).toHaveBeenCalledWith(null, false);
    expect(warn.mock.calls.filter(([message]) => String(message).includes('CORS queda abierto'))).toHaveLength(0);
  });
});
