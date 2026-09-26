import assert from 'node:assert/strict';
import test from 'node:test';
import { localDependencyIssues } from './work-item-dependencies.mjs';

test('local dependency blocks readiness and every executable phase until predecessor is done', () => {
  const dependency = { id: 'WI-CORE-009', status: 'W-IN_PROGRESS' };
  const itemById = new Map([[dependency.id, dependency]]);
  const item = { id: 'WI-CORE-003', dependsOn: [dependency.id], status: 'W-READY' };

  assert.match(localDependencyIssues(item, itemById)[0], /cannot be W-READY before dependency WI-CORE-009 finishes/);
  for (const status of ['W-SELECTED', 'W-SPEC_VERIFIED', 'W-AWAITING_APPROVAL', 'W-IN_PROGRESS', 'W-IN_REVIEW', 'W-DONE']) {
    item.status = status;
    assert.equal(localDependencyIssues(item, itemById).length, 1, status);
  }
  item.status = 'W-PLANNED';
  assert.deepEqual(localDependencyIssues(item, itemById), []);
  item.status = 'W-BLOCKED';
  assert.deepEqual(localDependencyIssues(item, itemById), []);
});

test('completed local dependency permits readiness', () => {
  const dependency = { id: 'WI-CORE-009', status: 'W-DONE' };
  const item = { id: 'WI-CORE-003', dependsOn: [dependency.id], status: 'W-READY' };
  assert.deepEqual(localDependencyIssues(item, new Map([[dependency.id, dependency]])), []);
});
