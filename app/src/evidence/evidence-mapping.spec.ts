import { describe, expect, it } from 'vitest';
import { uuidV5 } from '../common/uuid-v5.util.js';
import {
  EMPTY_CONTENT_SHA256,
  SNAPSHOT_REF_NAMESPACE,
  artifactHashOf,
  qualifiedNameOf,
  snapshotRefFor,
  toAgentSteps,
  toCount,
  toComparisonCandidates,
  toEvidenceFacts,
  toFiniteNumber,
  toPairPosition,
  toRagCandidates,
  toRetrievalMetrics,
  toRunCandidates,
  toRunRetrievalConfig,
  toSha256,
  toText,
  toTextList,
} from './evidence-mapping.js';

const SECRET_MESSAGE = 'password=hunter2 Cookie: sid=abc123 token xoxb-1234567890-abcdef trailing';

describe('evidence mapping: valores no observados son null, nunca 0 ni cadena vacía (WI-CORE-027)', () => {
  it('reads counts, numbers and flags only with their own type', () => {
    expect(toCount(3)).toBe(3);
    expect(toCount(0)).toBe(0);
    expect(toCount(-1)).toBeNull();
    expect(toCount(1.5)).toBeNull();
    expect(toCount('3')).toBeNull();
    expect(toCount(null)).toBeNull();
    expect(toFiniteNumber(0.25)).toBe(0.25);
    expect(toFiniteNumber(Number.NaN)).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
  });

  it('treats an empty string as not observed for text', () => {
    expect(toText('')).toBeNull();
    expect(toText('gpt-x')).toBe('gpt-x');
    expect(toText(7)).toBeNull();
  });

  it('keeps only non-empty strings in a list and gives an empty list when the value is not a list', () => {
    expect(toTextList(['a', '', 3, 'b'])).toEqual(['a', 'b']);
    expect(toTextList('a')).toEqual([]);
    expect(toTextList(null)).toEqual([]);
  });

  it('validates a sha256 and rejects the empty-content hash as artifact', () => {
    const hash = 'a'.repeat(64);
    expect(toSha256(hash)).toBe(hash);
    expect(toSha256('A'.repeat(64))).toBeNull();
    expect(toSha256('abc')).toBeNull();
    expect(artifactHashOf(hash)).toBe(hash);
    expect(artifactHashOf(EMPTY_CONTENT_SHA256)).toBeNull();
    expect(artifactHashOf('')).toBeNull();
  });

  it('accepts only the closed pair positions 1 and 2', () => {
    expect(toPairPosition(1)).toBe(1);
    expect(toPairPosition(2)).toBe(2);
    expect(toPairPosition(0)).toBeNull();
    expect(toPairPosition(3)).toBeNull();
    expect(toPairPosition(null)).toBeNull();
  });

  it('builds the qualified name as parent.name or name and null without a name', () => {
    expect(qualifiedNameOf('Thing', 'doIt')).toBe('Thing.doIt');
    expect(qualifiedNameOf(null, 'helper')).toBe('helper');
    expect(qualifiedNameOf('Thing', null)).toBeNull();
    expect(qualifiedNameOf(null, '')).toBeNull();
  });
});

describe('snapshotRef (DEC-EVID-005)', () => {
  it('is the UUIDv5 of the snapshot urn for the project version and head, deterministic and opaque', () => {
    const ref = snapshotRefFor('pv-1', 'head-1');

    expect(ref).toBe(uuidV5(SNAPSHOT_REF_NAMESPACE, 'urn:tjc:snapshot-ref:v1:pv-1:head-1'));
    expect(ref).toBe(snapshotRefFor('pv-1', 'head-1'));
    expect(ref).not.toBe(snapshotRefFor('pv-1', 'head-2'));
    expect(ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is null without a project version, never a storage key or URL', () => {
    expect(snapshotRefFor(null, 'head-1')).toBeNull();
  });
});

describe('sandbox facts: 14 claves cerradas, con validación y saneado al leer (DEC-EVID-004/006)', () => {
  const KEYS = [
    'executionProfile',
    'runner',
    'compiled',
    'executed',
    'passed',
    'totalTests',
    'passedTests',
    'failedTests',
    'skippedTests',
    'testCasesTruncated',
    'failureStage',
    'failureCategory',
    'failureCode',
    'failureMessage',
  ];

  it('always returns exactly the 14 closed keys, even for a missing or hostile input', () => {
    expect(Object.keys(toEvidenceFacts(null)).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(toEvidenceFacts({ testCases: [{ errorMessage: 'x' }], logs: 'y', extra: 1 })).sort()).toEqual(
      [...KEYS].sort(),
    );
  });

  it('drops values outside their type or domain to null', () => {
    const facts = toEvidenceFacts({
      runner: 'PHPUNIT',
      compiled: 'yes',
      totalTests: -2,
      failureStage: 'MADE_UP',
      failureCategory: 'NONE',
      failureCode: 'bad code with spaces',
    });

    expect(facts).toMatchObject({
      runner: null,
      compiled: null,
      totalTests: null,
      failureStage: null,
      failureCategory: null,
      failureCode: null,
      failureMessage: null,
    });
  });

  it('re-sanitizes a failure message persisted before the wider helper, idempotently', () => {
    const once = toEvidenceFacts({ failureMessage: SECRET_MESSAGE }).failureMessage;
    const twice = toEvidenceFacts({ failureMessage: once }).failureMessage;

    expect(once).not.toContain('hunter2');
    expect(once).not.toContain('abc123');
    expect(once).not.toContain('xoxb-1234567890');
    expect(twice).toBe(once);
  });

  it('takes the executionProfile from the row only when the facts do not carry it', () => {
    expect(toEvidenceFacts({}, 'NODE_TYPESCRIPT').executionProfile).toBe('NODE_TYPESCRIPT');
    expect(toEvidenceFacts({ executionProfile: 'PHP_LARAVEL_PHPUNIT' }, 'NODE_TYPESCRIPT').executionProfile).toBe(
      'PHP_LARAVEL_PHPUNIT',
    );
  });
});

describe('retrieval config and candidates', () => {
  it('maps the Run config to semanticTopK and leaves the rest null', () => {
    expect(toRunRetrievalConfig({ mode: 'SE', vectorTopK: 20, targetChunkIds: ['t'] })).toEqual({
      semanticTopK: 20,
      finalTopK: null,
      semanticWeight: null,
      structuralWeight: null,
      embeddingModel: null,
    });
    expect(toRunRetrievalConfig(null).semanticTopK).toBeNull();
  });

  it('gives Run candidates their persisted position as rank and derives selected from the context', () => {
    const candidates = toRunCandidates(
      [
        { chunkId: 'c1', filePath: 'a.ts', symbolName: 'helper', parentSymbolName: 'Thing', semanticScore: 0.9, structuralMatch: 'IMPORTS' },
        { chunkId: 'c2', filePath: 'b.ts', symbolName: null, parentSymbolName: null, semanticScore: null, structuralMatch: 'UNKNOWN_RELATION' },
      ],
      new Set(['c1']),
    );

    expect(candidates).toEqual([
      {
        rank: 1,
        chunkId: 'c1',
        filePath: 'a.ts',
        symbolQualifiedName: 'Thing.helper',
        semanticScore: 0.9,
        structuralRelation: 'IMPORTS',
        combinedScore: null,
        selected: true,
      },
      {
        rank: 2,
        chunkId: 'c2',
        filePath: 'b.ts',
        symbolQualifiedName: null,
        semanticScore: null,
        structuralRelation: null,
        combinedScore: null,
        selected: false,
      },
    ]);
  });

  it('leaves selected null when there is no context for the symbol', () => {
    expect(toRunCandidates([{ chunkId: 'c1' }], null)[0].selected).toBeNull();
  });

  it('never reads excerpt code: RAG candidates take only location metadata from it and drop the snippet', () => {
    const [candidate] = toRagCandidates([
      {
        chunkId: 'k1',
        rank: 1,
        excerpt: { filePath: 'src/x.ts', symbolName: 'f', parentSymbolName: 'C', snippet: 'SECRET_SNIPPET' },
        semanticScore: 0.8,
        structuralMatch: 'SAME_NAMESPACE',
        combinedScore: 0.7,
        decision: 'SELECTED',
      },
    ]);

    expect(candidate).toEqual({
      rank: 1,
      chunkId: 'k1',
      filePath: 'src/x.ts',
      symbolQualifiedName: 'C.f',
      semanticScore: 0.8,
      structuralRelation: 'SAME_NAMESPACE',
      combinedScore: 0.7,
      selected: true,
    });
    expect(JSON.stringify(candidate)).not.toContain('SECRET_SNIPPET');
  });

  it('leaves filePath null for a RAG candidate without excerpt and selected null for an unknown decision', () => {
    const [candidate] = toRagCandidates([{ chunkId: 'k2', rank: 2, decision: 'PENDING' }]);

    expect(candidate.filePath).toBeNull();
    expect(candidate.symbolQualifiedName).toBeNull();
    expect(candidate.selected).toBeNull();
  });

  it('maps comparison candidates field by field and keeps combinedScore from the stored record', () => {
    const [candidate] = toComparisonCandidates([
      {
        rank: 1,
        chunkId: 'c',
        filePath: 'f.ts',
        symbolQualifiedName: 'A.b',
        semanticScore: 0.5,
        structuralRelation: 'IMPORTS',
        combinedScore: 0.42,
        selected: true,
        extraNotExposed: 'x',
      },
    ]);

    expect(candidate).toEqual({
      rank: 1,
      chunkId: 'c',
      filePath: 'f.ts',
      symbolQualifiedName: 'A.b',
      semanticScore: 0.5,
      structuralRelation: 'IMPORTS',
      combinedScore: 0.42,
      selected: true,
    });
  });

  it('reads metrics only when all four values are numbers', () => {
    expect(toRetrievalMetrics({ precisionAt5: 0.2, recallAt5: 0.5, precisionAt10: 0.1, recallAt10: 1 })).toEqual({
      precisionAt5: 0.2,
      recallAt5: 0.5,
      precisionAt10: 0.1,
      recallAt10: 1,
    });
    expect(toRetrievalMetrics({ precisionAt5: 0.2, recallAt5: 0.5 })).toBeNull();
    expect(toRetrievalMetrics(null)).toBeNull();
  });
});

describe('agent steps', () => {
  it('keeps only step, toolName and status (no arguments, results or reasoning)', () => {
    expect(
      toAgentSteps([
        { step: 1, toolName: 'read_file', status: 'OK', arguments: { relativePath: 'a.ts' }, resultSummary: 'SECRET', resultSha256: 'x' },
      ]),
    ).toEqual([{ step: 1, toolName: 'read_file', status: 'OK' }]);
  });
});
