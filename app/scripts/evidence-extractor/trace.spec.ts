// WI-CORE-094: trace de 9 enlaces y chequeo inverso. Un recuento de 0 filas rotas = PRESENT; más de 0 = INCONSISTENT.
import { describe, expect, it } from 'vitest';
import { LINK_VERDICT, buildTrace, inverseVerdict } from './trace.mjs';
import { INVERSE_CHECKS } from './queries.mjs';

const RUN = {
  id: 'run-1',
  repositoryName: 'acme/pilot',
  prNumber: 7,
  baseSha: 'b'.repeat(40),
  headSha: 'h'.repeat(40),
  changesetBaseSha: 'b'.repeat(40),
  changesetHeadSha: 'h'.repeat(40),
  status: 'SUCCESS',
  createdAt: '2026-10-24T10:00:00.000Z',
  completedAt: '2026-10-24T10:05:00.000Z',
  checkId: null,
  checkPublishedAt: null,
};

function data(overrides: Partial<Record<string, unknown[]>> = {}) {
  return {
    symbols: [
      { id: 's1', kind: 'FUNCTION', changeKind: 'DIRECTLY_CHANGED' },
      { id: 's2', kind: 'CLASS', changeKind: 'DIRECTLY_CHANGED' },
      { id: 's3', kind: 'METHOD', changeKind: 'POTENTIALLY_IMPACTED' },
    ],
    retrievals: [{ id: 'r1' }],
    contexts: [{ id: 'c1' }],
    proposals: [{ id: 'p1', contextId: 'c1' }],
    executions: [{ id: 'e1', outcome: 'PASSED' }],
    publications: [],
    ...overrides,
  } as never;
}

function checkRows(counts: Partial<Record<string, number>> = {}) {
  return INVERSE_CHECKS.map((check) => ({ check, rowCount: counts[check.id] ?? 0 }));
}

describe('buildTrace', () => {
  it('marca PRESENT los enlaces con filas y NOT_APPLICABLE los vacíos', () => {
    const trace = buildTrace({ runId: 'run-1', run: RUN, data: data(), inverseResults: checkRows(), generatedAt: 'x' });
    const byNumber = Object.fromEntries(trace.directLinks.map((link) => [link.number, link.verdict]));
    expect(byNumber[1]).toBe(LINK_VERDICT.PRESENT);
    expect(byNumber[3]).toBe(LINK_VERDICT.PRESENT);
    expect(byNumber[9]).toBe(LINK_VERDICT.NOT_APPLICABLE);
    expect(trace.directLinks.find((link) => link.number === 3)?.count).toBe(1);
  });

  it('el chequeo inverso con 0 filas da PRESENT y con filas da INCONSISTENT, marcando el enlace', () => {
    const trace = buildTrace({
      runId: 'run-1',
      run: RUN,
      data: data(),
      inverseResults: checkRows({ executionProposalOtherRun: 2 }),
      generatedAt: 'x',
    });
    const execution = trace.inverseChecks.find((item) => item.id === 'executionProposalOtherRun');
    expect(execution?.verdict).toBe(LINK_VERDICT.INCONSISTENT);
    expect(execution?.rowCount).toBe(2);
    expect(trace.directLinks.find((link) => link.number === 7)?.verdict).toBe(LINK_VERDICT.INCONSISTENT);
    expect(trace.inverseChecks.find((item) => item.id === 'retrievalSymbolOtherRun')?.verdict).toBe(LINK_VERDICT.PRESENT);
  });

  it('sin filas de origen el chequeo inverso es NOT_APPLICABLE', () => {
    const trace = buildTrace({
      runId: 'run-1',
      run: RUN,
      data: data({ publications: [] }),
      inverseResults: checkRows(),
      generatedAt: 'x',
    });
    expect(trace.inverseChecks.find((item) => item.id === 'publicationHeadNotRunHead')?.verdict).toBe(
      LINK_VERDICT.NOT_APPLICABLE,
    );
  });

  it('incluye el SQL de cada comprobación y no contiene valores', () => {
    const trace = buildTrace({ runId: 'run-1', run: RUN, data: data(), inverseResults: checkRows(), generatedAt: 'x' });
    for (const item of trace.inverseChecks) {
      expect(item.sql).toMatch(/^SELECT count\(\*\)/);
      expect(item.sql).not.toMatch(/run-1/);
    }
  });
});

describe('inverseVerdict', () => {
  it('traduce recuentos a veredictos', () => {
    expect(inverseVerdict({ check: {} as never, rowCount: 0, sourceCount: 3 })).toBe(LINK_VERDICT.PRESENT);
    expect(inverseVerdict({ check: {} as never, rowCount: 1, sourceCount: 3 })).toBe(LINK_VERDICT.INCONSISTENT);
    expect(inverseVerdict({ check: {} as never, rowCount: 0, sourceCount: 0 })).toBe(LINK_VERDICT.NOT_APPLICABLE);
  });
});
