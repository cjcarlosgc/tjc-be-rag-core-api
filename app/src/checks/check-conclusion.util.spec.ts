import { describe, expect, it } from 'vitest';
import { buildCheckTitle, mapRunStatusToCheckConclusion } from './check-conclusion.util.js';
import type { AnalysisRunStatus } from '../generated/prisma/client.js';

describe('mapRunStatusToCheckConclusion', () => {
  it.each([
    ['SUCCESS', 'success'],
    ['NO_ADDITIONAL_TESTS_REQUIRED', 'success'],
    ['NO_TEST_RELEVANT_CHANGES', 'success'],
    ['BEHAVIORAL_MISMATCH', 'failure'],
    ['TECHNICAL_GENERATION_FAILURE', 'failure'],
    ['BASELINE_FAILED', 'neutral'],
    ['INFRASTRUCTURE_FAILURE', 'neutral'],
    ['ACTION_REQUIRED', 'action_required'],
  ] satisfies Array<[AnalysisRunStatus, string]>)('maps %s to %s', (status, conclusion) => {
    expect(mapRunStatusToCheckConclusion(status)).toBe(conclusion);
  });

  it.each(['QUEUED', 'PROCESSING', 'OBSOLETE'] satisfies AnalysisRunStatus[])(
    'returns null for the non-publishable status %s',
    (status) => {
      expect(mapRunStatusToCheckConclusion(status)).toBeNull();
    },
  );
});

describe('buildCheckTitle', () => {
  it('returns a human title for a known status', () => {
    expect(buildCheckTitle('SUCCESS')).toBe('Análisis exitoso');
  });
});
