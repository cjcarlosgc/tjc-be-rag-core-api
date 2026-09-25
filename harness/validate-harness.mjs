import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentAssignmentIssues } from './agent-assignment.mjs';

const root = process.cwd();
const workItemCheck = spawnSync(process.execPath, [path.join(root, 'harness/validate-work-items.mjs')], { cwd: root, encoding: 'utf8' });
const completionCheck = spawnSync(process.execPath, [path.join(root, 'harness/validate-completions.mjs')], { cwd: root, encoding: 'utf8' });
const completionTests = spawnSync(process.execPath, ['--test', path.join(root, 'harness/validate-completions.test.mjs')], { cwd: root, encoding: 'utf8' });
const failures = [];
if (workItemCheck.status !== 0) failures.push(workItemCheck.stderr.trim() || workItemCheck.error?.message || 'work item validation failed');
if (completionCheck.status !== 0) failures.push(completionCheck.stderr.trim() || completionCheck.error?.message || 'completion validation failed');
if (completionTests.status !== 0) failures.push(completionTests.stderr.trim() || completionTests.stdout.trim() || completionTests.error?.message || 'completion tests failed');
const assignmentTests = spawnSync(process.execPath, ['--test', path.join(root, 'harness/agent-assignment.test.mjs')], { cwd: root, encoding: 'utf8' });
if (assignmentTests.status !== 0) failures.push(assignmentTests.stderr.trim() || assignmentTests.stdout.trim() || assignmentTests.error?.message || 'agent assignment tests failed');
const requiredRoles = ['leader.md', 'sdd-analyst.md', 'implementer.md', 'contract-reviewer.md', 'reviewer.md'];
const gateValues = new Set(['G-PASSED', 'G-FAILED', 'G-NOT_APPLICABLE', 'G-NOT_RUN']);
const requiredGates = [
  'sddVerified', 'implementationCompleted', 'independentReviewPassed',
  'technicalChecksPassed', 'contractReviewed', 'canonicalContractSynced',
  'contractSyncPublished', 'interopSyncChecked', 'noBlockingDecisions', 'retryLimitRespected',
];

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

for (const role of requiredRoles) {
  assert(fs.existsSync(path.join(root, 'harness/roles', role)), `missing role: ${role}`);
}
assert(!fs.existsSync(path.join(root, 'harness/roles/analyst.md')), 'deprecated role analyst.md still exists');

const state = readJson('harness/state.json');
const registry = readJson('harness/work-items.json');
if (state) {
  assert(state.schemaVersion === 4, 'state.schemaVersion must be 4');
  assert(state.sddVersion === '3.0', 'Core/Console state.sddVersion must be 3.0');
  assert(state.allowedStatuses?.includes('W-DECISION_REQUIRED'), 'W-DECISION_REQUIRED is not allowed');
  const item = state.activeWorkItem;
  assert(item === null || typeof item === 'object', 'activeWorkItem must be an object or null');
  if (item) {
    const registered = registry?.workItems?.find((entry) => entry.id === item.id);
    assert(Boolean(registered), 'activeWorkItem must exist in work-items.json');
    assert(registered?.status === item.status, 'activeWorkItem status must match registry');
    assert(registered?.component === item.component, 'activeWorkItem component must match registry');
    assert(registered?.workItemType === item.workItemType, 'activeWorkItem type must match registry');
    assert(JSON.stringify(registered?.taskIds) === JSON.stringify(item.taskIds), 'activeWorkItem taskIds must match registry');
    for (const field of ['storyIds', 'caseIds', 'specPaths']) assert(JSON.stringify(registered?.[field]) === JSON.stringify(item[field]), `activeWorkItem ${field} must match registry`);
    assert(registered?.sprint === item.sprint, 'activeWorkItem sprint must match registry');
    assert(JSON.stringify(registered?.syncScopePaths ?? []) === JSON.stringify(item.syncScopePaths ?? []), 'activeWorkItem syncScopePaths must match registry');
    assert(JSON.stringify(registered?.deferredSyncIds ?? []) === JSON.stringify(item.deferredSyncIds ?? []), 'activeWorkItem deferredSyncIds must match registry');
    assert((registered?.deferredSyncReport ?? null) === (item.deferredSyncReport ?? null), 'activeWorkItem deferredSyncReport must match registry');
    assert(JSON.stringify(registered?.deferredSyncDigests ?? {}) === JSON.stringify(item.deferredSyncDigests ?? {}), 'activeWorkItem deferredSyncDigests must match registry');
    assert(JSON.stringify(registered?.contractSyncReview ?? []) === JSON.stringify(item.contractSyncReview ?? []), 'activeWorkItem contractSyncReview must match registry');
    assert(registered?.contractImpact === item.coordination?.contractImpact, 'activeWorkItem contractImpact must match registry');
    assert(registered?.publishesContract === item.coordination?.publishesContract, 'activeWorkItem publishesContract must match registry');
    assert(['PRODUCT', 'HARNESS'].includes(item.workItemType), 'workItemType must be PRODUCT or HARNESS');
    assert(state.allowedStatuses?.includes(item.status), 'invalid work item status');
    assert(Array.isArray(item.storyIds), 'storyIds must be an array');
    assert(typeof item.sprint === 'string' && item.sprint.length > 0, 'sprint is required');
    assert(Array.isArray(item.specPaths) && Array.isArray(item.transversalPaths), 'specPaths and transversalPaths must be arrays');
    assert(item.execution?.leaderAgent === 'leader', 'execution.leaderAgent must be leader');
    assert(Number.isInteger(item.execution?.reviewCycles) && Number.isInteger(item.execution?.maxReviewCycles), 'review-cycle controls are required');
    assert(item.execution?.reviewCycles <= item.execution?.maxReviewCycles, 'review-cycle limit exceeded');
    assert(item.execution?.maxReviewCycles === 2, 'review-cycle limit must be two');
    for (const issue of agentAssignmentIssues(item)) assert(false, issue);
    for (const gate of requiredGates) assert(gateValues.has(item.gates?.[gate]), `invalid or missing gate: ${gate}`);
    assert(Array.isArray(item.coordination?.pullCheckpoints), 'coordination.pullCheckpoints must be an array');
    assert(Array.isArray(item.coordination?.pendingRelevantSyncIds), 'coordination.pendingRelevantSyncIds must be an array');
    if (['W-SPEC_VERIFIED', 'W-AWAITING_APPROVAL', 'W-IN_PROGRESS', 'W-IN_REVIEW', 'W-DONE'].includes(item.status)) {
      assert(item.decisionGate?.checked === true, 'decision gate must be checked after SELECTED');
      assert(typeof item.decisionGate?.checkedAt === 'string', 'decisionGate.checkedAt is required after SELECTED');
      assert(item.decisionGate?.blockingDecisionIds?.length === 0, 'blocking decisions prevent progress');
    }
    if (['W-IN_PROGRESS', 'W-IN_REVIEW', 'W-DONE'].includes(item.status) && item.workItemType === 'PRODUCT') {
      assert(item.approved === true, 'approved=true is required for product work in progress');
    }
    const transitionException = item.id === 'WI-CORE-001' && item.workItemType === 'HARNESS' && item.status === 'W-IN_PROGRESS';
    if (['W-SELECTED', 'W-SPEC_VERIFIED', 'W-AWAITING_APPROVAL', 'W-IN_PROGRESS', 'W-IN_REVIEW'].includes(item.status)) {
      assert(item.coordination?.pullCheckpoints?.some((check) => check.checkpoint === 'start' && check.workItem === item.id), 'active work requires a start CONTRACT_SYNC checkpoint');
    }
    if (['W-SPEC_VERIFIED', 'W-AWAITING_APPROVAL', 'W-IN_PROGRESS', 'W-IN_REVIEW'].includes(item.status) && !transitionException) {
      assert(item.gates?.sddVerified === 'G-PASSED', 'SDD gate must pass before this phase');
      assert(item.gates?.noBlockingDecisions === 'G-PASSED', 'decision gate must pass before this phase');
    }
    if (item.status === 'W-IN_REVIEW') {
      assert(item.execution?.implementationAgent && item.execution?.reviewAgent, 'review requires assigned implementer and independent reviewer');
      for (const gate of ['implementationCompleted', 'technicalChecksPassed', 'interopSyncChecked']) assert(item.gates?.[gate] === 'G-PASSED', `${gate} must pass before review`);
      for (const checkpoint of ['implementation-delivery', 'before-review']) assert(item.coordination?.pullCheckpoints?.some((check) => check.checkpoint === checkpoint && check.workItem === item.id), `review requires ${checkpoint} CONTRACT_SYNC`);
    }
    if (['W-BLOCKED', 'W-DECISION_REQUIRED'].includes(item.status) && item.decisionGate?.blockingDecisionIds?.length) {
      assert(typeof item.blockedReason === 'string' && item.blockedReason.length > 0, 'blocked work needs a concrete blockedReason');
    }
    if (item.coordination?.contractImpact) {
      assert(item.execution?.contractReviewAgent === 'contract-reviewer', 'contract impact requires contract-reviewer');
      for (const gate of ['contractReviewed', 'canonicalContractSynced']) {
        assert(item.gates?.[gate] !== 'G-NOT_APPLICABLE', `${gate} cannot be G-NOT_APPLICABLE with contract impact`);
      }
    } else {
      for (const gate of ['contractReviewed', 'canonicalContractSynced']) {
        assert(item.gates?.[gate] === 'G-NOT_APPLICABLE', `${gate} must be G-NOT_APPLICABLE without contract impact`);
      }
    }
    assert(item.coordination?.publishesContract ? ['G-NOT_RUN', 'G-PASSED', 'G-FAILED'].includes(item.gates?.contractSyncPublished) : item.gates?.contractSyncPublished === 'G-NOT_APPLICABLE', 'contractSyncPublished is inconsistent with publisher status');
    if (item.gates?.contractSyncPublished === 'G-PASSED') {
      assert(item.coordination?.publishedSyncIds?.length > 0, 'published contract gate needs event IDs');
      for (const id of item.coordination?.publishedSyncIds ?? []) assert(/^CS-[0-9]{8}-[0-9]{3}$/.test(id) && fs.existsSync(path.join(root, 'harness/contract-sync/outbox', `${id}.yaml`)), `published event is missing: ${id}`);
    }
    if (item.status === 'W-DONE') {
      for (const gate of ['sddVerified', 'implementationCompleted', 'independentReviewPassed', 'technicalChecksPassed', 'interopSyncChecked', 'noBlockingDecisions', 'retryLimitRespected']) {
        assert(item.gates?.[gate] === 'G-PASSED', `${gate} must pass before W-DONE`);
      }
      assert(item.coordination?.pendingRelevantSyncIds?.length === 0, 'DONE cannot have pending relevant CONTRACT_SYNC events');
      const checkpoints = new Set(item.coordination?.pullCheckpoints?.map((check) => check.checkpoint));
      for (const checkpoint of ['start', 'implementation-delivery', 'before-review', 'before-done']) {
        assert(checkpoints.has(checkpoint), `W-DONE requires CONTRACT_SYNC ${checkpoint}`);
      }
      assert(Array.isArray(item.evidence) && item.evidence.length > 0, 'W-DONE requires reproducible evidence');
      if (item.coordination?.contractImpact) {
        for (const gate of ['contractReviewed', 'canonicalContractSynced']) {
          assert(item.gates?.[gate] === 'G-PASSED', `${gate} must pass for contractual work before W-DONE`);
        }
      }
      assert(item.gates?.contractSyncPublished === (item.coordination?.publishesContract ? 'G-PASSED' : 'G-NOT_APPLICABLE'), 'contractSyncPublished must match publisher status at W-DONE');
    }
  }
}

const example = readJson('harness/examples/fan-out-fan-in.json');
if (example) {
  assert(Array.isArray(example.sequence) && Array.isArray(example.sequence[3]), 'example must model parallel review fan-out');
  for (const role of ['sdd-analyst', 'implementer', 'reviewer', 'contract-reviewer']) {
    const handoff = example.handoffs?.[role];
    assert(handoff && ['APPROVED', 'CHANGES_REQUESTED', 'BLOCKED', 'DECISION_REQUIRED'].includes(handoff.status), `example handoff missing status: ${role}`);
    for (const field of ['findings', 'blockers', 'filesAffected', 'evidence', 'recommendedNextStep']) {
      assert(handoff && Object.hasOwn(handoff, field), `example handoff missing ${field}: ${role}`);
    }
  }
}

for (const directory of ['harness/contract-sync/inbox', 'harness/contract-sync/outbox']) {
  assert(fs.existsSync(path.join(root, directory)), `missing CONTRACT_SYNC directory: ${directory}`);
}

if (failures.length) {
  console.error(`Harness V3 validation failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Harness V3 validation passed.');
}
