import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const syncRoot = path.join(root, 'harness/contract-sync');
const inbox = path.join(syncRoot, 'inbox');
const outbox = path.join(syncRoot, 'outbox');
const args = process.argv.slice(2);
const command = args.shift();

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
      const changed = [...text.matchAll(/^\s+-\s+(.+)$/gm)].map((match) => match[1]);
      return { file, name: entry.name, text, id: field('id'), source: field('source'), status: field('status'), targets, changed };
    });
}

function eventYaml({ id, targets, breaking, changed, requiredAction, sourceRevision }) {
  return [
    'type: CONTRACT_SYNC', `id: ${id}`, 'source: core', `targets: [${targets.join(', ')}]`, `breaking: ${breaking}`,
    'changed:', `  - ${changed}`, 'requiredAction:', `  - ${requiredAction}`, `sourceRevision: ${sourceRevision}`, 'status: PENDING', '',
  ].join('\n');
}

try {
  if (!['check', 'import', 'publish'].includes(command)) throw new Error('usage: check | import | publish');
  if (command === 'check') {
    const checkpoint = option('checkpoint', true);
    const workItem = option('work-item', true);
    const invalid = listEvents(inbox).filter((event) => !event.id || !event.source || !event.status || !event.targets.length);
    if (invalid.length) throw new Error(`invalid inbox event(s): ${invalid.map((event) => event.name).join(', ')}`);
    const pending = listEvents(inbox).filter((event) => event.targets.includes('core') && event.status === 'PENDING');
    const result = { checkpoint, workItem, relevantPendingSyncIds: pending.map((event) => event.id), checkedAt: new Date().toISOString() };
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
    if (!/^CS-[A-Za-z0-9-]+$/.test(id)) throw new Error('--id must start with CS-');
    if (!targets.length || targets.some((target) => !['sandbox', 'console'].includes(target))) throw new Error('--targets must name sandbox and/or console');
    if (!['true', 'false'].includes(breaking)) throw new Error('--breaking must be true or false');
    const destination = path.join(outbox, `${id}.yaml`);
    if (fs.existsSync(destination)) throw new Error(`event already exists: ${id}`);
    fs.writeFileSync(destination, eventYaml({ id, targets, breaking, changed, requiredAction, sourceRevision }), { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({ published: id, file: path.relative(root, destination) }));
  }
} catch (error) {
  console.error(`CONTRACT_SYNC error: ${error.message}`);
  process.exitCode = 1;
}
