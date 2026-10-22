import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_STALE_MIN_INTERVAL_FACTOR,
  isHeartbeatExpired,
  isPersistedExternalFailure,
  remainingUntilExpiryMs,
  resolveHeartbeatStaleMs,
  resolveSlotAction,
  sandboxHttpBoundMs,
  type AttemptRecoveryRow,
} from './attempt-recovery.js';
import {
  DEFAULT_POLL_RETRIES,
  DEFAULT_POLL_RETRY_DELAY_MS,
  MAX_POLL_AFTER_MS,
} from '../sandbox/sandbox-execution.service.js';

const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const STALE = 60_000;

function row(overrides: Partial<AttemptRecoveryRow> & { id?: string } = {}) {
  return {
    id: 'row-1',
    state: 'RUNNING',
    attempt: 1,
    failureType: null,
    sandboxTimedOut: null,
    lastHeartbeatAt: null,
    createdAt: null,
    errorSummary: null,
    ...overrides,
  };
}

describe('isHeartbeatExpired', () => {
  it('treats a heartbeat newer than the threshold as live', () => {
    expect(isHeartbeatExpired(row({ lastHeartbeatAt: new Date(NOW - 10_000) }), NOW, STALE)).toBe(false);
  });

  it('treats a heartbeat older than the threshold as expired', () => {
    expect(isHeartbeatExpired(row({ lastHeartbeatAt: new Date(NOW - STALE - 1) }), NOW, STALE)).toBe(true);
  });

  it('uses createdAt for pre-migration rows whose heartbeat is NULL', () => {
    expect(isHeartbeatExpired(row({ createdAt: new Date(NOW - 5_000) }), NOW, STALE)).toBe(false);
    expect(isHeartbeatExpired(row({ createdAt: new Date(NOW - 3_600_000) }), NOW, STALE)).toBe(true);
  });

  it('treats a row without any timestamp as expired (documented decision)', () => {
    expect(isHeartbeatExpired(row(), NOW, STALE)).toBe(true);
  });

  it('reports the time left before a live heartbeat expires', () => {
    expect(remainingUntilExpiryMs(row({ lastHeartbeatAt: new Date(NOW - 10_000) }), NOW, STALE)).toBe(50_000);
  });
});

describe('resolveSlotAction', () => {
  it('starts attempt 1 for a slot without any attempt', () => {
    expect(resolveSlotAction(undefined, NOW, STALE)).toEqual({ kind: 'RUN', attempt: 1, expiredAttempt: null });
  });

  it('never touches a RUNNING attempt whose heartbeat is live (IN_FLIGHT)', () => {
    const live = row({ attempt: 1, lastHeartbeatAt: new Date(NOW - 1_000) });
    expect(resolveSlotAction(live, NOW, STALE)).toEqual({ kind: 'IN_FLIGHT', row: live });

    const liveSecond = row({ attempt: 2, lastHeartbeatAt: new Date(NOW - 1_000) });
    expect(resolveSlotAction(liveSecond, NOW, STALE)).toEqual({ kind: 'IN_FLIGHT', row: liveSecond });
  });

  it('turns an expired attempt 1 into attempt 2 and asks to close the interrupted attempt 1', () => {
    const expired = row({ attempt: 1, lastHeartbeatAt: new Date(NOW - STALE - 1) });
    expect(resolveSlotAction(expired, NOW, STALE)).toEqual({
      kind: 'RUN',
      attempt: 2,
      expiredAttempt: expired,
    });
  });

  it('closes an expired attempt 2 without ever producing a third attempt', () => {
    const expiredSecond = row({ attempt: 2, lastHeartbeatAt: new Date(NOW - STALE - 1) });
    expect(resolveSlotAction(expiredSecond, NOW, STALE)).toEqual({
      kind: 'CLOSE_EXPIRED_SECOND',
      row: expiredSecond,
    });
  });

  it('retries an attempt 1 with a persisted external failure, once', () => {
    const external = row({ state: 'FAILED', failureType: 'INFRASTRUCTURE', sandboxTimedOut: null });
    expect(resolveSlotAction(external, NOW, STALE)).toEqual({ kind: 'RUN', attempt: 2, expiredAttempt: null });
  });

  it('does not retry a sandbox timeout (not an external failure)', () => {
    const timedOut = row({ state: 'FAILED', failureType: 'INFRASTRUCTURE', sandboxTimedOut: true });
    expect(resolveSlotAction(timedOut, NOW, STALE)).toEqual({ kind: 'SKIP' });
  });

  it('skips a slot whose attempt 2 is already terminal', () => {
    const terminalSecond = row({ state: 'FAILED', attempt: 2, failureType: 'INFRASTRUCTURE' });
    expect(resolveSlotAction(terminalSecond, NOW, STALE)).toEqual({ kind: 'SKIP' });
    expect(resolveSlotAction(row({ state: 'COMPLETED', attempt: 2 }), NOW, STALE)).toEqual({ kind: 'SKIP' });
  });

  it('recognises only INFRASTRUCTURE failures that are not sandbox timeouts as external', () => {
    expect(isPersistedExternalFailure(row({ state: 'FAILED', failureType: 'INFRASTRUCTURE' }))).toBe(true);
    expect(isPersistedExternalFailure(row({ state: 'FAILED', failureType: 'UNKNOWN' }))).toBe(false);
    expect(isPersistedExternalFailure(row({ state: 'COMPLETED', failureType: null }))).toBe(false);
  });
});

describe('sandboxHttpBoundMs (WI-CORE-071: reintentos de GET incluidos)', () => {
  // Defaults de Core: timeout 10_000, 120 consultas de estado, 3 reintentos, base 500, tope de espera 30_000.
  const DEFAULT_BOUND_ARGS = [10_000, 120, DEFAULT_POLL_RETRIES, DEFAULT_POLL_RETRY_DELAY_MS, MAX_POLL_AFTER_MS] as const;

  it('con los defaults vale 5_273_500 ms: POST + 121 GET de 43_500 ms (4 timeouts + esperas 500, 1_000, 2_000)', () => {
    expect(DEFAULT_POLL_RETRIES).toBe(3);
    expect(DEFAULT_POLL_RETRY_DELAY_MS).toBe(500);
    expect(MAX_POLL_AFTER_MS).toBe(30_000);
    expect(sandboxHttpBoundMs(...DEFAULT_BOUND_ARGS)).toBe(5_273_500);
    expect(10_000 + 121 * 43_500).toBe(5_273_500);
  });

  it('con SANDBOX_POLL_RETRIES=0 coincide exactamente con la fórmula anterior T * (P + 2)', () => {
    expect(sandboxHttpBoundMs(10_000, 120, 0, 500, MAX_POLL_AFTER_MS)).toBe(1_220_000);
    expect(sandboxHttpBoundMs(10_000, 120, 0, 500, MAX_POLL_AFTER_MS)).toBe(10_000 * (120 + 2));
    expect(sandboxHttpBoundMs(7_000, 33, 0, 1, MAX_POLL_AFTER_MS)).toBe(7_000 * (33 + 2));
  });

  it('acota cada espera de reintento por MAX_POLL_AFTER_MS cuando la base es alta', () => {
    // Esperas: min(20_000, 30_000) = 20_000; min(40_000, 30_000) = 30_000; min(80_000, 30_000) = 30_000.
    // Un solo GET (P = 0, solo el de resultado): T + (4 * T + 80_000) = 10_000 + 40_000 + 80_000.
    expect(sandboxHttpBoundMs(10_000, 0, 3, 20_000, 30_000)).toBe(130_000);
  });

  it('normaliza valores de entorno en texto antes de sumar (no concatena)', () => {
    const fromEnv = sandboxHttpBoundMs(
      '10000' as unknown as number,
      '120' as unknown as number,
      '3' as unknown as number,
      '500' as unknown as number,
      MAX_POLL_AFTER_MS,
    );
    expect(fromEnv).toBe(5_273_500);
  });

  it('suma los reintentos a cada GET de estado y al de resultado, sin tocar el POST', () => {
    // P = 1: POST (T) + 2 GET de (R+1)·T + esperas = 2 · (2·T + 1_500) con R = 1 y base 1_000 -> 2 · (20_000 + 1_000).
    expect(sandboxHttpBoundMs(10_000, 1, 1, 1_000, MAX_POLL_AFTER_MS)).toBe(10_000 + 2 * (20_000 + 1_000));
  });
});

describe('resolveHeartbeatStaleMs', () => {
  it('defaults to the run generation timeout plus the Sandbox HTTP bound with GET retries (WI-CORE-071)', () => {
    const bound = sandboxHttpBoundMs(10_000, 120, DEFAULT_POLL_RETRIES, DEFAULT_POLL_RETRY_DELAY_MS, MAX_POLL_AFTER_MS);
    expect(bound).toBe(5_273_500);
    expect(
      resolveHeartbeatStaleMs({
        configuredMs: undefined,
        intervalMs: 15_000,
        generationTimeoutMs: 120_000,
        sandboxHttpBoundMs: bound,
      }),
    ).toBe(5_393_500);
  });

  it('with SANDBOX_POLL_RETRIES=0 the default stays at the previous 1_340_000 ms', () => {
    const bound = sandboxHttpBoundMs(10_000, 120, 0, DEFAULT_POLL_RETRY_DELAY_MS, MAX_POLL_AFTER_MS);
    expect(
      resolveHeartbeatStaleMs({
        configuredMs: undefined,
        intervalMs: 15_000,
        generationTimeoutMs: 120_000,
        sandboxHttpBoundMs: bound,
      }),
    ).toBe(1_340_000);
  });

  it('a configured EXPERIMENT_HEARTBEAT_STALE_MS still wins over the new default bound', () => {
    expect(
      resolveHeartbeatStaleMs({
        configuredMs: 600_000,
        intervalMs: 15_000,
        generationTimeoutMs: 120_000,
        sandboxHttpBoundMs: 5_273_500,
      }),
    ).toBe(600_000);
  });

  it('uses a configured value when it is above the minimum', () => {
    expect(
      resolveHeartbeatStaleMs({
        configuredMs: 600_000,
        intervalMs: 15_000,
        generationTimeoutMs: 120_000,
        sandboxHttpBoundMs: 1_220_000,
      }),
    ).toBe(600_000);
  });

  it('never goes below three heartbeat intervals, even when configured lower', () => {
    expect(HEARTBEAT_STALE_MIN_INTERVAL_FACTOR).toBe(3);
    expect(
      resolveHeartbeatStaleMs({
        configuredMs: 10_000,
        intervalMs: 15_000,
        generationTimeoutMs: 120_000,
        sandboxHttpBoundMs: 1_220_000,
      }),
    ).toBe(45_000);
  });
});
