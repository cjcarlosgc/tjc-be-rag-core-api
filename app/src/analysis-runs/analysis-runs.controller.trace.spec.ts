import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ACCESS_POLICY_KEY, type AccessPolicy } from '../project-access/access-policy.js';
import { AnalysisRunsController } from './analysis-runs.controller.js';

/** WI-CORE-026: `/trace` exige Reader sobre el AnalysisRun de la ruta (INTEROP-2.7 §6.13). */
describe('GET /analysis-runs/:id/trace route policy', () => {
  it('requires READER on the analysisRun named by the :id path parameter', () => {
    const policy = Reflect.getMetadata(
      ACCESS_POLICY_KEY,
      AnalysisRunsController.prototype.getTrace as object,
    ) as AccessPolicy;

    expect(policy).toEqual({
      kind: 'ROLE',
      minRole: 'READER',
      target: { from: 'param', name: 'id', resource: 'analysisRun' },
    });
  });
});
