import { describe, expect, it } from 'vitest';
import { findMatchingTestTarget, toRetrievalTarget } from './symbol-target.util.js';
import type { AnalysisSymbol, TestTarget } from '../generated/prisma/client.js';

function buildSymbol(overrides: Partial<AnalysisSymbol> = {}): AnalysisSymbol {
  return {
    id: 'symbol-1',
    analysisRunId: 'run-1',
    language: 'TYPESCRIPT',
    kind: 'METHOD',
    qualifiedName: 'Thing.doIt',
    filePath: 'src/thing.ts',
    changeKind: 'DIRECTLY_CHANGED',
    createdAt: new Date(),
    ...overrides,
  };
}

function buildTarget(overrides: Partial<TestTarget> = {}): TestTarget {
  return {
    id: 'target-1',
    projectVersionId: 'version-1',
    filePath: 'src/thing.ts',
    symbolName: 'Thing',
    methodName: 'doIt',
    targetType: 'METHOD',
    startLine: 1,
    endLine: 5,
    hasTest: false,
    testFilePaths: [],
    ...overrides,
  };
}

describe('toRetrievalTarget', () => {
  it('splits a METHOD qualifiedName into class name + method name', () => {
    expect(toRetrievalTarget(buildSymbol())).toEqual({
      filePath: 'src/thing.ts',
      symbolName: 'Thing',
      methodName: 'doIt',
      targetType: 'METHOD',
    });
  });

  it('uses the raw qualifiedName as symbolName for a FUNCTION, with null methodName', () => {
    expect(toRetrievalTarget(buildSymbol({ kind: 'FUNCTION', qualifiedName: 'standaloneFn' }))).toEqual({
      filePath: 'src/thing.ts',
      symbolName: 'standaloneFn',
      methodName: null,
      targetType: 'FUNCTION',
    });
  });
});

describe('findMatchingTestTarget', () => {
  it('finds the TestTarget describing the same METHOD symbol', () => {
    const targets = [buildTarget(), buildTarget({ id: 'other', methodName: 'other' })];

    expect(findMatchingTestTarget(targets, buildSymbol())?.id).toBe('target-1');
  });

  it('returns undefined when no TestTarget matches', () => {
    const targets = [buildTarget({ filePath: 'src/other.ts' })];

    expect(findMatchingTestTarget(targets, buildSymbol())).toBeUndefined();
  });

  it('matches a FUNCTION symbol by symbolName with a null methodName', () => {
    const targets = [
      buildTarget({ targetType: 'FUNCTION', symbolName: 'standaloneFn', methodName: null }),
    ];

    expect(
      findMatchingTestTarget(targets, buildSymbol({ kind: 'FUNCTION', qualifiedName: 'standaloneFn' }))?.id,
    ).toBe('target-1');
  });
});
