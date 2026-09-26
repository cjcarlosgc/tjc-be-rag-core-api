import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalContractSyncStatus, stableContractSyncPayload } from './contract-sync-lifecycle.mjs';

const sourceByComponent = new Map([
  ['CORE', 'core'],
  ['CONSOLE', 'console'],
  ['SANDBOX', 'sandbox'],
  ['GH', 'github-integration'],
]);
const statusesThatRequirePassedGate = new Set([
  'W-READY', 'W-SELECTED', 'W-SPEC_VERIFIED', 'W-AWAITING_APPROVAL',
  'W-IN_PROGRESS', 'W-IN_REVIEW', 'W-DONE', 'W-BLOCKED', 'W-DECISION_REQUIRED',
]);
const isSafeReportPath = (value) => typeof value === 'string'
  && value.startsWith('harness/reports/')
  && !value.split('/').includes('..')
  && !path.isAbsolute(value);
const isCommit = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
const parseField = (text, name) => text.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim();
const parseList = (text, name) => text.match(new RegExp(`^${name}:\\s*\\[([^\\]]*)\\]$`, 'm'))?.[1]
  ?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];

export function externalDependencyIssues(item, { root, events = [] }) {
  const issues = [];
  const dependencies = item.externalDependencies;
  const gate = item.externalDependencyGate;

  if (dependencies === undefined) {
    if (gate !== undefined) issues.push('externalDependencyGate requires externalDependencies');
    return issues;
  }
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    issues.push('externalDependencies must be a non-empty array');
    return issues;
  }
  if (!gate || !['G-NOT_RUN', 'G-PASSED', 'G-FAILED'].includes(gate.status)) {
    issues.push('external dependencies require a G-NOT_RUN, G-PASSED or G-FAILED gate');
    return issues;
  }

  const expected = new Map();
  for (const dependency of dependencies) {
    const source = sourceByComponent.get(dependency?.component);
    if (!source || dependency.component === item.component) issues.push(`invalid external dependency component: ${dependency?.component}`);
    if (typeof dependency?.repository !== 'string' || !dependency.repository.trim()) issues.push(`external dependency repository is required: ${dependency?.component}`);
    if (dependency?.requiredStatus !== 'W-DONE' || dependency?.requiredContractSync !== 'imported-and-acknowledged' || dependency?.verification !== 'manual-cross-repository') {
      issues.push(`external dependency policy is incomplete: ${dependency?.component}`);
    }
    if (!Array.isArray(dependency?.workItemIds) || dependency.workItemIds.length === 0) {
      issues.push(`external dependency workItemIds must be non-empty: ${dependency?.component}`);
      continue;
    }
    for (const workItemId of dependency.workItemIds) {
      if (typeof workItemId !== 'string' || !new RegExp(`^WI-${dependency.component}-\\d{3}$`).test(workItemId) || expected.has(workItemId)) {
        issues.push(`invalid or duplicate external work item: ${workItemId}`);
      } else expected.set(workItemId, { component: dependency.component, repository: dependency.repository, source });
    }
  }

  if (gate.status !== 'G-PASSED') {
    if (statusesThatRequirePassedGate.has(item.status)) issues.push(`${item.id} cannot be ${item.status} until externalDependencyGate is G-PASSED`);
    if (gate.evidenceReport !== null || gate.verifiedAt !== null || gate.verifiedBy !== null
      || !gate.sourceRevisions || Object.keys(gate.sourceRevisions).length !== 0) {
      issues.push(`${gate.status} external dependency gate must not claim passed evidence`);
    }
    return issues;
  }

  if (!isSafeReportPath(gate.evidenceReport)) issues.push('G-PASSED external dependency gate needs a safe harness/reports evidenceReport');
  if (gate.verifiedBy !== 'human-reviewer') issues.push('G-PASSED external dependency gate must be attested by human-reviewer');
  if (!Number.isFinite(Date.parse(gate.verifiedAt))) issues.push('G-PASSED external dependency gate needs an ISO verifiedAt');
  if (!gate.sourceRevisions || typeof gate.sourceRevisions !== 'object' || Array.isArray(gate.sourceRevisions)) {
    issues.push('G-PASSED external dependency gate needs sourceRevisions by component');
  }

  const reportPath = isSafeReportPath(gate.evidenceReport) ? path.join(root, gate.evidenceReport) : null;
  if (!reportPath || !fs.existsSync(reportPath)) {
    issues.push('G-PASSED external dependency gate evidenceReport is missing');
    return issues;
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    issues.push('external dependency evidenceReport must contain valid JSON');
    return issues;
  }

  if (report.consumerWorkItem !== item.id) issues.push('external dependency report consumerWorkItem does not match');
  if (report.verifiedBy !== gate.verifiedBy || report.verifiedAt !== gate.verifiedAt) issues.push('external dependency report attestation differs from gate');
  if (!Array.isArray(report.sourceRepositories)) issues.push('external dependency report needs sourceRepositories');
  if (!Array.isArray(report.upstreamWorkItems)) issues.push('external dependency report needs upstreamWorkItems');

  const expectedComponents = new Set([...expected.values()].map((dependency) => dependency.component));
  const reportSources = new Map((report.sourceRepositories ?? []).filter(Boolean).map((entry) => [entry.component, entry]));
  if (reportSources.size !== expectedComponents.size || reportSources.size !== (report.sourceRepositories ?? []).length
    || [...expectedComponents].some((component) => !reportSources.has(component))) {
    issues.push('external dependency report sourceRepositories do not match dependencies');
  }
  for (const component of expectedComponents) {
    const sourceInfo = reportSources.get(component);
    const expectedRepository = [...expected.values()].find((dependency) => dependency.component === component)?.repository;
    const gateRevision = gate.sourceRevisions?.[component];
    if (sourceInfo?.repository !== expectedRepository) issues.push(`external dependency source repository mismatch: ${component}`);
    if (!isCommit(sourceInfo?.sourceRevision) || sourceInfo.sourceRevision !== gateRevision) issues.push(`external dependency source revision is missing or inconsistent: ${component}`);
  }
  if (Object.keys(gate.sourceRevisions ?? {}).length !== expectedComponents.size) issues.push('gate sourceRevisions do not match dependency components');

  const reportItems = new Map((report.upstreamWorkItems ?? []).filter(Boolean).map((entry) => [entry.workItemId, entry]));
  if (reportItems.size !== expected.size || reportItems.size !== (report.upstreamWorkItems ?? []).length
    || [...expected.keys()].some((id) => !reportItems.has(id))) {
    issues.push('external dependency report upstreamWorkItems must cover each required WI exactly once');
  }
  const eventById = new Map(events.map((event) => [event.id, event]));
  const seenEventIds = new Set();
  for (const [workItemId, dependency] of expected) {
    const upstream = reportItems.get(workItemId);
    if (!upstream) continue;
    if (upstream.status !== 'W-DONE') issues.push(`${workItemId} is not attested W-DONE`);
    if (!isSafeReportPath(upstream.completionEvidence)) issues.push(`${workItemId} needs a repository-relative completionEvidence path`);
    if (!Array.isArray(upstream.contractSyncs) || upstream.contractSyncs.length === 0) {
      issues.push(`${workItemId} must enumerate every emitted Contract Sync`);
      continue;
    }

    const declaredSyncIds = new Set();
    for (const sync of upstream.contractSyncs) {
      const expectedId = new RegExp(`^CS-${dependency.component}-\\d{8}-\\d{3}$`);
      if (!sync || !expectedId.test(sync.id ?? '') || sync.source !== dependency.source
        || sync.sourceWorkItem !== workItemId || !['C-ACKNOWLEDGED', 'C-RESOLVED'].includes(canonicalContractSyncStatus(sync.status))
        || typeof sync.sourceRevision !== 'string' || !sync.sourceRevision.trim()
        || !/^[a-f0-9]{64}$/i.test(sync.payloadSha256 ?? '')
        || !Array.isArray(sync.targets) || !sync.targets.includes(String(item.component).toLowerCase())) {
        issues.push(`${workItemId} has invalid Contract Sync evidence; expected imported ACK or RESOLVED event targeting ${String(item.component).toLowerCase()}`);
        continue;
      }
      if (declaredSyncIds.has(sync.id) || seenEventIds.has(sync.id)) issues.push(`duplicate external Contract Sync mapping: ${sync.id}`);
      declaredSyncIds.add(sync.id);
      seenEventIds.add(sync.id);

      const event = eventById.get(sync.id);
      if (!event) {
        issues.push(`external Contract Sync ${sync.id} has not been imported locally`);
        continue;
      }
      const recordedStatus = canonicalContractSyncStatus(sync.status);
      const importedStatus = canonicalContractSyncStatus(parseField(event.text, 'status'));
      const lifecycleRank = new Map([['C-PENDING', 0], ['C-ACKNOWLEDGED', 1], ['C-RESOLVED', 2], ['C-REJECTED', -1]]);
      if (parseField(event.text, 'source') !== sync.source
        || parseField(event.text, 'sourceWorkItem') !== workItemId
        || parseField(event.text, 'sourceRevision') !== sync.sourceRevision
        || createHash('sha256').update(stableContractSyncPayload(event.text)).digest('hex') !== sync.payloadSha256
        || !lifecycleRank.has(importedStatus) || !lifecycleRank.has(recordedStatus)
        || lifecycleRank.get(importedStatus) < lifecycleRank.get(recordedStatus)
        || importedStatus === 'C-REJECTED'
        || !parseList(event.text, 'targets').includes(String(item.component).toLowerCase())) {
        issues.push(`imported external Contract Sync ${sync.id} does not match its verification report`);
        continue;
      }
      const acknowledgementEvidence = parseField(event.text, 'acknowledgementEvidence');
      if (!isSafeReportPath(acknowledgementEvidence) || !fs.existsSync(path.join(root, acknowledgementEvidence))) {
        issues.push(`external Contract Sync ${sync.id} needs local acknowledgement evidence`);
      }
      if (importedStatus === 'C-RESOLVED') {
        const resolutionEvidence = parseField(event.text, 'resolutionEvidence');
        if (!isSafeReportPath(resolutionEvidence) || !fs.existsSync(path.join(root, resolutionEvidence))) {
          issues.push(`resolved external Contract Sync ${sync.id} needs local resolution evidence`);
        }
      }
    }

    const localEventIds = new Set(events
      .filter((event) => parseField(event.text, 'sourceWorkItem') === workItemId
        && parseList(event.text, 'targets').includes(String(item.component).toLowerCase()))
      .map((event) => event.id));
    if (localEventIds.size !== declaredSyncIds.size || [...localEventIds].some((id) => !declaredSyncIds.has(id))) {
      issues.push(`${workItemId} report omits or duplicates an imported Contract Sync event`);
    }
  }

  return issues;
}
