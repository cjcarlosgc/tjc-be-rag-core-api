import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const failures = [];
const fail = (message) => failures.push(message);
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const registry = JSON.parse(read('harness/work-items.json'));
const state = JSON.parse(read('harness/state.json'));
const inboxEvents = fs.readdirSync(path.join(root, 'harness/contract-sync/inbox'))
  .filter((name) => /\.ya?ml$/i.test(name))
  .map((name) => {
    const text = read(`harness/contract-sync/inbox/${name}`);
    const field = (key) => text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
    const targets = text.match(/^targets:\s*\[([^\]]*)\]$/m)?.[1]?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
    return { id: field('id'), text, targets };
  });
const statuses = new Set([
  'W-PLANNED', 'W-READY', 'W-SELECTED', 'W-SPEC_VERIFIED',
  'W-AWAITING_APPROVAL', 'W-IN_PROGRESS', 'W-IN_REVIEW',
  'W-DONE', 'W-BLOCKED', 'W-DECISION_REQUIRED', 'W-CANCELLED',
]);
const component = registry.component;
const backlog = read('spec/backlog.md');
const cases = read('spec/operational-cases.md');
const epics = new Set([...backlog.matchAll(/^\| (EP\d{2}) \|/gm)].map((match) => match[1]));
const stories = new Set([...backlog.matchAll(/^\| (HU\d{2}) \|/gm)].map((match) => match[1]));
const storyRows = [...backlog.matchAll(/^\| (HU\d{2}) \| (EP\d{2}) \| (S[1-4]) \| (Must|Should|Could) \| (H-[A-Z_]+) \|/gm)];
const caseIds = new Set([...cases.matchAll(/^\| (OC\d{2}) \|/gm)].map((match) => match[1]));
const taskFiles = ['spec/features', 'spec/transversal'].flatMap((directory) =>
  fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, directory, entry.name, 'tasks.md')))
    .map((entry) => path.join(directory, entry.name, 'tasks.md')));
const tasks = taskFiles.map(read).join('\n');
const itemById = new Map();
function declaredStories(header) {
  const ids = new Set();
  for (const match of header.matchAll(/HU(\d{2})(?:[–-]HU(\d{2}))?/g)) {
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    for (let number = first; number <= last; number++) ids.add(`HU${String(number).padStart(2, '0')}`);
  }
  return ids;
}

if (registry.schemaVersion !== 1) fail('work-items schemaVersion must be 1');
if (!['CORE', 'CONSOLE', 'SANDBOX', 'GH'].includes(component)) fail('invalid component');
if (epics.size !== 6) fail('backlog must contain exactly EP01–EP06');
if (stories.size !== 18) fail('backlog must contain exactly HU01–HU18');
if (storyRows.length !== 18) fail('each HU needs epic, sprint, priority and H-prefixed state');
for (const [, id, epic, , , status] of storyRows) {
  if (!epics.has(epic)) fail(`${id} has an unknown epic`);
  if (!['H-DRAFT', 'H-BACKLOGGED', 'H-READY', 'H-IN_PROGRESS', 'H-DONE', 'H-RETIRED'].includes(status)) fail(`${id} has an invalid H state`);
}
for (let number = 1; number <= 18; number++) {
  if (!stories.has(`HU${String(number).padStart(2, '0')}`)) fail(`missing HU${number}`);
}
if (caseIds.size !== 15) fail('operational-cases must contain OC01–OC15');
for (const file of taskFiles) {
  for (const [index, line] of read(file).split('\n').entries()) {
    if (/^- \[ \]/.test(line) && !/^- \[ \] \*\*ST-/.test(line)) fail(`unregistered open task in ${file}:${index + 1}`);
  }
}

for (const item of registry.workItems ?? []) {
  if (!new RegExp(`^WI-${component}-\\d{3}$`).test(item.id)) fail(`invalid local WI id: ${item.id}`);
  if (itemById.has(item.id)) fail(`duplicate WI: ${item.id}`);
  itemById.set(item.id, item);
  if (item.component !== component) fail(`wrong component: ${item.id}`);
  if (!['PRODUCT', 'HARNESS'].includes(item.workItemType)) fail(`invalid workItemType: ${item.id}`);
  if (!statuses.has(item.status)) fail(`invalid WI status: ${item.id}`);
  if (typeof item.contractImpact !== 'boolean' || typeof item.publishesContract !== 'boolean') fail(`contract flags required: ${item.id}`);
  if (item.publishesContract && !item.contractImpact) fail(`publisher must have contract impact: ${item.id}`);
  if (!Array.isArray(item.storyIds) || item.storyIds.length === 0 || item.storyIds.some((id) => !stories.has(id))) fail(`invalid storyIds: ${item.id}`);
  if (!['P0', 'P1', 'P2'].includes(item.priority) || typeof item.sprint !== 'string' || !item.sprint.trim()) fail(`priority and sprint required: ${item.id}`);
  if (!Array.isArray(item.dependsOn)) fail(`dependsOn must be an array: ${item.id}`);
  if (!Array.isArray(item.specPaths) || item.specPaths.length === 0) fail(`specPaths required: ${item.id}`);
  if (item.syncScopePaths !== undefined && (!Array.isArray(item.syncScopePaths) || item.syncScopePaths.length === 0 || item.syncScopePaths.some((scope) => scope !== '*' && !/^spec\/contracts\/[A-Za-z0-9._/-]+$/.test(scope)))) fail(`invalid syncScopePaths: ${item.id}`);
  if (item.deferredSyncIds?.length) {
    if (item.id !== 'WI-CORE-001' || item.workItemType !== 'HARNESS' || new Set(item.deferredSyncIds).size !== item.deferredSyncIds.length || !item.deferredSyncReport?.startsWith('harness/reports/') || !fs.existsSync(path.join(root, item.deferredSyncReport))) fail(`invalid sync deferral report: ${item.id}`);
    else for (const id of item.deferredSyncIds) {
      const eventDate = id.match(/^CS-(?:[A-Z]+-)?(\d{8})-/)?.[1];
      const baselineDate = state.planningBaseline?.slice(0, 10).replaceAll('-', '');
      if (!eventDate || !baselineDate || eventDate >= baselineDate || !read(item.deferredSyncReport).includes(id) || !/^[a-f0-9]{64}$/.test(item.deferredSyncDigests?.[id] ?? '')) fail(`invalid or undocumented sync deferral ${id}: ${item.id}`);
    }
  }
  if (item.contractSyncReview !== undefined && !Array.isArray(item.contractSyncReview)) fail(`contractSyncReview must be an array: ${item.id}`);
  const reviewedSyncIds = new Set();
  for (const entry of item.contractSyncReview ?? []) {
    if (!entry || typeof entry.eventId !== 'string') { fail(`invalid Contract Sync scope review entry: ${item.id}`); continue; }
    const event = inboxEvents.find((candidate) => candidate.id === entry.eventId);
    const target = component === 'GH' ? 'github-integration' : component.toLowerCase();
    const stableText = event?.text.replace(/^status:\s*.*$/m, 'status: <status>');
    const digest = stableText && createHash('sha256').update(stableText).digest('hex');
    const eventDate = entry.eventId?.match(/^CS-(?:[A-Z]+-)?(\d{8})-/)?.[1];
    const baselineDate = state.planningBaseline?.slice(0, 10).replaceAll('-', '');
    if (reviewedSyncIds.has(entry.eventId) || !event || !event.targets.includes(target) || !eventDate || !baselineDate || eventDate >= baselineDate || entry.disposition !== 'NOT_RELEVANT' || entry.sha256 !== digest || typeof entry.reason !== 'string' || entry.reason.trim().length < 20 || !entry.report?.startsWith('harness/reports/') || !fs.existsSync(path.join(root, entry.report))) fail(`invalid, changed or undocumented Contract Sync scope review ${entry.eventId}: ${item.id}`);
    reviewedSyncIds.add(entry.eventId);
  }
  if (!Array.isArray(item.taskIds) || item.taskIds.length === 0) fail(`missing taskIds: ${item.id}`);
  for (const taskId of item.taskIds ?? []) {
    if (!new RegExp(`^ST-${component}-\\d{3}$`).test(taskId)) fail(`invalid local task: ${taskId}`);
    const matchingLines = tasks.split('\n').filter((value) => /^- \[[ x]\] \*\*ST-/.test(value) && value.includes(taskId));
    if (matchingLines.length !== 1) fail(`${taskId} must appear exactly once in tasks.md`);
    const line = matchingLines[0];
    if (!line || !line.includes(item.id)) fail(`${item.id} is not linked from tasks.md by ${taskId}`);
  }
  for (const id of item.caseIds ?? []) if (!caseIds.has(id)) fail(`unknown case ${id} in ${item.id}`);
  for (const specPath of item.specPaths ?? []) if (!fs.existsSync(path.join(root, specPath))) fail(`missing spec path ${specPath}`);
}
const executing = (registry.workItems ?? []).filter((item) => ['W-SELECTED', 'W-SPEC_VERIFIED', 'W-AWAITING_APPROVAL', 'W-IN_PROGRESS', 'W-IN_REVIEW', 'W-BLOCKED', 'W-DECISION_REQUIRED'].includes(item.status));
if (executing.length > 1) fail('only one local work item may be active at a time');
if (executing.length === 1 && state.activeWorkItem?.id !== executing[0].id) fail('active work item must match the executable registry entry');
if (executing.length === 0 && state.activeWorkItem !== null) fail('state contains an active WI absent from the executable registry');
for (const item of registry.workItems ?? []) {
  for (const dependency of item.dependsOn ?? []) {
    if (!itemById.has(dependency) || dependency === item.id) fail(`invalid dependency ${dependency} in ${item.id}`);
    if (['W-IN_PROGRESS', 'W-IN_REVIEW', 'W-DONE'].includes(item.status) && itemById.get(dependency)?.status !== 'W-DONE') fail(`${item.id} started before dependency ${dependency} finished`);
  }
}
for (const line of tasks.split('\n')) {
  if (!/^- \[[ x]\] \*\*ST-/.test(line)) continue;
  const taskId = line.match(/\bST-(CORE|CONSOLE|SANDBOX|GH)-\d{3}\b/)?.[0];
  if (!taskId) continue;
  const wiId = line.match(/\bWI-(CORE|CONSOLE|SANDBOX|GH)-\d{3}\b/)?.[0];
  if (!wiId || !itemById.get(wiId)?.taskIds.includes(taskId)) fail(`unlinked subtask ${taskId}`);
  const header = line.split(':**')[0];
  const taskStatus = header.match(/\bT-(BACKLOGGED|READY|IN_PROGRESS|DONE|CANCELLED)\b/)?.[0];
  const wiStatus = itemById.get(wiId)?.status;
  if (!taskStatus) fail(`${taskId} needs a T-prefixed status`);
  if (taskStatus === 'T-DONE' && wiStatus !== 'W-DONE') fail(`${taskId} cannot be T-DONE before ${wiId} closes`);
  if (taskStatus === 'T-READY' && !['W-READY', 'W-SELECTED', 'W-SPEC_VERIFIED', 'W-AWAITING_APPROVAL'].includes(wiStatus)) fail(`${taskId} is ready but ${wiId} is in another phase`);
  if (taskStatus === 'T-IN_PROGRESS' && !['W-IN_PROGRESS', 'W-IN_REVIEW', 'W-BLOCKED', 'W-DECISION_REQUIRED'].includes(wiStatus)) fail(`${taskId} has a status inconsistent with ${wiId}`);
  if (taskStatus === 'T-BACKLOGGED' && !['W-PLANNED', 'W-READY'].includes(wiStatus)) fail(`${taskId} is backlogged but ${wiId} is active`);
  if (taskStatus === 'T-CANCELLED' && wiStatus !== 'W-CANCELLED') fail(`${taskId} is cancelled but ${wiId} is not`);
  if (taskStatus === 'T-DONE' && !/^- \[x\]/.test(line)) fail(`${taskId} is T-DONE without a checked box`);
  if (taskStatus !== 'T-DONE' && /^- \[x\]/.test(line)) fail(`${taskId} is checked before T-DONE`);
  const declared = declaredStories(header);
  const registered = new Set(itemById.get(wiId)?.storyIds ?? []);
  if (declared.size !== registered.size || [...declared].some((id) => !registered.has(id))) fail(`${taskId} HU declaration differs from ${wiId}`);
}
if (failures.length) {
  console.error(`Work item validation failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Work item validation passed (${component}, ${itemById.size} WI).`);
}
