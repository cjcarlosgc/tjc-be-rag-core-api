import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestTargetExtractorService } from './test-target-extractor.service.js';

describe('TestTargetExtractorService', () => {
  let dir: string;
  const extractor = new TestTargetExtractorService();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'target-extractor-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts an exported class and its public methods, and an exported function', async () => {
    await writeFile(
      join(dir, 'sample.ts'),
      [
        'export class Calculator {',
        '  add(a: number, b: number): number {',
        '    return a + b;',
        '  }',
        '  private helper(): void {}',
        '}',
        '',
        'export function double(x: number): number {',
        '  return x * 2;',
        '}',
        '',
        'function internalOnly(): void {}',
      ].join('\n'),
    );

    const targets = extractor.extract(dir, ['sample.ts']);

    expect(targets).toHaveLength(3);
    expect(targets).toContainEqual(
      expect.objectContaining({ targetType: 'CLASS', symbolName: 'Calculator', methodName: null }),
    );
    expect(targets).toContainEqual(
      expect.objectContaining({ targetType: 'METHOD', symbolName: 'Calculator', methodName: 'add' }),
    );
    expect(targets).toContainEqual(
      expect.objectContaining({ targetType: 'FUNCTION', symbolName: 'double', methodName: null }),
    );
    expect(targets.some((t) => t.methodName === 'helper')).toBe(false);
    expect(targets.some((t) => t.symbolName === 'internalOnly')).toBe(false);
  });

  it('ignores non-exported classes entirely', async () => {
    await writeFile(join(dir, 'private-only.ts'), 'class Internal {\n  run(): void {}\n}\n');

    const targets = extractor.extract(dir, ['private-only.ts']);

    expect(targets).toHaveLength(0);
  });
});
