import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const state = JSON.parse(fs.readFileSync('harness/state.json', 'utf8'));
const registry = JSON.parse(fs.readFileSync('harness/work-items.json', 'utf8'));
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const completed = state.completedWorkItems;
assert(Array.isArray(completed), 'state.completedWorkItems must be an array');
const records = new Map();
for (const record of completed ?? []) {
  assert(typeof record?.id === 'string' && !records.has(record.id), `duplicate or invalid completion: ${record?.id}`);
  records.set(record.id, record);
}
const requiredGates = ['sddVerified', 'implementationCompleted', 'independentReviewPassed', 'technicalChecksPassed', 'interopSyncChecked', 'noBlockingDecisions', 'retryLimitRespected'];
const contractGates = ['contractReviewed', 'canonicalContractSynced'];
const requiredCheckpoints = ['start', 'implementation-delivery', 'before-review', 'before-done'];
const validReport = (value) => typeof value === 'string' && value.startsWith('harness/reports/') && !value.includes('..') && fs.existsSync(path.resolve(value));
const scalar = (body, field) => body.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))?.[1]?.trim();
const list = (body, field) => body.match(new RegExp(`^${field}:\\s*\\[([^\\]]*)\\]$`, 'm'))?.[1]?.split(',').map((value) => value.trim()).filter(Boolean);
const stableSyncDigest = (body) => createHash('sha256').update(body.replace(/^status:\s*.*$/m, 'status: <status>')).digest('hex');
for (const item of registry.workItems ?? []) {
  const record = records.get(item.id);
  if (item.status !== 'W-DONE') {
    assert(!record, `${item.id} has a completion record but is not W-DONE`);
    continue;
  }
  assert(Boolean(record), `${item.id} is W-DONE without a completion record`);
  if (!record) continue;
  for (const field of ['id', 'component', 'workItemType', 'status', 'sprint']) assert(record[field] === item[field], `${item.id} completion ${field} differs from registry`);
  for (const field of ['storyIds', 'taskIds', 'caseIds', 'specPaths']) assert(JSON.stringify(record[field]) === JSON.stringify(item[field]), `${item.id} completion ${field} differs from registry`);
  assert(JSON.stringify(record.syncScopePaths ?? []) === JSON.stringify(item.syncScopePaths ?? []), `${item.id} completion syncScopePaths differs from registry`);
  assert(JSON.stringify(record.deferredSyncIds ?? []) === JSON.stringify(item.deferredSyncIds ?? []), `${item.id} completion deferredSyncIds differs from registry`);
  assert((record.deferredSyncReport ?? null) === (item.deferredSyncReport ?? null), `${item.id} completion deferredSyncReport differs from registry`);
  assert(JSON.stringify(record.deferredSyncDigests ?? {}) === JSON.stringify(item.deferredSyncDigests ?? {}), `${item.id} completion deferredSyncDigests differs from registry`);
  assert(JSON.stringify(record.contractSyncReview ?? []) === JSON.stringify(item.contractSyncReview ?? []), `${item.id} completion contractSyncReview differs from registry`);
  assert(record.coordination?.contractImpact === item.contractImpact, `${item.id} contractImpact differs from registry`);
  assert(record.coordination?.publishesContract === item.publishesContract, `${item.id} publishesContract differs from registry`);
  assert(record.execution?.leaderAgent === 'leader', `${item.id} completion lacks leader`);
  assert(record.execution?.implementationAgent !== record.execution?.reviewAgent && Boolean(record.execution?.reviewAgent), `${item.id} needs an independent reviewer`);
  assert(record.execution?.handoffs?.some((handoff) => handoff.agent === record.execution.reviewAgent && handoff.status === 'APPROVED' && handoff.evidence?.some(validReport)), `${item.id} lacks approved reviewer handoff with evidence`);
  if (item.contractImpact) assert(record.execution?.handoffs?.some((handoff) => handoff.agent === 'contract-reviewer' && handoff.status === 'APPROVED' && handoff.evidence?.some(validReport)), `${item.id} lacks approved contract-reviewer handoff with evidence`);
  assert(record.decisionGate?.checked === true && record.decisionGate?.blockingDecisionIds?.length === 0, `${item.id} has unresolved decision gate`);
  assert(record.workItemType !== 'PRODUCT' || record.approved === true, `${item.id} product completion lacks approval`);
  assert(Number.isInteger(record.execution?.reviewCycles) && record.execution.reviewCycles <= 2, `${item.id} exceeded review cycles`);
  for (const gate of requiredGates) assert(record.gates?.[gate] === 'G-PASSED', `${item.id} gate ${gate} did not pass`);
  for (const gate of contractGates) assert(record.gates?.[gate] === (item.contractImpact ? 'G-PASSED' : 'G-NOT_APPLICABLE'), `${item.id} contract gate ${gate} is invalid`);
  assert(record.gates?.contractSyncPublished === (item.publishesContract ? 'G-PASSED' : 'G-NOT_APPLICABLE'), `${item.id} contractSyncPublished gate is invalid`);
  const published = record.coordination?.publishedSyncIds ?? [];
  assert(item.publishesContract ? published.length > 0 : published.length === 0, `${item.id} published event count conflicts with registry`);
  for (const id of published) {
    const file = path.resolve('harness/contract-sync/outbox', `${id}.yaml`);
    const exists = /^CS-[0-9]{8}-[0-9]{3}$/.test(id) && fs.existsSync(file);
    assert(exists, `${item.id} published event ${id} is missing`);
    if (!exists) continue;
    const body = fs.readFileSync(file, 'utf8');
    const owner = item.component === 'GH' ? 'github-integration' : item.component.toLowerCase();
    const targets = list(body, 'targets') ?? [];
    assert(scalar(body, 'id') === id && scalar(body, 'source') === owner && scalar(body, 'sourceWorkItem') === item.id && targets.length > 0 && !targets.includes(owner), `${item.id} published event ${id} has wrong ownership`);
  }
  if (item.component === 'CONSOLE') {
    for (const gate of ['noMocksPresentedAsLive']) assert(record.gates?.[gate] === 'G-PASSED', `${item.id} gate ${gate} did not pass`);
    assert(record.coordination?.uiImpact ? record.gates?.uxReviewed === 'G-PASSED' : record.gates?.uxReviewed === 'G-NOT_APPLICABLE', `${item.id} UX gate is invalid`);
    assert(record.coordination?.knownIncompatibilities?.length === 0, `${item.id} has known incompatibilities`);
  }
  const passedGates = Object.entries(record.gates ?? {}).filter(([, value]) => value === 'G-PASSED').map(([gate]) => gate);
  for (const gate of passedGates) assert(Array.isArray(record.gateEvidence?.[gate]) && record.gateEvidence[gate].some(validReport), `${item.id} gate ${gate} lacks a real report`);
  assert(Array.isArray(record.evidence) && record.evidence.some(validReport), `${item.id} lacks a real evidence report`);
  assert(record.coordination?.pendingRelevantSyncIds?.length === 0, `${item.id} has pending CONTRACT_SYNC events`);
  const reviewedNotRelevantIds = new Set((item.contractSyncReview ?? []).filter((entry) => entry.disposition === 'NOT_RELEVANT').map((entry) => entry.eventId));
  const inbox = path.resolve('harness/contract-sync/inbox');
  const target = item.component === 'GH' ? 'github-integration' : item.component.toLowerCase();
  for (const entry of item.contractSyncReview ?? []) {
    const eventPath = path.join(inbox, `${entry.eventId}.yaml`);
    const eventText = fs.existsSync(eventPath) ? fs.readFileSync(eventPath, 'utf8') : null;
    assert(eventText && (list(eventText, 'targets') ?? []).includes(target) && entry.disposition === 'NOT_RELEVANT' && stableSyncDigest(eventText) === entry.sha256 && validReport(entry.report) && typeof entry.reason === 'string' && entry.reason.trim().length >= 20, `${item.id} has invalid Contract Sync review for ${entry.eventId}`);
  }
  const paths = [...(item.specPaths ?? []), ...(record.transversalPaths ?? []), ...(item.syncScopePaths ?? [])];
  for (const name of fs.readdirSync(inbox).filter((value) => /\.ya?ml$/i.test(value))) {
    const body = fs.readFileSync(path.join(inbox, name), 'utf8');
    if (!(list(body, 'targets') ?? []).includes(target)) continue;
    const scopes = list(body, 'scopePaths') ?? ['*'];
    const relevant = paths.includes('*') || scopes.includes('*') || scopes.some((scope) => paths.includes(scope) || (item.contractImpact && scope.startsWith('spec/contracts/')));
    if (!relevant || ['RESOLVED', 'C-RESOLVED'].includes(scalar(body, 'status'))) continue;
    const eventId = scalar(body, 'id');
    const digest = createHash('sha256').update(body).digest('hex');
    if (reviewedNotRelevantIds.has(eventId)) continue;
    assert((item.deferredSyncIds ?? []).includes(eventId) && item.deferredSyncDigests?.[eventId] === digest && validReport(item.deferredSyncReport), `${item.id} has unresolved relevant CONTRACT_SYNC ${eventId}`);
  }
  const checks = record.coordination?.pullCheckpoints ?? [];
  let previous = -Infinity;
  for (const checkpoint of requiredCheckpoints) {
    const matching = checks.filter((check) => check.checkpoint === checkpoint && check.workItem === item.id);
    assert(matching.length === 1, `${item.id} needs exactly one ${checkpoint} checkpoint for itself`);
    const check = matching[0];
    if (!check) continue;
    const checkedAt = Date.parse(check.checkedAt);
    assert(Number.isFinite(checkedAt) && checkedAt >= previous, `${item.id} checkpoint ${checkpoint} has invalid order/time`);
    assert(Array.isArray(check.relevantPendingSyncIds) && check.relevantPendingSyncIds.length === 0, `${item.id} checkpoint ${checkpoint} has pending syncs`);
    assert(JSON.stringify(check.deferredSyncIds ?? []) === JSON.stringify(item.deferredSyncIds ?? []), `${item.id} checkpoint ${checkpoint} deferrals differ from registry`);
    assert((check.notRelevantSyncIds ?? []).every((id) => reviewedNotRelevantIds.has(id)), `${item.id} checkpoint ${checkpoint} contains an unreviewed non-relevant sync`);
    previous = checkedAt;
  }
  assert(Number.isFinite(Date.parse(record.closedAt)) && Date.parse(record.closedAt) >= previous, `${item.id} closedAt must follow checkpoints`);
}
for (const id of records.keys()) assert(registry.workItems?.some((item) => item.id === id), `orphan completion ${id}`);
if (failures.length) {
  console.error(`Completion validation failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else console.log(`Completion validation passed (${records.size} completed WI).`);
