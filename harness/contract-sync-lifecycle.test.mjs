import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalContractSyncStatus,
  contractSyncImportTime,
  contractSyncTransitionText,
  stableContractSyncPayload,
  contractSyncWasKnownAt,
} from './contract-sync-lifecycle.mjs';

const pendingEvent = [
  'type: CONTRACT_SYNC',
  'id: CS-GH-20260925-001',
  'source: github-integration',
  'sourceWorkItem: WI-GH-002',
  'targets: [core]',
  'sourceRevision: a1b2c3d',
  'status: C-PENDING',
  '',
].join('\n');

test('legacy lifecycle spellings normalize without rewriting historical records', () => {
  assert.equal(canonicalContractSyncStatus('ACKNOWLEDGED'), 'C-ACKNOWLEDGED');
  assert.equal(canonicalContractSyncStatus('C-RESOLVED'), 'C-RESOLVED');
});

test('a consumer can acknowledge then resolve with evidence, but cannot skip or regress', () => {
  const ack = contractSyncTransitionText(pendingEvent, 'acknowledge', 'harness/reports/ack.md');
  assert.match(ack, /status: C-ACKNOWLEDGED/);
  assert.match(ack, /acknowledgementEvidence: harness\/reports\/ack\.md/);
  const resolved = contractSyncTransitionText(ack, 'resolve', 'harness/reports/implementation.md');
  assert.match(resolved, /status: C-RESOLVED/);
  assert.match(resolved, /resolutionEvidence: harness\/reports\/implementation\.md/);
  assert.throws(() => contractSyncTransitionText(pendingEvent, 'resolve', 'harness/reports/implementation.md'), /cannot resolve.*C-PENDING/);
  const acknowledgedAgain = contractSyncTransitionText(resolved, 'acknowledge', 'harness/reports/ack.md');
  assert.match(acknowledgedAgain, /status: C-RESOLVED/);
  assert.equal(acknowledgedAgain, resolved);
  assert.throws(() => contractSyncTransitionText(resolved, 'acknowledge', 'harness/reports/replacement-ack.md'), /cannot replace existing acknowledgementEvidence/);
  assert.equal(contractSyncTransitionText(resolved, 'resolve', 'harness/reports/implementation.md'), resolved);
  assert.throws(() => contractSyncTransitionText(resolved, 'resolve', 'harness/reports/replacement-implementation.md'), /cannot replace existing resolutionEvidence/);
  assert.throws(() => contractSyncTransitionText(ack, 'acknowledge', 'harness/reports/replacement-ack.md'), /cannot replace existing acknowledgementEvidence/);
});

test('idempotent source import ignores consumer-owned lifecycle and evidence fields, not payload changes', () => {
  const ack = contractSyncTransitionText(pendingEvent, 'acknowledge', 'harness/reports/ack.md');
  const resolved = contractSyncTransitionText(ack, 'resolve', 'harness/reports/implementation.md');
  assert.equal(stableContractSyncPayload(pendingEvent), stableContractSyncPayload(resolved));
  assert.notEqual(stableContractSyncPayload(pendingEvent), stableContractSyncPayload(pendingEvent.replace('targets: [core]', 'targets: [console]')));
});

test('consumer import time is local metadata and prevents later imports changing a closed snapshot', () => {
  const source = `${pendingEvent.trimEnd()}\n`;
  const imported = `${source}consumerImportedAt: 2026-09-25T15:21:50.000Z\n`;
  assert.equal(contractSyncImportTime(imported), Date.parse('2026-09-25T15:21:50.000Z'));
  assert.equal(contractSyncWasKnownAt(imported, '2026-09-25T14:28:43.342Z'), false);
  assert.equal(contractSyncWasKnownAt(imported, '2026-09-25T16:00:00.000Z'), true);
  assert.equal(contractSyncWasKnownAt(source, '2026-09-25T14:28:43.342Z'), true, 'legacy events without an import timestamp remain conservatively in-snapshot');
  assert.equal(contractSyncImportTime(imported.replace('2026-09-25T15:21:50.000Z', 'invalid')), Number.NaN);
  assert.equal(stableContractSyncPayload(source), stableContractSyncPayload(imported));
});
