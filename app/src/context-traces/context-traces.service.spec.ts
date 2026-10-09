import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpStatus } from '@nestjs/common';
import type { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextTracesService } from './context-traces.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

const USER_ID = 'user-1';
const SNAPSHOT_KEY = 'private/snapshot.zip';
const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function makeExcerpt(overrides: Record<string, unknown> = {}) {
  return {
    filePath: 'src/foo.ts',
    symbolName: 'foo',
    parentSymbolName: null,
    startLine: 5,
    endLine: 5,
    snippet: 'const foo = 1;',
    contentSha256: 'a'.repeat(64),
    truncated: false,
    ...overrides,
  };
}

function makeTrace(
  kind: 'RAG' | 'AGENT',
  overrides: Record<string, unknown> = {},
) {
  const detail =
    kind === 'RAG'
      ? {
          target: {
            chunkIds: ['target-chunk'],
            excerpt: makeExcerpt(),
            tokenCount: 12,
          },
          candidates: [
            {
              chunkId: 'candidate-1',
              rank: 1,
              excerpt: makeExcerpt({
                startLine: 9,
                endLine: 9,
                snippet: 'return foo;',
              }),
              tokenCount: 8,
              semanticScore: 0.8,
              structuralMatch: 'IMPORTS',
              combinedScore: 0.86,
              matchedVia: ['SEMANTIC', 'IMPORTS'],
              decision: 'SELECTED',
              discardReason: null,
            },
          ],
          retrievedChunks: 1,
          selectedChunks: 1,
          contextTokens: 20,
          configuration: {
            minimumScore: 0.1,
            topK: 5,
            maxContextTokens: 100,
            semanticWeight: 0.7,
            structuralWeight: 0.3,
          },
        }
      : {
          trajectory: [
            {
              step: 1,
              toolName: 'list_files',
              arguments: {},
              status: 'SUCCEEDED',
              resultSummary: 'Listado disponible: 2 archivos.',
              resultSha256: 'b'.repeat(64),
              truncated: true,
              observations: [
                {
                  kind: 'FILE_LIST_SUMMARY',
                  filePath: null,
                  symbolName: null,
                  excerpt: null,
                  discoveredFilesCount: 2,
                },
              ],
            },
            {
              step: 2,
              toolName: 'read_file',
              arguments: { relativePath: 'src/foo.ts' },
              status: 'SUCCEEDED',
              resultSummary: 'Se leyó src/foo.ts.',
              resultSha256: 'c'.repeat(64),
              truncated: false,
              observations: [
                {
                  kind: 'FILE_CONTENT',
                  filePath: 'src/foo.ts',
                  symbolName: null,
                  excerpt: makeExcerpt(),
                  discoveredFilesCount: null,
                },
              ],
            },
          ],
        };

  return {
    id: 'trace-1',
    projectId: 'project-1',
    projectVersionId: 'version-1',
    targetId: 'target-1',
    experimentId: 'experiment-1',
    experimentRepetitionId: 'repetition-1',
    kind,
    strategy: kind === 'RAG' ? 'RAG' : 'GENERALIST_AGENT',
    repetition: 1,
    attempt: 1,
    current: true,
    state: 'COMPLETE',
    detail,
    toolCalls: 2,
    filesInspected: 1,
    createdAt: new Date('2026-09-23T12:00:00.000Z'),
    projectVersion: { snapshotKey: SNAPSHOT_KEY },
    target: {
      filePath: 'src/foo.ts',
      symbolName: 'foo',
      methodName: null,
      startLine: 5,
      endLine: 5,
    },
    experiment: { status: 'COMPLETED' },
    ...overrides,
  };
}

function makeService(overrides: Record<string, unknown> = {}) {
  const reads = {
    findExperimentForOwner: vi
      .fn()
      .mockResolvedValue({ id: 'experiment-1', status: 'COMPLETED' }),
    listForExperiment: vi.fn().mockResolvedValue([]),
    findForOwner: vi.fn().mockResolvedValue(makeTrace('RAG')),
    listDiscoveredFilesForOwner: vi.fn().mockResolvedValue([]),
  };
  const objectStorage = {
    get: vi.fn().mockResolvedValue(Buffer.from('snapshot')),
  };
  const zipExtraction = {
    extract: vi.fn(),
  };
  const readsDeps = { ...reads, ...overrides.reads };
  const objectStorageDeps = { ...objectStorage, ...overrides.objectStorage };
  const zipExtractionDeps = { ...zipExtraction, ...overrides.zipExtraction };
  return {
    service: new ContextTracesService(
      readsDeps as never,
      objectStorageDeps as never,
      zipExtractionDeps as never,
    ),
    reads: readsDeps,
    objectStorage: objectStorageDeps,
    zipExtraction: zipExtractionDeps,
  };
}

describe('ContextTracesService', () => {
  it('lists only current traces by default and emits the shared summary DTO', async () => {
    const row = makeTrace('RAG');
    const { service, reads } = makeService({
      reads: { listForExperiment: vi.fn().mockResolvedValue([row]) },
    });

    const page = await service.listContextTraces('experiment-1', USER_ID, {});

    expect(reads.findExperimentForOwner).toHaveBeenCalledWith(
      'experiment-1',
      USER_ID,
    );
    expect(reads.listForExperiment).toHaveBeenCalledWith({
      experimentId: 'experiment-1',
      userId: USER_ID,
      strategy: undefined,
      repetition: undefined,
      includeSuperseded: false,
      cursor: undefined,
      take: 20,
    });
    expect(page).toEqual({
      items: [
        {
          id: 'trace-1',
          kind: 'RAG',
          projectVersionId: 'version-1',
          targetId: 'target-1',
          testRunId: null,
          experimentId: 'experiment-1',
          strategy: 'RAG',
          repetition: 1,
          attempt: 1,
          current: true,
          artifactIds: [],
          createdAt: '2026-09-23T12:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
  });

  it('applies trace filters and returns the last emitted id as the next cursor', async () => {
    const first = makeTrace('RAG');
    const second = makeTrace('AGENT', { id: 'trace-2' });
    const extra = makeTrace('RAG', { id: 'trace-3' });
    const { service, reads } = makeService({
      reads: {
        listForExperiment: vi.fn().mockResolvedValue([first, second, extra]),
      },
    });

    const page = await service.listContextTraces('experiment-1', USER_ID, {
      strategy: 'RAG' as never,
      repetition: 2,
      includeSuperseded: true,
      limit: 2,
    });

    expect(reads.listForExperiment).toHaveBeenCalledWith({
      experimentId: 'experiment-1',
      userId: USER_ID,
      strategy: 'RAG',
      repetition: 2,
      includeSuperseded: true,
      cursor: undefined,
      take: 2,
    });
    expect(page.items.map(({ id }) => id)).toEqual(['trace-1', 'trace-2']);
    expect(page.nextCursor).toBe('trace-2');
  });

  it('returns 404 for an experiment that is not visible', async () => {
    const { service } = makeService({
      reads: { findExperimentForOwner: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      service.listContextTraces('hidden-experiment', USER_ID, {}),
    ).rejects.toMatchObject({
      code: ErrorCode.EXPERIMENT_NOT_FOUND,
    });
  });

  it('returns 409 for detail before the experiment is terminal', async () => {
    const { service, objectStorage } = makeService({
      reads: {
        findForOwner: vi
          .fn()
          .mockResolvedValue(
            makeTrace('RAG', { experiment: { status: 'RUNNING' } }),
          ),
      },
    });

    await expect(
      service.getContextTraceDetail('trace-1', USER_ID),
    ).rejects.toMatchObject({
      code: ErrorCode.CONTEXT_TRACE_NOT_FINISHED,
    });
    expect(objectStorage.get).not.toHaveBeenCalled();
  });

  it('returns 409 for discovered files before the experiment is terminal', async () => {
    const { service, reads } = makeService({
      reads: {
        findForOwner: vi
          .fn()
          .mockResolvedValue(
            makeTrace('AGENT', { experiment: { status: 'RUNNING' } }),
          ),
      },
    });

    await expect(
      service.listDiscoveredFiles('trace-1', USER_ID, {}),
    ).rejects.toMatchObject({
      code: ErrorCode.CONTEXT_TRACE_NOT_FINISHED,
    });
    expect(reads.listDiscoveredFilesForOwner).not.toHaveBeenCalled();
  });

  it('maps an AGENT detail carrying budget and per-step budget fields without changing the DTO', async () => {
    const base = makeTrace('AGENT');
    const baseDetail = base.detail as { trajectory: Array<Record<string, unknown>> };
    const detail = {
      trajectory: baseDetail.trajectory.slice(0, 1).map((step) => ({
        ...step,
        contextTokens: 12,
        truncationReason: 'CHAR_LIMIT',
      })),
      budget: {
        toolCallCap: 20,
        contextTokenBudget: 6000,
        contextTokensDelivered: 12,
        capReached: false,
        truncatedSteps: 1,
      },
    };
    const { service } = makeService({
      reads: {
        findForOwner: vi.fn().mockResolvedValue(makeTrace('AGENT', { detail, toolCalls: 1, filesInspected: 0 })),
      },
    });

    const result = await service.getContextTraceDetail('trace-1', USER_ID);

    expect(result).toMatchObject({
      kind: 'AGENT',
      toolCalls: 1,
      filesInspected: 0,
      trajectory: [expect.objectContaining({ step: 1, toolName: 'list_files', truncated: true })],
    });
    expect(result).not.toHaveProperty('budget');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('contextTokens');
    expect(serialized).not.toContain('truncationReason');
    expect(serialized).not.toContain('capReached');
  });

  it('returns an empty observed trajectory when Agent workspace acquisition failed before any tool call', async () => {
    const { service, objectStorage } = makeService({
      reads: {
        findForOwner: vi
          .fn()
          .mockResolvedValue(
            makeTrace('AGENT', {
              detail: null,
              toolCalls: 0,
              filesInspected: 0,
            }),
          ),
      },
    });

    const detail = await service.getContextTraceDetail('trace-1', USER_ID);

    expect(detail).toMatchObject({
      kind: 'AGENT',
      trajectory: [],
      toolCalls: 0,
      filesInspected: 0,
    });
    expect(objectStorage.get).not.toHaveBeenCalled();
  });

  it('reconstructs at most three neighboring lines from the private snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'context-trace-service-'));
    createdDirs.push(dir);
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, 'src/foo.ts'),
      'one\ntwo\nthree\nfour\nconst foo = 1;\nsix\nseven\neight\nnine\nten\n',
    );
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const { service, zipExtraction } = makeService({
      zipExtraction: {
        extract: vi.fn().mockResolvedValue({ dir, cleanup }),
      },
    });

    const detail = await service.getContextTraceDetail('trace-1', USER_ID);

    expect(detail.kind).toBe('RAG');
    if (detail.kind !== 'RAG') throw new Error('expected RAG detail');
    expect(detail.target.excerpt.before).toEqual([
      { lineNumber: 2, content: 'two' },
      { lineNumber: 3, content: 'three' },
      { lineNumber: 4, content: 'four' },
    ]);
    expect(detail.target.excerpt.after).toEqual([
      { lineNumber: 6, content: 'six' },
      { lineNumber: 7, content: 'seven' },
      { lineNumber: 8, content: 'eight' },
    ]);
    expect(
      detail.candidates[0].excerpt.before.map(({ lineNumber }) => lineNumber),
    ).toEqual([6, 7, 8]);
    expect(zipExtraction.extract).toHaveBeenCalledWith(Buffer.from('snapshot'));
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('pages discovered files only for list_files steps in a finished AGENT trace', async () => {
    const { service, reads } = makeService({
      reads: {
        findForOwner: vi.fn().mockResolvedValue(makeTrace('AGENT')),
        listDiscoveredFilesForOwner: vi.fn().mockResolvedValue([
          { id: 'file-1', filePath: 'src/foo.ts', step: 1 },
          { id: 'file-2', filePath: 'src/bar.ts', step: 1 },
        ]),
      },
    });

    const page = await service.listDiscoveredFiles('trace-1', USER_ID, {
      step: 1,
      limit: 1,
    });

    expect(reads.listDiscoveredFilesForOwner).toHaveBeenCalledWith(
      'trace-1',
      USER_ID,
      1,
      undefined,
      1,
    );
    expect(page).toEqual({
      items: [{ filePath: 'src/foo.ts' }],
      nextCursor: 'file-1',
    });
    await expect(
      service.listDiscoveredFiles('trace-1', USER_ID, { step: 2 }),
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_REQUEST,
    });
  });

  it('rejects a non-normalized discovered path before returning it', async () => {
    const { service } = makeService({
      reads: {
        findForOwner: vi.fn().mockResolvedValue(makeTrace('AGENT')),
        listDiscoveredFilesForOwner: vi
          .fn()
          .mockResolvedValue([
            { id: 'file-1', filePath: '../secret.txt', step: 1 },
          ]),
      },
    });

    await expect(
      service.listDiscoveredFiles('trace-1', USER_ID, { step: 1 }),
    ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
  });

  it('returns 404 CONTEXT_TRACE_NOT_FOUND when the trace is missing or not owned by the user', async () => {
    const { service, objectStorage } = makeService({
      reads: { findForOwner: vi.fn().mockResolvedValue(null) },
    });

    const error = await service
      .getContextTraceDetail('foreign-trace', USER_ID)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ErrorCode.CONTEXT_TRACE_NOT_FOUND });
    expect((error as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(objectStorage.get).not.toHaveBeenCalled();
  });

  it.each([
    [
      'SELECTED with a discard reason',
      { decision: 'SELECTED', discardReason: 'TOP_K_LIMIT' },
    ],
    [
      'DISCARDED without a discard reason',
      { decision: 'DISCARDED', discardReason: null },
    ],
    [
      'DISCARDED with an unknown discard reason',
      { decision: 'DISCARDED', discardReason: 'UNKNOWN_REASON' },
    ],
  ])(
    'returns 500 INTERNAL_ERROR for a candidate that is %s',
    async (_label, overrides) => {
      const { service } = makeService({
        reads: {
          findForOwner: vi
            .fn()
            .mockResolvedValue(makeRagTrace([makeRagCandidate(overrides)])),
        },
      });

      await expect(
        service.getContextTraceDetail('trace-1', USER_ID),
      ).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
    },
  );

  it('exposes DISCARDED candidates with their reason, rank and effective configuration', async () => {
    const candidates = [
      makeRagCandidate({ chunkId: 'selected', rank: 1, combinedScore: 0.9 }),
      makeRagCandidate({
        chunkId: 'top-k',
        rank: 2,
        combinedScore: 0.8,
        decision: 'DISCARDED',
        discardReason: 'TOP_K_LIMIT',
      }),
      makeRagCandidate({
        chunkId: 'budget',
        rank: 3,
        combinedScore: 0.7,
        tokenCount: 90,
        decision: 'DISCARDED',
        discardReason: 'TOKEN_BUDGET',
      }),
      makeRagCandidate({
        chunkId: 'below',
        rank: 4,
        combinedScore: 0.05,
        semanticScore: 0.05,
        decision: 'DISCARDED',
        discardReason: 'BELOW_MINIMUM_SCORE',
      }),
    ];
    const { service } = makeService({
      reads: {
        findForOwner: vi.fn().mockResolvedValue(makeRagTrace(candidates)),
      },
    });

    const detail = await service.getContextTraceDetail('trace-1', USER_ID);

    expect(detail.kind).toBe('RAG');
    if (detail.kind !== 'RAG') throw new Error('expected RAG detail');
    expect(
      detail.candidates.map(({ chunkId, rank, decision, discardReason }) => [
        chunkId,
        rank,
        decision,
        discardReason,
      ]),
    ).toEqual([
      ['selected', 1, 'SELECTED', null],
      ['top-k', 2, 'DISCARDED', 'TOP_K_LIMIT'],
      ['budget', 3, 'DISCARDED', 'TOKEN_BUDGET'],
      ['below', 4, 'DISCARDED', 'BELOW_MINIMUM_SCORE'],
    ]);
    expect(detail.retrievedChunks).toBe(4);
    expect(detail.selectedChunks).toBe(1);
    expect(detail.configuration).toEqual({
      minimumScore: 0.1,
      topK: 2,
      maxContextTokens: 100,
      semanticWeight: 0.7,
      structuralWeight: 0.3,
    });
  });

  it('does not expose the WI-CORE-026 functional rule evidence in the INTEROP §6.7 RAG detail', async () => {
    const base = makeRagTrace([]);
    const trace = {
      ...base,
      detail: {
        ...(base.detail as object),
        functionalRules: {
          functionalRuleIds: ['rule-1'],
          retrieved: 2,
          selected: 1,
          omitted: [{ knowledgeId: 'rule-2', reason: 'TOKEN_BUDGET' }],
        },
      },
    };
    const { service } = makeService({
      reads: {
        findForOwner: vi.fn().mockResolvedValue(trace),
      },
    });

    const detail = await service.getContextTraceDetail('trace-1', USER_ID);
    const serialized = JSON.stringify(detail);

    expect(detail.kind).toBe('RAG');
    expect(serialized).not.toContain('functionalRules');
    expect(serialized).not.toContain('rule-1');
    expect(serialized).not.toContain('rule-2');
  });

  it('accepts a RAG trace without candidates as a valid read', async () => {
    const { service } = makeService({
      reads: {
        findForOwner: vi.fn().mockResolvedValue(makeRagTrace([])),
      },
    });

    const detail = await service.getContextTraceDetail('trace-1', USER_ID);

    expect(detail).toMatchObject({
      kind: 'RAG',
      candidates: [],
      retrievedChunks: 0,
      selectedChunks: 0,
      target: { chunkIds: ['target-chunk'], tokenCount: 12 },
    });
  });
});

// Excerpts without line numbers skip the private snapshot, so these fixtures
// exercise the mapping rules without needing a real workspace extraction.
function makeNullLineExcerpt(overrides: Record<string, unknown> = {}) {
  return makeExcerpt({ startLine: null, endLine: null, ...overrides });
}

function makeRagCandidate(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: 'candidate-1',
    rank: 1,
    excerpt: makeNullLineExcerpt({ filePath: 'src/bar.ts', snippet: 'bar' }),
    tokenCount: 8,
    semanticScore: 0.9,
    structuralMatch: null,
    combinedScore: 0.9,
    matchedVia: ['SEMANTIC'],
    decision: 'SELECTED',
    discardReason: null,
    ...overrides,
  };
}

function makeRagTrace(candidates: unknown[]) {
  return makeTrace('RAG', {
    detail: {
      target: {
        chunkIds: ['target-chunk'],
        excerpt: makeNullLineExcerpt(),
        tokenCount: 12,
      },
      candidates,
      retrievedChunks: candidates.length,
      selectedChunks: candidates.filter(
        (candidate) => (candidate as { decision: string }).decision === 'SELECTED',
      ).length,
      contextTokens: 20,
      configuration: {
        minimumScore: 0.1,
        topK: 2,
        maxContextTokens: 100,
        semanticWeight: 0.7,
        structuralWeight: 0.3,
      },
    },
  });
}
