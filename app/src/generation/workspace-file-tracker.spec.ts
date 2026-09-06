import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceFileTracker } from './workspace-file-tracker.js';

describe('WorkspaceFileTracker', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'workspace-tracker-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads an existing file from disk once and marks it as not new', async () => {
    await writeFile(join(dir, 'foo.spec.ts'), 'original content');
    const tracker = new WorkspaceFileTracker(dir);

    const first = await tracker.getCurrent('foo.spec.ts');
    expect(first).toEqual({ content: 'original content', isNewFile: false });

    tracker.set('foo.spec.ts', 'merged content');
    const second = await tracker.getCurrent('foo.spec.ts');
    expect(second).toEqual({ content: 'merged content', isNewFile: false });
  });

  it('reports a file that does not exist on disk as new, and keeps it new after being set', async () => {
    const tracker = new WorkspaceFileTracker(dir);

    const first = await tracker.getCurrent('brand-new.spec.ts');
    expect(first).toEqual({ content: null, isNewFile: true });

    tracker.set('brand-new.spec.ts', 'export function x() {}');
    const second = await tracker.getCurrent('brand-new.spec.ts');
    expect(second).toEqual({ content: 'export function x() {}', isNewFile: true });
  });

  it('getFinalFiles reflects original content only for pre-existing files and the latest valid flag', async () => {
    await writeFile(join(dir, 'existing.spec.ts'), 'old');
    const tracker = new WorkspaceFileTracker(dir);

    await tracker.getCurrent('existing.spec.ts');
    tracker.set('existing.spec.ts', 'old\nnew case');
    tracker.setValid('existing.spec.ts', true);

    await tracker.getCurrent('new.spec.ts');
    tracker.set('new.spec.ts', 'brand new file');
    tracker.setValid('new.spec.ts', false);

    const finalFiles = tracker.getFinalFiles().sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    expect(finalFiles).toEqual([
      { relativePath: 'existing.spec.ts', content: 'old\nnew case', isNewFile: false, originalContent: 'old', valid: true },
      { relativePath: 'new.spec.ts', content: 'brand new file', isNewFile: true, originalContent: null, valid: false },
    ]);
  });
});
