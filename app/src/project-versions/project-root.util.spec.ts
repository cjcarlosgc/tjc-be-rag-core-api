import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveUniqueComposerRoot, validateProjectRoot } from './project-root.util.js';

describe('project root helpers', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('selects repository root and a single nested Composer root, but no candidate among multiple manifests', () => {
    expect(resolveUniqueComposerRoot(['composer.json', 'src/App.php'])).toBe('.');
    expect(resolveUniqueComposerRoot(['backend/composer.json', 'backend/src/App.php', 'web/src/App.ts'])).toBe('backend');
    expect(resolveUniqueComposerRoot([
      'backend/composer.json', 'other/composer.json', 'backend/src/App.php',
    ])).toBeUndefined();
    expect(resolveUniqueComposerRoot(['backend/composer.lock', 'backend/src/App.php'])).toBeUndefined();
    expect(resolveUniqueComposerRoot(['COMPOSER.JSON', 'web/COMPOSER.JSON', 'src/index.ts'])).toBeUndefined();
    expect(resolveUniqueComposerRoot(['backend/composer.json', 'other/COMPOSER.JSON'])).toBe('backend');
    expect(resolveUniqueComposerRoot(['backend/composer.json', 'other/composer.json', 'COMPOSER.JSON']))
      .toBeUndefined();
  });

  it('accepts the repository root and an existing normalized nested directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'project-root-test-'));
    directories.push(root);
    await mkdir(join(root, 'backend'));

    await expect(validateProjectRoot(root, '.')).resolves.toBe('.');
    await expect(validateProjectRoot(root, 'backend')).resolves.toBe('backend');
  });

  it.each(['/backend', 'C:/backend', '../outside', 'backend/../outside', 'backend//src', 'backend\\src', 'missing'])
    ('rejects invalid, traversing, absolute, or non-existent roots (%s)', async (projectRoot) => {
      const root = await mkdtemp(join(tmpdir(), 'project-root-test-'));
      directories.push(root);
      await mkdir(join(root, 'backend'));

      await expect(validateProjectRoot(root, projectRoot)).rejects.toThrow();
    });

  it('rejects a nested directory whose symlink resolves outside the repository root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'project-root-test-'));
    const outside = await mkdtemp(join(tmpdir(), 'project-root-outside-'));
    directories.push(root, outside);
    await symlink(outside, join(root, 'escape'), 'dir');

    await expect(validateProjectRoot(root, 'escape')).rejects.toThrow(/symlink/);
  });
});
