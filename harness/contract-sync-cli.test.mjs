import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..');
const sourceEvent = [
  'type: CONTRACT_SYNC',
  'id: CS-GH-20260925-001',
  'source: github-integration',
  'sourceWorkItem: WI-GH-002',
  'targets: [core]',
  'scopePaths: [spec/contracts/github-integration-contract.md]',
  'breaking: false',
  'changed:',
  '  - approved GH API is ready',
  'requiredAction:',
  '  - integrate the private API from Core',
  'sourceRevision: a1b2c3d',
  'status: C-PENDING',
  '',
].join('\n');

function run(root, args) {
  return spawnSync(process.execPath, ['harness/contract-sync.mjs', ...args], { cwd: root, encoding: 'utf8' });
}

test('Contract Sync import preserves local ACK/RESOLVED states and checkpoints gate each phase', (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-sync-cli-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const inbox = path.join(temporaryRoot, 'harness/contract-sync/inbox');
  const outbox = path.join(temporaryRoot, 'harness/contract-sync/outbox');
  const reports = path.join(temporaryRoot, 'harness/reports');
  const producerOutbox = path.join(temporaryRoot, 'producer/outbox');
  fs.mkdirSync(inbox, { recursive: true });
  fs.mkdirSync(outbox, { recursive: true });
  fs.mkdirSync(reports, { recursive: true });
  fs.mkdirSync(producerOutbox, { recursive: true });
  for (const file of ['contract-sync.mjs', 'contract-sync-id.mjs', 'contract-sync-lifecycle.mjs']) {
    fs.copyFileSync(path.join(scriptDirectory, file), path.join(temporaryRoot, 'harness', file));
  }
  fs.writeFileSync(path.join(producerOutbox, 'CS-GH-20260925-001.yaml'), sourceEvent);
  fs.writeFileSync(path.join(reports, 'ack.md'), 'Acknowledged this dependency for WI-CORE-003.');
  fs.writeFileSync(path.join(reports, 'implementation.md'), 'Implemented the acknowledged dependency in WI-CORE-003.');

  const registered = {
    id: 'WI-CORE-003', component: 'CORE', status: 'W-IN_PROGRESS',
    specPaths: ['spec/contracts/github-integration-contract.md'],
    contractImpact: true,
  };
  fs.writeFileSync(path.join(temporaryRoot, 'harness/work-items.json'), JSON.stringify({ component: 'CORE', workItems: [registered] }));
  fs.writeFileSync(path.join(temporaryRoot, 'harness/state.json'), JSON.stringify({
    planningBaseline: '2026-09-24-core-console-transition',
    activeWorkItem: {
      id: registered.id, status: registered.status, transversalPaths: [],
      gates: { implementationCompleted: 'G-NOT_RUN' },
      gateEvidence: { implementationCompleted: [] },
      coordination: { pullCheckpoints: [] },
    },
  }));

  const premarkedSources = [
    {
      text: sourceEvent.replace('status: C-PENDING', 'status: C-ACKNOWLEDGED')
        .replace(/\n$/, '\nacknowledgementEvidence: harness/reports/ack.md\n'),
      error: /must be published as C-PENDING/,
    },
    {
      text: sourceEvent.replace('status: C-PENDING', 'status: C-RESOLVED')
        .replace(/\n$/, '\nacknowledgementEvidence: harness/reports/ack.md\nresolutionEvidence: harness/reports/implementation.md\n'),
      error: /must be published as C-PENDING/,
    },
    {
      text: sourceEvent.replace(/\n$/, '\nacknowledgementEvidence: harness/reports/ack.md\n'),
      error: /cannot include consumer lifecycle evidence/,
    },
    {
      text: sourceEvent.replace(/\n$/, '\nconsumerImportedAt: 2026-09-25T15:21:50.000Z\n'),
      error: /cannot include consumer-owned import metadata/,
    },
  ];
  for (const premarkedSource of premarkedSources) {
    fs.writeFileSync(path.join(producerOutbox, 'CS-GH-20260925-001.yaml'), premarkedSource.text);
    const premadeLifecycle = run(temporaryRoot, ['import', '--from', producerOutbox]);
    assert.notEqual(premadeLifecycle.status, 0);
    assert.match(premadeLifecycle.stderr, premarkedSource.error);
    assert.equal(fs.existsSync(path.join(inbox, 'CS-GH-20260925-001.yaml')), false);
  }
  fs.writeFileSync(path.join(producerOutbox, 'CS-GH-20260925-001.yaml'), sourceEvent);

  assert.equal(run(temporaryRoot, ['import', '--from', producerOutbox]).status, 0);
  const importedEventPath = path.join(inbox, 'CS-GH-20260925-001.yaml');
  const firstImportedAt = fs.readFileSync(importedEventPath, 'utf8').match(/^consumerImportedAt: (.+)$/m)?.[1];
  assert.ok(Number.isFinite(Date.parse(firstImportedAt)));
  assert.equal(run(temporaryRoot, ['acknowledge', '--id', 'CS-GH-20260925-001', '--work-item', registered.id, '--evidence', 'harness/reports/ack.md']).status, 0);
  assert.equal(run(temporaryRoot, ['import', '--from', producerOutbox]).status, 0);
  assert.equal(fs.readFileSync(importedEventPath, 'utf8').match(/^consumerImportedAt: (.+)$/m)?.[1], firstImportedAt);
  const start = run(temporaryRoot, ['check', '--checkpoint', 'start', '--work-item', registered.id, '--record']);
  assert.equal(start.status, 0, start.stderr);
  assert.deepEqual(JSON.parse(start.stdout).acknowledgedSyncIds, ['CS-GH-20260925-001']);

  const prematureDelivery = run(temporaryRoot, ['check', '--checkpoint', 'implementation-delivery', '--work-item', registered.id]);
  assert.equal(prematureDelivery.status, 2);
  assert.deepEqual(JSON.parse(prematureDelivery.stdout).relevantPendingSyncIds, ['CS-GH-20260925-001']);

  const prematureResolve = run(temporaryRoot, ['resolve', '--id', 'CS-GH-20260925-001', '--work-item', registered.id, '--evidence', 'harness/reports/implementation.md']);
  assert.notEqual(prematureResolve.status, 0);
  assert.match(prematureResolve.stderr, /implementationCompleted G-PASSED/);
  const localStatePath = path.join(temporaryRoot, 'harness/state.json');
  const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
  localState.activeWorkItem.gates.implementationCompleted = 'G-PASSED';
  fs.writeFileSync(localStatePath, JSON.stringify(localState));

  const missingGateEvidence = run(temporaryRoot, ['resolve', '--id', 'CS-GH-20260925-001', '--work-item', registered.id, '--evidence', 'harness/reports/implementation.md']);
  assert.notEqual(missingGateEvidence.status, 0);
  assert.match(missingGateEvidence.stderr, /gateEvidence\.implementationCompleted report/);
  localState.activeWorkItem.gateEvidence.implementationCompleted = ['harness/reports/implementation.md'];
  fs.writeFileSync(localStatePath, JSON.stringify(localState));

  assert.equal(run(temporaryRoot, ['resolve', '--id', 'CS-GH-20260925-001', '--work-item', registered.id, '--evidence', 'harness/reports/implementation.md']).status, 0);
  assert.equal(run(temporaryRoot, ['import', '--from', producerOutbox]).status, 0);
  const delivery = run(temporaryRoot, ['check', '--checkpoint', 'implementation-delivery', '--work-item', registered.id, '--record']);
  assert.equal(delivery.status, 0, delivery.stderr);
  assert.deepEqual(JSON.parse(delivery.stdout).resolvedSyncIds, ['CS-GH-20260925-001']);

  const changedSource = sourceEvent.replace('approved GH API is ready', 'changed contract content under reused ID');
  fs.writeFileSync(path.join(producerOutbox, 'CS-GH-20260925-001.yaml'), changedSource);
  assert.match(run(temporaryRoot, ['import', '--from', producerOutbox]).stderr, /conflicting event/);
  const local = fs.readFileSync(path.join(inbox, 'CS-GH-20260925-001.yaml'), 'utf8');
  assert.match(local, /status: C-RESOLVED/);
  assert.match(local, /resolutionEvidence: harness\/reports\/implementation\.md/);
});
