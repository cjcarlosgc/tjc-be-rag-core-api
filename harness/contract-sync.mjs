import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const syncRoot = path.join(root, 'harness/contract-sync');
const inbox = path.join(syncRoot, 'inbox');
const outbox = path.join(syncRoot, 'outbox');
const args = process.argv.slice(2);
const command = args.shift();
const components = new Set(['core', 'console', 'sandbox', 'github-integration']);
const statuses = new Set(['C-PENDING', 'C-ACKNOWLEDGED', 'C-RESOLVED', 'C-REJECTED', 'PENDING', 'ACKNOWLEDGED', 'RESOLVED', 'REJECTED']);
const checkpoints = new Set(['start', 'implementation-delivery', 'before-review', 'before-done']);
const validScope = (scope) => scope === '*' || (/^spec\/contracts\/[A-Za-z0-9._/-]+$/.test(scope) && !scope.includes('..'));

function option(name, required = false) {
  const index = args.indexOf(`--${name}`);
  const value = index === -1 ? undefined : args[index + 1];
  if (required && (!value || value.startsWith('--'))) throw new Error(`--${name} is required`);
  return value;
}

function listEvents(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => {
      const file = path.join(directory, entry.name);
      const text = fs.readFileSync(file, 'utf8');
      const field = (name) => text.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim();
      const targets = text.match(/^targets:\s*\[([^\]]*)\]$/m)?.[1].split(',').map((target) => target.trim()).filter(Boolean) ?? [];
      const scoped = /^scopePaths:/m.test(text);
      const scopePaths = scoped ? (text.match(/^scopePaths:\s*\[([^\]]*)\]$/m)?.[1] ?? '').split(',').map((value) => value.trim()).filter(Boolean) : ['*'];
      const changed = [...text.matchAll(/^\s+-\s+(.+)$/gm)].map((match) => match[1]);
      return { file, name: entry.name, text, id: field('id'), source: field('source'), status: field('status'), targets, scopePaths, changed };
    });
}

function eventYaml({ id, targets, scopePaths, breaking, changed, requiredAction, sourceRevision }) {
  return [
    'type: CONTRACT_SYNC', `id: ${id}`, 'source: core', `targets: [${targets.join(', ')}]`, `scopePaths: [${scopePaths.join(', ')}]`, `breaking: ${breaking}`,
    'changed:', `  - ${changed}`, 'requiredAction:', `  - ${requiredAction}`, `sourceRevision: ${sourceRevision}`, 'status: C-PENDING', '',
  ].join('\n');
}

function validateScopeReviews(registered, events, planningBaseline) {
  const entries = registered.contractSyncReview ?? [];
  if (!Array.isArray(entries)) throw new Error('contractSyncReview must be an array');
  const ids = new Set();
  const baseline = planningBaseline?.slice(0, 10).replaceAll('-', '');
  for (const entry of entries) {
    if (!entry || typeof entry.eventId !== 'string' || ids.has(entry.eventId)) throw new Error(`invalid or duplicate contractSyncReview entry: ${entry?.eventId}`);
    ids.add(entry.eventId);
    const event = events.find((candidate) => candidate.id === entry.eventId);
    const stableText = event?.text.replace(/^status:\s*.*$/m, 'status: <status>');
    const digest = stableText && createHash('sha256').update(stableText).digest('hex');
    const date = entry.eventId.match(/^CS-(?:[A-Z]+-)?(\d{8})-/)?.[1];
    if (!event || !event.targets.includes('core') || !date || !baseline || date >= baseline || entry.disposition !== 'NOT_RELEVANT' || entry.sha256 !== digest || typeof entry.reason !== 'string' || entry.reason.trim().length < 20 || !entry.report?.startsWith('harness/reports/') || !fs.existsSync(path.join(root, entry.report))) {
      throw new Error(`invalid, changed or undocumented Contract Sync scope review: ${entry?.eventId}`);
    }
  }
  return new Set(entries.map((entry) => entry.eventId));
}

try {
  if (!['check', 'import', 'publish'].includes(command)) throw new Error('usage: check | import | publish');
  if (command === 'check') {
    const checkpoint = option('checkpoint', true);
    const workItem = option('work-item', true);
    if (!checkpoints.has(checkpoint)) throw new Error('unknown checkpoint');
    const registry = JSON.parse(fs.readFileSync(path.join(root, 'harness/work-items.json'), 'utf8'));
    const state = JSON.parse(fs.readFileSync(path.join(root, 'harness/state.json'), 'utf8'));
    const registered = registry.workItems.find((item) => item.id === workItem);
    if (!registered || state.activeWorkItem?.id !== workItem || registered.status !== state.activeWorkItem.status) throw new Error('check requires the active registered work item');
    const invalid = listEvents(inbox).filter((event) => !event.id || !components.has(event.source) || !statuses.has(event.status) || !event.targets.length || event.targets.some((target) => !components.has(target)) || !event.scopePaths.length || event.scopePaths.some((scope) => !validScope(scope)));
    if (invalid.length) throw new Error(`invalid inbox event(s): ${invalid.map((event) => event.name).join(', ')}`);
    const paths = [...registered.specPaths, ...(state.activeWorkItem.transversalPaths ?? []), ...(registered.syncScopePaths ?? [])];
    const inboxEvents = listEvents(inbox);
    const reviewedNotRelevantIds = validateScopeReviews(registered, inboxEvents, state.planningBaseline);
    const relevant = (event) => paths.includes('*') || event.scopePaths.includes('*') || event.scopePaths.some((scope) => paths.includes(scope) || (registered.contractImpact && scope.startsWith('spec/contracts/')));
    const unresolved = inboxEvents.filter((event) => event.targets.includes('core') && !['RESOLVED', 'C-RESOLVED'].includes(event.status) && relevant(event));
    const deferredIds = new Set(registered.deferredSyncIds ?? []);
    if (deferredIds.size) {
      const report = registered.deferredSyncReport;
      if (registered.id !== 'WI-CORE-001' || registered.workItemType !== 'HARNESS' || deferredIds.size !== (registered.deferredSyncIds ?? []).length || !report?.startsWith('harness/reports/') || !fs.existsSync(path.join(root, report))) throw new Error('sync deferrals require WI-CORE-001, unique IDs and an existing report');
      const rationale = fs.readFileSync(path.join(root, report), 'utf8');
      const baselineDate = state.planningBaseline?.slice(0, 10).replaceAll('-', '');
      for (const id of deferredIds) {
        const eventDate = id.match(/^CS-(?:[A-Z]+-)?(\d{8})-/)?.[1];
        const event = unresolved.find((entry) => entry.id === id);
        const digest = event && createHash('sha256').update(event.text).digest('hex');
        if (!eventDate || !baselineDate || eventDate >= baselineDate || !event || !rationale.includes(id) || registered.deferredSyncDigests?.[id] !== digest) throw new Error(`invalid, changed or undocumented sync deferral: ${id}`);
      }
    }
    const pending = unresolved.filter((event) => !deferredIds.has(event.id) && !reviewedNotRelevantIds.has(event.id));
    const result = { checkpoint, workItem, relevantPendingSyncIds: pending.map((event) => event.id), deferredSyncIds: unresolved.filter((event) => deferredIds.has(event.id)).map((event) => event.id), notRelevantSyncIds: unresolved.filter((event) => reviewedNotRelevantIds.has(event.id)).map((event) => event.id), checkedAt: new Date().toISOString() };
    if (args.includes('--record') && pending.length === 0) {
      const order = [...checkpoints];
      const existing = state.activeWorkItem.coordination.pullCheckpoints;
      if (existing.length !== order.indexOf(checkpoint)) throw new Error('checkpoints must be recorded once and in order');
      existing.push(result);
      fs.writeFileSync(path.join(root, 'harness/state.json'), `${JSON.stringify(state, null, 2)}\n`);
    }
    console.log(JSON.stringify(result));
    process.exitCode = pending.length ? 2 : 0;
  }
  if (command === 'import') {
    const source = path.resolve(root, option('from', true));
    if (!fs.statSync(source).isDirectory()) throw new Error('--from must be a directory');
    let imported = 0;
    for (const event of listEvents(source)) {
      const destination = path.join(inbox, event.name);
      if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') !== event.text) throw new Error(`conflicting event: ${event.name}`);
      if (!fs.existsSync(destination)) { fs.copyFileSync(event.file, destination); imported += 1; }
    }
    console.log(JSON.stringify({ imported }));
  }
  if (command === 'publish') {
    const id = option('id', true);
    const targets = option('targets', true).split(',').map((target) => target.trim()).filter(Boolean);
    const breaking = option('breaking', true);
    const changed = option('changed', true);
    const requiredAction = option('required-action', true);
    const sourceRevision = option('source-revision', true);
    const scopePaths = (option('scope-paths') ?? '*').split(',').map((value) => value.trim()).filter(Boolean);
    if (!scopePaths.length || scopePaths.some((scope) => !validScope(scope))) throw new Error('--scope-paths must contain * or shared spec/contracts paths');
    if (!/^CS-[A-Za-z0-9-]+$/.test(id)) throw new Error('--id must start with CS-');
    if (!targets.length || targets.some((target) => !components.has(target) || target === 'core')) throw new Error('--targets must name console, sandbox and/or github-integration');
    if (!['true', 'false'].includes(breaking)) throw new Error('--breaking must be true or false');
    const destination = path.join(outbox, `${id}.yaml`);
    if (fs.existsSync(destination)) throw new Error(`event already exists: ${id}`);
    fs.writeFileSync(destination, eventYaml({ id, targets, scopePaths, breaking, changed, requiredAction, sourceRevision }), { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({ published: id, file: path.relative(root, destination) }));
  }
} catch (error) {
  console.error(`CONTRACT_SYNC error: ${error.message}`);
  process.exitCode = 1;
}
