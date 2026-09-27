import assert from 'node:assert/strict';
import test from 'node:test';
import { taskStoriesFitWorkItem } from './work-item-story-scope.mjs';

test('allows a subtask to declare the HU subset it directly affects', () => {
  assert.equal(
    taskStoriesFitWorkItem(new Set(['HU11']), new Set(['HU01', 'HU11', 'HU16'])),
    true,
  );
});

test('rejects empty or out-of-scope subtask HU declarations', () => {
  const workItemStories = new Set(['HU01', 'HU11', 'HU16']);
  assert.equal(taskStoriesFitWorkItem(new Set(), workItemStories), false);
  assert.equal(taskStoriesFitWorkItem(new Set(['HU17']), workItemStories), false);
});
