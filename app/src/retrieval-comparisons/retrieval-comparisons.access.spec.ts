import { describe, expect, it, vi } from 'vitest';
import { ACCESS_POLICY_KEY, type AccessPolicy } from '../project-access/access-policy.js';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';
import { resourceNotFound } from '../project-access/project-access.errors.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { RetrievalComparisonsController } from './retrieval-comparisons.controller.js';

/** INTEROP-2.7 §6.15: Writer crea, Reader lee; el recurso de cada ruta es el que el guard resuelve. */
describe('retrieval comparison route policies (INTEROP-2.7 §6.15)', () => {
  const policyOf = (method: keyof RetrievalComparisonsController) =>
    Reflect.getMetadata(ACCESS_POLICY_KEY, RetrievalComparisonsController.prototype[method] as object) as AccessPolicy;

  it('POST requires Writer on the analysisRun named in the body', () => {
    expect(policyOf('create')).toEqual({
      kind: 'ROLE',
      minRole: 'WRITER',
      target: { from: 'body', name: 'analysisRunId', resource: 'analysisRun' },
    });
  });

  it('GET status and GET results require Reader on the retrievalComparison in the path', () => {
    const expected = { kind: 'ROLE', minRole: 'READER', target: { from: 'param', name: 'id', resource: 'retrievalComparison' } };

    expect(policyOf('getStatus')).toEqual(expected);
    expect(policyOf('getResults')).toEqual(expected);
  });

  it('the listing requires Reader on the analysisRun in the path', () => {
    expect(policyOf('list')).toEqual({
      kind: 'ROLE',
      minRole: 'READER',
      target: { from: 'param', name: 'analysisRunId', resource: 'analysisRun' },
    });
  });
});

describe('retrievalComparison as a project-access resource', () => {
  it('maps an invisible comparison to the comparison 404 (same as an unknown id)', () => {
    const error = resourceNotFound('retrievalComparison', 'cmp-1');

    expect(error.getStatus()).toBe(404);
    expect(error.code).toBe(ErrorCode.RETRIEVAL_COMPARISON_NOT_FOUND);
  });

  it('resolves the owning Project of a comparison without visibility filtering', async () => {
    const findUnique = vi.fn().mockResolvedValue({ projectId: 'project-9' });
    const repository = new ProjectAccessRepository({ retrievalComparison: { findUnique } } as never);

    await expect(repository.findProjectIdOf('retrievalComparison', 'cmp-1')).resolves.toBe('project-9');
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'cmp-1' }, select: { projectId: true } });
  });

  it('returns null when the comparison does not exist', async () => {
    const repository = new ProjectAccessRepository({ retrievalComparison: { findUnique: vi.fn().mockResolvedValue(null) } } as never);

    await expect(repository.findProjectIdOf('retrievalComparison', 'missing')).resolves.toBeNull();
  });
});
