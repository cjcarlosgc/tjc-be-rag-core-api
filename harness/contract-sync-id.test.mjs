import test from 'node:test';
import assert from 'node:assert/strict';
import { contractSyncIdIssue } from './contract-sync-id.mjs';

test('accepts namespaced Contract Sync IDs with matching owner and local WI', () => {
  assert.equal(contractSyncIdIssue('CS-CORE-20260925-001', 'core', 'WI-CORE-003'), null);
  assert.equal(contractSyncIdIssue('CS-CONSOLE-20260925-001', 'console', 'WI-CONSOLE-003'), null);
  assert.equal(contractSyncIdIssue('CS-SANDBOX-20260925-001', 'sandbox', 'WI-SANDBOX-001'), null);
  assert.equal(contractSyncIdIssue('CS-GH-20260925-001', 'github-integration', 'WI-GH-001'), null);
});

test('rejects a namespace or sourceWorkItem from another component', () => {
  assert.match(contractSyncIdIssue('CS-GH-20260925-001', 'core', 'WI-GH-001'), /does not match/);
  assert.match(contractSyncIdIssue('CS-CORE-20260925-001', 'core', 'WI-GH-001'), /matching sourceWorkItem/);
  assert.match(contractSyncIdIssue('CS-CORE-20260925-001', 'core', undefined), /requires a matching sourceWorkItem/);
});

test('keeps historical unnamespaced IDs readable only before the cutover', () => {
  assert.equal(contractSyncIdIssue('CS-20260924-001', 'core', undefined), null);
  assert.match(contractSyncIdIssue('CS-20260925-001', 'core', undefined), /only valid as historical/);
  assert.equal(contractSyncIdIssue('CS-20260924-001', 'core', 'WI-CORE-003'), null);
  assert.match(contractSyncIdIssue('CS-20260924-001', 'core', 'WI-GH-001'), /does not match source/);
});
