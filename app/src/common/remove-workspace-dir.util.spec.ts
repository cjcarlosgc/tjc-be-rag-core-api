import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeWorkspaceDir } from './remove-workspace-dir.util.js';

const fsState = vi.hoisted(() => ({ failWith: undefined as unknown, rmSpy: undefined as unknown }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const rmSpy = vi.fn(async (...args: Parameters<typeof actual.rm>) => {
    if (fsState.failWith !== undefined) {
      throw fsState.failWith;
    }
    return actual.rm(...args);
  });
  fsState.rmSpy = rmSpy;
  return { ...actual, default: { ...actual, rm: rmSpy }, rm: rmSpy };
});

describe('removeWorkspaceDir', () => {
  afterEach(() => {
    fsState.failWith = undefined;
    (fsState.rmSpy as ReturnType<typeof vi.fn>).mockClear();
  });

  it('removes a directory with nested content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rag-core-rmutil-'));
    await mkdir(join(dir, 'a/b'), { recursive: true });
    await writeFile(join(dir, 'a/b/file.txt'), 'x');

    await removeWorkspaceDir(dir);

    await expect(stat(dir)).rejects.toThrow();
  });

  it('does not throw when the directory does not exist', async () => {
    const dir = join(tmpdir(), 'rag-core-rmutil-missing-does-not-exist');
    const logger = { warn: vi.fn() };

    await expect(removeWorkspaceDir(dir, logger)).resolves.toBeUndefined();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes recursive, force and retry options to rm', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rag-core-rmutil-'));

    await removeWorkspaceDir(dir);

    expect(fsState.rmSpy).toHaveBeenCalledWith(dir, {
      recursive: true,
      force: true,
      maxRetries: 2,
      retryDelay: 100,
    });
  });

  it('never throws when rm fails and warns once without the path or the raw message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rag-core-rmutil-secret-'));
    fsState.failWith = Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${dir}'`), {
      code: 'ENOTEMPTY',
    });
    const logger = { warn: vi.fn() };

    await expect(removeWorkspaceDir(dir, logger)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const message = logger.warn.mock.calls[0][0] as string;
    expect(message).toContain('ENOTEMPTY');
    expect(message).not.toContain(dir);
    expect(message).not.toContain('directory not empty');
    expect(message).not.toContain('rmdir');

    fsState.failWith = undefined;
    await removeWorkspaceDir(dir);
  });

  it('never throws when rm fails without a logger or without an error code', async () => {
    fsState.failWith = new Error('boom');

    await expect(removeWorkspaceDir('/nonexistent-dir')).resolves.toBeUndefined();

    const logger = { warn: vi.fn() };
    await expect(removeWorkspaceDir('/nonexistent-dir', logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).not.toContain('boom');
  });
});
