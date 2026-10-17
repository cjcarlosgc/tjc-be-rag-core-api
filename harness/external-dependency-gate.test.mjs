import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { externalDependencyIssues } from './external-dependency-gate.mjs';
import { stableContractSyncPayload } from './contract-sync-lifecycle.mjs';

const dependencies = [{
  component: 'GH',
  repository: 'tjc-be-github-integration-api',
  workItemIds: ['WI-GH-002', 'WI-GH-003'],
  requiredStatus: 'W-DONE',
  requiredContractSync: 'imported-and-acknowledged',
  verification: 'manual-cross-repository',
}];
const makeUnpassedItem = (status = 'W-PLANNED') => ({
  id: 'WI-CORE-003', component: 'CORE', status, externalDependencies: dependencies,
  externalDependencyGate: { status: 'G-NOT_RUN', evidenceReport: null, sourceRevisions: {}, verifiedAt: null, verifiedBy: null },
});
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'external-gate-'));
const commit = 'a'.repeat(40);
const eventText = (sync) => [
  `id: ${sync.id}`,
  `source: ${sync.source}`,
  `sourceWorkItem: ${sync.sourceWorkItem}`,
  'targets: [core]',
  `sourceRevision: ${sync.sourceRevision}`,
  `status: ${sync.status}`,
  ...(sync.acknowledgementEvidence ? [`acknowledgementEvidence: ${sync.acknowledgementEvidence}`] : []),
].join('\n') + '\n';
const report = () => ({
  consumerWorkItem: 'WI-CORE-003',
  verifiedBy: 'human-reviewer',
  verifiedAt: '2026-09-25T08:00:00.000Z',
  sourceRepositories: [{ component: 'GH', repository: 'tjc-be-github-integration-api', sourceRevision: commit }],
  upstreamWorkItems: dependencies[0].workItemIds.map((workItemId, workItemIndex) => ({
    workItemId,
    status: 'W-DONE',
    completionEvidence: `harness/reports/${workItemId.toLowerCase()}-implementation.md`,
    contractSyncs: [1, 2].map((sequence) => {
      const sync = {
        id: `CS-GH-20260925-${String((workItemIndex * 2) + sequence).padStart(3, '0')}`,
        source: 'github-integration',
        sourceWorkItem: workItemId,
        sourceRevision: `${workItemIndex}${sequence}c0ffee`,
        targets: ['core'],
        status: 'C-ACKNOWLEDGED',
        acknowledgementEvidence: 'harness/reports/external-dependency-verification-wi-core-003.json',
      };
      return {
        ...sync,
        payloadSha256: createHash('sha256').update(stableContractSyncPayload(eventText({ ...sync, status: 'C-PENDING', acknowledgementEvidence: undefined }))).digest('hex'),
      };
    }),
  })),
});
const event = (sync) => ({
  id: sync.id,
  text: eventText(sync),
});
function verifiedFixture(t) {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidenceReport = 'harness/reports/external-dependency-verification-wi-core-003.json';
  const evidencePath = path.join(root, evidenceReport);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const contents = report();
  fs.writeFileSync(evidencePath, `${JSON.stringify(contents, null, 2)}\n`);
  const item = {
    ...makeUnpassedItem('W-READY'),
    externalDependencyGate: {
      status: 'G-PASSED', evidenceReport, sourceRevisions: { GH: commit },
      verifiedAt: contents.verifiedAt, verifiedBy: contents.verifiedBy,
    },
  };
  return { root, item, events: contents.upstreamWorkItems.flatMap((upstream) => upstream.contractSyncs.map(event)) };
}

test('a gate not passed prohibits promoting the consumer WI', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.match(externalDependencyIssues(makeUnpassedItem('W-READY'), { root }).join('\n'), /cannot be W-READY/);
  assert.deepEqual(externalDependencyIssues(makeUnpassedItem(), { root }), []);
});

test('a passed gate accepts a human report and every imported acknowledged/resolved event', (t) => {
  const fixture = verifiedFixture(t);
  assert.deepEqual(externalDependencyIssues(fixture.item, fixture), []);
  const resolutionEvidence = path.join(fixture.root, 'harness/reports/core-implementation.md');
  fs.writeFileSync(resolutionEvidence, 'Core consumer implementation evidence.');
  const upgraded = fixture.events.map((entry) => ({
    ...entry,
    text: `${entry.text.replace('status: C-ACKNOWLEDGED', 'status: C-RESOLVED').trimEnd()}\nresolutionEvidence: harness/reports/core-implementation.md\n`,
  }));
  assert.deepEqual(externalDependencyIssues(fixture.item, { ...fixture, events: upgraded }), []);
});

test('a passed gate rejects missing imports, unresolved events, and incomplete upstream completion evidence', (t) => {
  const fixture = verifiedFixture(t);
  const missingImport = externalDependencyIssues(fixture.item, { ...fixture, events: fixture.events.slice(1) });
  assert(missingImport.some((issue) => /has not been imported/.test(issue)));

  const unresolvedEvents = fixture.events.map((entry) => ({ ...entry, text: entry.text.replace('C-ACKNOWLEDGED', 'C-PENDING') }));
  const unresolved = externalDependencyIssues(fixture.item, { ...fixture, events: unresolvedEvents });
  assert(unresolved.some((issue) => /does not match its verification report/.test(issue)));

  const evidencePath = path.join(fixture.root, fixture.item.externalDependencyGate.evidenceReport);
  const contents = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  contents.upstreamWorkItems[0].status = 'W-IN_REVIEW';
  fs.writeFileSync(evidencePath, JSON.stringify(contents));
  const notDone = externalDependencyIssues(fixture.item, fixture);
  assert(notDone.some((issue) => /WI-GH-002 is not attested W-DONE/.test(issue)));
});

test('a passed gate rejects a source SHA inconsistent with the recorded revision', (t) => {
  const fixture = verifiedFixture(t);
  const evidencePath = path.join(fixture.root, fixture.item.externalDependencyGate.evidenceReport);
  const contents = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  contents.sourceRepositories[0].sourceRevision = 'b'.repeat(40);
  fs.writeFileSync(evidencePath, JSON.stringify(contents));
  assert(externalDependencyIssues(fixture.item, fixture).some((issue) => /source revision is missing or inconsistent/.test(issue)));
});

test('a passed gate rejects an imported event omitted from the upstream inventory', (t) => {
  const fixture = verifiedFixture(t);
  const extraId = 'CS-GH-20260925-009';
  const extra = { ...fixture.events[0], id: extraId, text: fixture.events[0].text.replace(fixture.events[0].id, extraId) };
  assert(externalDependencyIssues(fixture.item, { ...fixture, events: [...fixture.events, extra] })
    .some((issue) => /report omits or duplicates/.test(issue)));
});
