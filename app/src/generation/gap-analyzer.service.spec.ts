import { describe, expect, it, vi } from 'vitest';
import { GapAnalyzer } from './gap-analyzer.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { TestTarget } from '../generated/prisma/client.js';

function makeTarget(overrides: Partial<TestTarget> = {}): TestTarget {
  return {
    id: 'target-1',
    projectVersionId: 'version-1',
    filePath: 'src/foo.ts',
    symbolName: 'Foo',
    methodName: null,
    targetType: 'CLASS',
    startLine: 1,
    endLine: 10,
    hasTest: false,
    testFilePaths: [],
    createdAt: new Date(),
    ...overrides,
  } as TestTarget;
}

describe('GapAnalyzer', () => {
  it('TARGET mode requires targetId', async () => {
    const repo = { findById: vi.fn() };
    const analyzer = new GapAnalyzer(repo as never);

    await expect(analyzer.resolve('version-1', 'TARGET', undefined)).rejects.toMatchObject({
      code: ErrorCode.INVALID_GENERATION_TARGET,
    });
  });

  it('TARGET mode rejects a CLASS target', async () => {
    const repo = { findById: vi.fn().mockResolvedValue(makeTarget({ targetType: 'CLASS' })) };
    const analyzer = new GapAnalyzer(repo as never);

    await expect(analyzer.resolve('version-1', 'TARGET', 'target-1')).rejects.toMatchObject({
      code: ErrorCode.INVALID_GENERATION_TARGET,
    });
  });

  it('TARGET mode resolves a single METHOD target', async () => {
    const target = makeTarget({ targetType: 'METHOD', methodName: 'bar' });
    const repo = { findById: vi.fn().mockResolvedValue(target) };
    const analyzer = new GapAnalyzer(repo as never);

    const result = await analyzer.resolve('version-1', 'TARGET', 'target-1');

    expect(result).toEqual([target]);
  });

  it('TARGET mode throws UNRESOLVABLE_TARGET when the target does not exist', async () => {
    const repo = { findById: vi.fn().mockResolvedValue(null) };
    const analyzer = new GapAnalyzer(repo as never);

    await expect(analyzer.resolve('version-1', 'TARGET', 'missing')).rejects.toMatchObject({
      code: ErrorCode.UNRESOLVABLE_TARGET,
    });
  });

  it('CLASS_ALL rejects a non-CLASS target', async () => {
    const repo = { findById: vi.fn().mockResolvedValue(makeTarget({ targetType: 'METHOD' })) };
    const analyzer = new GapAnalyzer(repo as never);

    await expect(analyzer.resolve('version-1', 'CLASS_ALL', 'target-1')).rejects.toMatchObject({
      code: ErrorCode.INVALID_GENERATION_TARGET,
    });
  });

  it('CLASS_MISSING returns only methods without an existing test', async () => {
    const classTarget = makeTarget({ targetType: 'CLASS', symbolName: 'Foo' });
    const withTest = makeTarget({ id: 'm1', targetType: 'METHOD', methodName: 'a', hasTest: true });
    const withoutTest = makeTarget({ id: 'm2', targetType: 'METHOD', methodName: 'b', hasTest: false });
    const repo = {
      findById: vi.fn().mockResolvedValue(classTarget),
      findMethodsOfClass: vi.fn().mockResolvedValue([withTest, withoutTest]),
    };
    const analyzer = new GapAnalyzer(repo as never);

    const result = await analyzer.resolve('version-1', 'CLASS_MISSING', 'class-1');

    expect(repo.findMethodsOfClass).toHaveBeenCalledWith('version-1', 'Foo');
    expect(result).toEqual([withoutTest]);
  });

  it('CLASS_ALL returns every method regardless of hasTest', async () => {
    const classTarget = makeTarget({ targetType: 'CLASS', symbolName: 'Foo' });
    const withTest = makeTarget({ id: 'm1', targetType: 'METHOD', methodName: 'a', hasTest: true });
    const withoutTest = makeTarget({ id: 'm2', targetType: 'METHOD', methodName: 'b', hasTest: false });
    const repo = {
      findById: vi.fn().mockResolvedValue(classTarget),
      findMethodsOfClass: vi.fn().mockResolvedValue([withTest, withoutTest]),
    };
    const analyzer = new GapAnalyzer(repo as never);

    const result = await analyzer.resolve('version-1', 'CLASS_ALL', 'class-1');

    expect(result).toEqual([withTest, withoutTest]);
  });

  it('PROJECT_MISSING and PROJECT_ALL reject a targetId', async () => {
    const repo = { findTestableTargets: vi.fn() };
    const analyzer = new GapAnalyzer(repo as never);

    await expect(analyzer.resolve('version-1', 'PROJECT_MISSING', 'target-1')).rejects.toMatchObject({
      code: ErrorCode.INVALID_GENERATION_TARGET,
    });
    await expect(analyzer.resolve('version-1', 'PROJECT_ALL', 'target-1')).rejects.toMatchObject({
      code: ErrorCode.INVALID_GENERATION_TARGET,
    });
  });

  it('PROJECT_MISSING filters testable targets without an existing test', async () => {
    const withTest = makeTarget({ id: 'm1', targetType: 'FUNCTION', hasTest: true });
    const withoutTest = makeTarget({ id: 'm2', targetType: 'FUNCTION', hasTest: false });
    const repo = { findTestableTargets: vi.fn().mockResolvedValue([withTest, withoutTest]) };
    const analyzer = new GapAnalyzer(repo as never);

    const result = await analyzer.resolve('version-1', 'PROJECT_MISSING', undefined);

    expect(result).toEqual([withoutTest]);
  });
});
