import { describe, expect, it, vi } from 'vitest';
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
