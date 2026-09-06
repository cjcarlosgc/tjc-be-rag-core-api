import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { assertCompatibleProject, listSafeZipEntries } from './zip-entries.util.js';
import { AppException } from '../../common/errors/app.exception.js';
import { ErrorCode } from '../../common/errors/error-code.enum.js';

function buildZip(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [entryName, content] of Object.entries(entries)) {
    zip.addFile(entryName, Buffer.from(content));
  }
  return zip.toBuffer();
}

describe('listSafeZipEntries', () => {
  it('returns the entries of a valid zip', () => {
    const buffer = buildZip({ 'package.json': '{}', 'src/index.ts': 'export {}' });

    const entries = listSafeZipEntries(buffer);

    expect(entries.map((entry) => entry.entryName).sort()).toEqual([
      'package.json',
      'src/index.ts',
    ]);
  });

  it('rejects a corrupt buffer as INVALID_ZIP', () => {
    expect(() => listSafeZipEntries(Buffer.from('not a zip'))).toThrow(AppException);
    try {
      listSafeZipEntries(Buffer.from('not a zip'));
    } catch (error) {
      expect((error as AppException).code).toBe(ErrorCode.INVALID_ZIP);
    }
  });

  it('rejects Zip Slip path traversal entries', () => {
    const zip = new AdmZip();
    zip.addFile('placeholder.txt', Buffer.from('evil'));
    // AdmZip.addFile() normalizes the path away; set it directly to simulate
    // a maliciously crafted archive with a raw ".." entry name.
    zip.getEntries()[0].entryName = '../../etc/passwd';
    const buffer = zip.toBuffer();

    expect(() => listSafeZipEntries(buffer)).toThrow(AppException);
  });
});

describe('assertCompatibleProject', () => {
  it('passes when package.json and a .ts file are present', () => {
    const entries = listSafeZipEntries(
      buildZip({ 'package.json': '{}', 'src/index.ts': 'export {}' }),
    );

    expect(() => assertCompatibleProject(entries)).not.toThrow();
  });

  it('throws UNSUPPORTED_PROJECT when there is no package.json', () => {
    const entries = listSafeZipEntries(buildZip({ 'src/index.ts': 'export {}' }));

    try {
      assertCompatibleProject(entries);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppException).code).toBe(ErrorCode.UNSUPPORTED_PROJECT);
    }
  });

  it('throws UNSUPPORTED_PROJECT when there is no TypeScript file', () => {
    const entries = listSafeZipEntries(buildZip({ 'package.json': '{}', 'README.md': 'hi' }));

    try {
      assertCompatibleProject(entries);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppException).code).toBe(ErrorCode.UNSUPPORTED_PROJECT);
    }
  });
});
