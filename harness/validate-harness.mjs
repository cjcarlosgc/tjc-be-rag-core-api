import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const requiredRoles = ['leader.md', 'sdd-analyst.md', 'implementer.md', 'contract-reviewer.md', 'reviewer.md'];
const gateValues = new Set(['PASSED', 'FAILED', 'NOT_APPLICABLE', 'NOT_RUN']);
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
if (state) {
  assert(state.schemaVersion === 3, 'state.schemaVersion must be 3');
  assert(state.allowedStatuses?.includes('DECISION_REQUIRED'), 'DECISION_REQUIRED is not allowed');
  const item = state.activeWorkItem;
  assert(item !== null && typeof item === 'object', 'activeWorkItem must be an object for validation');
  if (item) {
    assert(['PRODUCT', 'HARNESS'].includes(item.workItemType), 'workItemType must be PRODUCT or HARNESS');
    assert(Array.isArray(item.storyIds), 'storyIds must be an array');
    assert(typeof item.sprint === 'string' && item.sprint.length > 0, 'sprint is required');
    assert(Array.isArray(item.specPaths) && Array.isArray(item.transversalPaths), 'specPaths and transversalPaths must be arrays');
    assert(item.execution?.leaderAgent === 'leader', 'execution.leaderAgent must be leader');
    assert(Number.isInteger(item.execution?.reviewCycles) && Number.isInteger(item.execution?.maxReviewCycles), 'review-cycle controls are required');
    assert(item.execution?.reviewCycles <= item.execution?.maxReviewCycles, 'review-cycle limit exceeded');
    for (const gate of requiredGates) assert(gateValues.has(item.gates?.[gate]), `invalid or missing gate: ${gate}`);
    assert(Array.isArray(item.coordination?.pullCheckpoints), 'coordination.pullCheckpoints must be an array');
    assert(Array.isArray(item.coordination?.pendingRelevantSyncIds), 'coordination.pendingRelevantSyncIds must be an array');
    if (['SPEC_VERIFIED', 'AWAITING_APPROVAL', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'].includes(item.status)) {
      assert(item.decisionGate?.checked === true, 'decision gate must be checked after SELECTED');
      assert(typeof item.decisionGate?.checkedAt === 'string', 'decisionGate.checkedAt is required after SELECTED');
      assert(item.decisionGate?.blockingDecisionIds?.length === 0, 'blocking decisions prevent progress');
    }
    if (['IN_PROGRESS', 'IN_REVIEW', 'DONE'].includes(item.status) && item.workItemType === 'PRODUCT') {
      assert(item.approved === true, 'approved=true is required for product work in progress');
    }
    if (['BLOCKED', 'DECISION_REQUIRED'].includes(item.status) && item.decisionGate?.blockingDecisionIds?.length) {
      assert(typeof item.blockedReason === 'string' && item.blockedReason.length > 0, 'blocked work needs a concrete blockedReason');
    }
    if (item.coordination?.contractImpact) {
      for (const gate of ['contractReviewed', 'canonicalContractSynced', 'contractSyncPublished']) {
        assert(item.gates?.[gate] !== 'NOT_APPLICABLE', `${gate} cannot be NOT_APPLICABLE with contract impact`);
      }
    }
    if (item.status === 'DONE') {
      for (const gate of ['sddVerified', 'implementationCompleted', 'independentReviewPassed', 'technicalChecksPassed', 'interopSyncChecked', 'noBlockingDecisions', 'retryLimitRespected']) {
        assert(item.gates?.[gate] === 'PASSED', `${gate} must pass before DONE`);
      }
      assert(item.coordination?.pendingRelevantSyncIds?.length === 0, 'DONE cannot have pending relevant CONTRACT_SYNC events');
      if (item.coordination?.contractImpact) {
        for (const gate of ['contractReviewed', 'canonicalContractSynced', 'contractSyncPublished']) {
          assert(item.gates?.[gate] === 'PASSED', `${gate} must pass for contractual work before DONE`);
        }
      }
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
  console.error(`Harness V2 validation failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Harness V2 validation passed.');
}
