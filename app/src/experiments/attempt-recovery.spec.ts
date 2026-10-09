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

describe('resolveHeartbeatStaleMs', () => {
  it('defaults to the run generation timeout plus the Sandbox HTTP bound', () => {
    const bound = sandboxHttpBoundMs(10_000, 120);
    expect(bound).toBe(1_220_000);
    expect(
      resolveHeartbeatStaleMs({
        configuredMs: undefined,
        intervalMs: 15_000,
        generationTimeoutMs: 120_000,
        sandboxHttpBoundMs: bound,
      }),
    ).toBe(1_340_000);
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
