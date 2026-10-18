import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { registerProcessSafetyNets } from './process-safety.js';

describe('registerProcessSafetyNets', () => {
  it('registra una promesa rechazada sin apagar el proceso', () => {
    const proc = new EventEmitter();
    const logger = { error: vi.fn() };
    const shutdown = vi.fn();
    registerProcessSafetyNets(logger, shutdown, proc as never);

    proc.emit('unhandledRejection', new Error('boom'));

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('ante una excepción no capturada registra y apaga una sola vez con código 1', () => {
    const proc = new EventEmitter();
    const logger = { error: vi.fn() };
    const shutdown = vi.fn();
    registerProcessSafetyNets(logger, shutdown, proc as never);

    proc.emit('uncaughtException', new Error('fatal'));
    proc.emit('uncaughtException', new Error('otra'));

    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith(1);
  });

  it('la función devuelta quita los manejadores', () => {
    const proc = new EventEmitter();
    const off = registerProcessSafetyNets({ error: vi.fn() }, vi.fn(), proc as never);
    off();
    expect(proc.listenerCount('unhandledRejection')).toBe(0);
    expect(proc.listenerCount('uncaughtException')).toBe(0);
  });
});
