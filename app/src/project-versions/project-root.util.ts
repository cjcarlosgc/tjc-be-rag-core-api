import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { posix } from 'node:path';

/** Returns the single Composer candidate. Ambiguous snapshots deliberately have no selected root. */
export function resolveUniqueComposerRoot(discoveredFiles: string[]): string | undefined {
  const candidates = discoveredFiles.filter((path) =>
    path.split('/').at(-1)?.toLowerCase() === 'composer.json',
  );

  if (candidates.length !== 1) return undefined;

  const directory = posix.dirname(candidates[0]);
  return directory === '.' ? '.' : directory;
}

/** Validates a repository-relative POSIX directory and prevents symlink escape. */
export async function validateProjectRoot(repositoryRoot: string, projectRoot: string): Promise<string> {
  if (
    projectRoot.length === 0
    || projectRoot.includes('\\')
    || /^[A-Za-z]:\//.test(projectRoot)
    || isAbsolute(projectRoot)
    || posix.isAbsolute(projectRoot)
    || projectRoot.split('/').some((segment) => segment === '..' || segment === '')
    || posix.normalize(projectRoot) !== projectRoot
  ) {
    if (projectRoot !== '.') throw new Error('projectRoot must be a normalized repository-relative POSIX path.');
  }

  const root = resolve(repositoryRoot);
  const target = resolve(root, projectRoot);
  const [rootRealPath, targetRealPath, targetStat] = await Promise.all([
    realpath(root),
    realpath(target),
    stat(target),
  ]);

  if (!targetStat.isDirectory()) throw new Error('projectRoot must resolve to an existing directory.');
  if (targetRealPath !== rootRealPath && !targetRealPath.startsWith(`${rootRealPath}${sep}`)) {
    throw new Error('projectRoot cannot escape repositoryRoot through a symlink.');
  }

  return projectRoot;
}
