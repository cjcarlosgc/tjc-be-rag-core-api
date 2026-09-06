import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExistingTestResolverService } from './existing-test-resolver.service.js';
import type { TestTargetCandidate } from './test-target-extractor.service.js';

describe('ExistingTestResolverService', () => {
  let dir: string;
  const resolver = new ExistingTestResolverService();

  const candidates: TestTargetCandidate[] = [
    {
      filePath: 'src/calculator.ts',
      symbolName: 'Calculator',
      methodName: null,
      targetType: 'CLASS',
      startLine: 1,
      endLine: 5,
    },
    {
      filePath: 'src/calculator.ts',
      symbolName: 'Calculator',
      methodName: 'add',
      targetType: 'METHOD',
      startLine: 2,
      endLine: 4,
    },
    {
      filePath: 'src/calculator.ts',
      symbolName: 'Calculator',
      methodName: 'subtract',
      targetType: 'METHOD',
      startLine: 5,
      endLine: 7,
    },
    {
      filePath: 'src/unused.ts',
      symbolName: 'orphanFn',
      methodName: null,
      targetType: 'FUNCTION',
      startLine: 1,
      endLine: 3,
    },
  ];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'test-resolver-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, 'src/calculator.spec.ts'),
      [
        "import { Calculator } from './calculator';",
        '',
        "describe('Calculator', () => {",
        "  it('adds', () => {",
        '    const calculator = new Calculator();',
        '    calculator.add(1, 2);',
        '  });',
        '});',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('marks the class and the exercised method as covered, and leaves the rest as missing', () => {
    const resolved = resolver.resolve(dir, ['src/calculator.spec.ts'], candidates);

    const classTarget = resolved.find((t) => t.targetType === 'CLASS');
    const addMethod = resolved.find((t) => t.methodName === 'add');
    const subtractMethod = resolved.find((t) => t.methodName === 'subtract');
    const orphan = resolved.find((t) => t.symbolName === 'orphanFn');

    expect(classTarget).toMatchObject({ hasTest: true, testFilePaths: ['src/calculator.spec.ts'] });
    expect(addMethod).toMatchObject({ hasTest: true, testFilePaths: ['src/calculator.spec.ts'] });
    expect(subtractMethod).toMatchObject({ hasTest: false, testFilePaths: [] });
    expect(orphan).toMatchObject({ hasTest: false, testFilePaths: [] });
  });

  it('returns everything as not covered when there are no test files', () => {
    const resolved = resolver.resolve(dir, [], candidates);

    expect(resolved.every((target) => !target.hasTest)).toBe(true);
  });
});
