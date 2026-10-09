import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisRunTraceService } from './analysis-run-trace.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';

/** WI-CORE-026: cadena de §6.16 sobre fixtures; los repositorios se simulan, la lógica de enlaces es real. */
function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryName: 'org/repo',
    prNumber: 42,
    headSha: 'head-1',
    status: 'SUCCESS',
    ...overrides,
  };
}

function makeSymbol(overrides: Record<string, unknown>) {
  return {
    id: 'symbol-x',
    analysisRunId: 'run-1',
    language: 'TYPESCRIPT',
    kind: 'METHOD',
    qualifiedName: 'Thing.doIt',
    filePath: 'src/thing.ts',
    changeKind: 'DIRECTLY_CHANGED',
    behaviorConstructs: [{ scenarioKind: 'EXPECTED_RESULT', scenarioKey: 'k', order: 1, snippet: 'CODIGO_NO_EXPUESTO' }],
    createdAt: new Date(0),
    ...overrides,
  };
}

function makeService(options: {
  run?: Record<string, unknown>;
  symbols?: unknown[];
  retrievals?: unknown[];
  contexts?: unknown[];
  proposals?: unknown[];
  executions?: unknown[];
  publications?: unknown[];
} = {}) {
  const analysisRunsService = { getById: vi.fn().mockResolvedValue(options.run ?? makeRun()) };
  const analysisSymbolsRepository = { findByAnalysisRun: vi.fn().mockResolvedValue(options.symbols ?? []) };
  const trace = {
    findRetrievalsByRun: vi.fn().mockResolvedValue(options.retrievals ?? []),
    findContextsByRun: vi.fn().mockResolvedValue(options.contexts ?? []),
    findProposalsByRun: vi.fn().mockResolvedValue(options.proposals ?? []),
    findExecutionsByRun: vi.fn().mockResolvedValue(options.executions ?? []),
    findTestPublicationsByRun: vi.fn().mockResolvedValue(options.publications ?? []),
  };
  const service = new AnalysisRunTraceService(
    analysisRunsService as never,
    analysisSymbolsRepository as never,
    trace as never,
  );

  return { service, analysisRunsService, analysisSymbolsRepository, trace };
}

const SYMBOL_A = makeSymbol({ id: 'symbol-a', kind: 'FUNCTION', qualifiedName: 'helper', filePath: 'src/a.ts' });
const SYMBOL_B = makeSymbol({ id: 'symbol-b', kind: 'METHOD', qualifiedName: 'Thing.doIt', filePath: 'src/b.ts' });

describe('AnalysisRunTraceService (WI-CORE-026, INTEROP-2.7 §6.16)', () => {
  it('returns the full chain for the DIRECTLY_CHANGED METHOD/FUNCTION targets in position order and never exposes code or counts', async () => {
    const { service } = makeService({
      symbols: [
        SYMBOL_B,
        SYMBOL_A,
        makeSymbol({ id: 'symbol-class', kind: 'CLASS', qualifiedName: 'Thing', filePath: 'src/a.ts' }),
        makeSymbol({ id: 'symbol-imp', qualifiedName: 'Other.x', filePath: 'src/c.ts', changeKind: 'POTENTIALLY_IMPACTED' }),
      ],
      retrievals: [{ id: 'retrieval-a', analysisSymbolId: 'symbol-a' }],
      contexts: [{ id: 'context-a', analysisSymbolId: 'symbol-a', functionalRuleIds: ['rule-1'] }],
      proposals: [{ id: 'proposal-a', analysisSymbolId: 'symbol-a' }],
      executions: [
        {
          id: 'execution-row-2',
          proposalId: 'proposal-a',
          executionId: 'exec-2',
          attempt: 2,
          executionProfile: 'NODE_TYPESCRIPT',
          outcome: 'SUCCESS',
          proposal: { analysisSymbolId: 'symbol-a' },
        },
        {
          id: 'execution-row-1',
          proposalId: 'proposal-a',
          executionId: 'exec-1',
          attempt: 1,
          executionProfile: 'NODE_TYPESCRIPT',
          outcome: 'BEHAVIORAL_MISMATCH',
          proposal: { analysisSymbolId: 'symbol-a' },
        },
      ],
      publications: [
        {
          id: 'pub-old',
          status: 'STALE',
          branchName: 'rag/old',
          companionPullRequestUrl: 'https://github.com/org/repo/pull/6',
          sourceHeadSha: 'head-0',
          createdAt: new Date('2026-10-01T00:00:00Z'),
        },
        {
          id: 'pub-new',
          status: 'PUBLISHED',
          branchName: 'rag/new',
          companionPullRequestUrl: 'https://github.com/org/repo/pull/7',
          sourceHeadSha: 'head-1',
          createdAt: new Date('2026-10-05T00:00:00Z'),
        },
      ],
    });

    const trace = await service.getTrace('run-1', 'user-1');

    expect(trace).toMatchObject({
      analysisRunId: 'run-1',
      repositoryName: 'org/repo',
      pullRequestNumber: 42,
      headSha: 'head-1',
      changeset: { status: 'PRESENT', targetCount: 2 },
    });
    expect(trace.targets.map((target) => target.symbol.qualifiedName)).toEqual(['helper', 'Thing.doIt']);
    expect(trace.targets[0]).toMatchObject({
      symbol: { language: 'TYPESCRIPT', kind: 'FUNCTION', qualifiedName: 'helper', filePath: 'src/a.ts', changeKind: 'DIRECTLY_CHANGED' },
      retrieval: { status: 'PRESENT', retrievalId: 'retrieval-a' },
      context: { status: 'PRESENT', contextId: 'context-a', functionalRuleIds: ['rule-1'] },
      generation: { status: 'PRESENT', proposalIds: ['proposal-a'] },
      executions: {
        status: 'PRESENT',
        items: [
          { executionId: 'exec-1', proposalId: 'proposal-a', attempt: 1, executionProfile: 'NODE_TYPESCRIPT', outcome: 'BEHAVIORAL_MISMATCH' },
          { executionId: 'exec-2', proposalId: 'proposal-a', attempt: 2, executionProfile: 'NODE_TYPESCRIPT', outcome: 'SUCCESS' },
        ],
      },
    });
    expect(trace.targets[1]).toEqual({
      symbol: expect.objectContaining({ qualifiedName: 'Thing.doIt' }),
      retrieval: { status: 'NOT_APPLICABLE', retrievalId: null },
      context: { status: 'NOT_APPLICABLE', contextId: null, functionalRuleIds: [] },
      generation: { status: 'NOT_APPLICABLE', proposalIds: [] },
      executions: { status: 'NOT_APPLICABLE', items: [] },
    });
    expect(trace.publication).toEqual({
      status: 'PRESENT',
      checkId: null,
      companionBranch: 'rag/new',
      companionPullRequestUrl: 'https://github.com/org/repo/pull/7',
      sourceHeadSha: 'head-1',
      freshness: 'CURRENT',
    });

    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain('CODIGO_NO_EXPUESTO');
    expect(serialized).not.toContain('behaviorConstructs');
    expect(serialized).not.toContain('omitted');
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('selectedChunkIds');
    expect(serialized).not.toContain('knowledgeId');
  });

  it('reports a run without DIRECTLY_CHANGED METHOD/FUNCTION targets as changeset NOT_APPLICABLE and publication NOT_APPLICABLE', async () => {
    const { service, trace } = makeService({
      symbols: [makeSymbol({ kind: 'CLASS', qualifiedName: 'Thing' })],
    });

    const result = await service.getTrace('run-1', 'user-1');

    expect(result.changeset).toEqual({ status: 'NOT_APPLICABLE', targetCount: 0 });
    expect(result.targets).toEqual([]);
    expect(result.publication).toEqual({
      status: 'NOT_APPLICABLE',
      checkId: null,
      companionBranch: null,
      companionPullRequestUrl: null,
      sourceHeadSha: null,
      freshness: null,
    });
    expect(trace.findRetrievalsByRun).toHaveBeenCalledWith('run-1');
  });

  it('keeps the links after retrieval NOT_APPLICABLE for a run stopped in ACTION_REQUIRED before generating', async () => {
    const { service } = makeService({
      run: makeRun({ status: 'ACTION_REQUIRED' }),
      symbols: [SYMBOL_A],
    });

    const result = await service.getTrace('run-1', 'user-1');

    expect(result.changeset).toEqual({ status: 'PRESENT', targetCount: 1 });
    expect(result.targets[0]).toMatchObject({
      retrieval: { status: 'NOT_APPLICABLE', retrievalId: null },
      context: { status: 'NOT_APPLICABLE', contextId: null, functionalRuleIds: [] },
      generation: { status: 'NOT_APPLICABLE', proposalIds: [] },
      executions: { status: 'NOT_APPLICABLE', items: [] },
    });
    expect(result.publication.status).toBe('NOT_APPLICABLE');
  });

  it('answers 409 EVIDENCE_NOT_FINISHED while the run is QUEUED or PROCESSING', async () => {
    for (const status of ['QUEUED', 'PROCESSING']) {
      const { service, trace } = makeService({ run: makeRun({ status }), symbols: [SYMBOL_A] });

      const error = await service.getTrace('run-1', 'user-1').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(AppException);
      expect(error).toMatchObject({ code: ErrorCode.EVIDENCE_NOT_FINISHED, status: HttpStatus.CONFLICT });
      expect(trace.findRetrievalsByRun).not.toHaveBeenCalled();
    }
  });

  it('propagates the 404 of the run lookup without reading any evidence', async () => {
    const { service, analysisRunsService, trace } = makeService();
    analysisRunsService.getById.mockRejectedValue(
      new AppException(ErrorCode.ANALYSIS_RUN_NOT_FOUND, 'No existe un AnalysisRun con id "missing".', HttpStatus.NOT_FOUND),
    );

    const error = await service.getTrace('missing', 'user-1').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: ErrorCode.ANALYSIS_RUN_NOT_FOUND, status: HttpStatus.NOT_FOUND });
    expect(trace.findExecutionsByRun).not.toHaveBeenCalled();
  });

  it('exposes STALE freshness only for a STALE publication and null for any other state', async () => {
    for (const [status, freshness] of [
      ['STALE', 'STALE'],
      ['PUBLISHED', 'CURRENT'],
      ['PENDING', null],
      ['PUBLISHING', null],
      ['FAILED', null],
      ['CLOSED', null],
    ] as const) {
      const { service } = makeService({
        publications: [
          {
            id: `pub-${status}`,
            status,
            branchName: 'rag/x',
            companionPullRequestUrl: null,
            sourceHeadSha: 'head-1',
            createdAt: new Date('2026-10-05T00:00:00Z'),
          },
        ],
      });

      const result = await service.getTrace('run-1', 'user-1');

      expect(result.publication).toMatchObject({ status: 'PRESENT', freshness, companionBranch: 'rag/x', sourceHeadSha: 'head-1' });
    }
  });
});
