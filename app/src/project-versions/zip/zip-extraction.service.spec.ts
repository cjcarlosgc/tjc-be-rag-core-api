import AdmZip from 'adm-zip';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';
import { ZipExtractionService } from './zip-extraction.service.js';

const fsState = vi.hoisted(() => ({ rmFailure: undefined as unknown }));

// Permite simular que `rm` falla (p. ej. ENOTEMPTY) y delega en el real en el resto.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const rm = async (...args: Parameters<typeof actual.rm>): Promise<void> => {
    if (fsState.rmFailure !== undefined) {
      throw fsState.rmFailure;
    }
    return actual.rm(...args);
  };
  return { ...actual, default: { ...actual, rm }, rm };
});

const osState = vi.hoisted(() => ({ base: undefined as string | undefined }));

// Aísla el directorio temporal de cada prueba para comprobar por `readdir`
// que no quedan workspaces `rag-core-*`.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  const tmpdir = (): string => osState.base ?? actual.tmpdir();
  return { ...actual, default: { ...actual, tmpdir }, tmpdir };
});

function buildZip(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [entryName, content] of Object.entries(entries)) {
    zip.addFile(entryName, Buffer.from(content));
  }
  return zip.toBuffer();
}

describe('ZipExtractionService', () => {
  const service = new ZipExtractionService();
  let base: string;

  async function workspaceDirs(): Promise<string[]> {
    return (await readdir(base)).filter((name) => name.startsWith('rag-core-'));
  }

  beforeEach(async () => {
    const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os');
    base = await mkdtemp(join(tmpdir(), 'rag-core-zip-extraction-spec-'));
    osState.base = base;
  });

  afterEach(async () => {
    osState.base = undefined;
    fsState.rmFailure = undefined;
    await rm(base, { recursive: true, force: true });
  });

  it('extracts the entries into a temp workspace and cleanup removes it idempotently', async () => {
    const workspace = await service.extract(
      buildZip({ 'package.json': '{}', 'src/nested/index.ts': 'export {}' }),
    );

    expect(await readFile(join(workspace.dir, 'src/nested/index.ts'), 'utf8')).toBe('export {}');
    expect(await workspaceDirs()).toHaveLength(1);

    await expect(workspace.cleanup()).resolves.toBeUndefined();
    await expect(stat(workspace.dir)).rejects.toThrow();
    await expect(workspace.cleanup()).resolves.toBeUndefined();
    expect(await workspaceDirs()).toEqual([]);
  });

  it('rethrows the extraction error and leaves no workspace for an entry outside the workspace', async () => {
    const zip = new AdmZip();
    zip.addFile('placeholder.txt', Buffer.from('evil'));
    zip.getEntries()[0].entryName = '../../escape.txt';

    const error = await service.extract(zip.toBuffer()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe(ErrorCode.INVALID_ZIP);
    expect(await workspaceDirs()).toEqual([]);
    await expect(stat(join(base, '..', 'escape.txt'))).rejects.toThrow();
  });

  it('removes the workspace and rethrows when the buffer is not a valid zip', async () => {
    await expect(service.extract(Buffer.from('not a zip'))).rejects.toBeInstanceOf(AppException);

    expect(await workspaceDirs()).toEqual([]);
  });

  it('never throws from cleanup when directory removal fails', async () => {
    const workspace = await service.extract(buildZip({ 'package.json': '{}' }));
    fsState.rmFailure = Object.assign(new Error('ENOTEMPTY: directory not empty'), {
      code: 'ENOTEMPTY',
    });

    await expect(workspace.cleanup()).resolves.toBeUndefined();

    fsState.rmFailure = undefined;
    await workspace.cleanup();
    expect(await workspaceDirs()).toEqual([]);
  });
});
