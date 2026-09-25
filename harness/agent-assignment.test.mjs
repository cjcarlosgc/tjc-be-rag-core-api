import test from 'node:test';
import assert from 'node:assert/strict';
import { agentAssignmentIssues } from './agent-assignment.mjs';

test('permite un WI seleccionado antes de asignar implementer y revisores', () => {
  assert.deepEqual(agentAssignmentIssues({ status: 'W-SELECTED', execution: {}, coordination: { uiImpact: true } }), []);
});

test('rechaza al mismo agente como implementer y reviewer', () => {
  assert.deepEqual(agentAssignmentIssues({ status: 'W-IN_PROGRESS', execution: { implementationAgent: 'implementer', reviewAgent: 'implementer' } }), ['implementer cannot be final reviewer']);
});

test('exige implementer, reviewer y UX reviewer al entrar en revisión', () => {
  assert.deepEqual(agentAssignmentIssues({ status: 'W-IN_REVIEW', execution: {}, coordination: { uiImpact: true } }), [
    'review requires assigned implementer and independent reviewer',
    'UI impact requires ux-reviewer before review',
  ]);
});

test('acepta agentes distintos y reviewer UX antes de la revisión', () => {
  assert.deepEqual(agentAssignmentIssues({
    status: 'W-IN_REVIEW',
    execution: { implementationAgent: 'implementer', reviewAgent: 'reviewer', uxReviewAgent: 'ux-reviewer' },
    coordination: { uiImpact: true },
  }), []);
});
