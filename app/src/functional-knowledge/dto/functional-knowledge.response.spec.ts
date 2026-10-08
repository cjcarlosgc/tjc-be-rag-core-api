import { describe, expect, it } from 'vitest';
import { toFunctionalKnowledgeResponse } from './functional-knowledge.response.js';
import type { FunctionalKnowledge } from '../../generated/prisma/client.js';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

function buildRow(overrides: Partial<FunctionalKnowledge> = {}): FunctionalKnowledge {
  return {
    id: 'knowledge-1',
    projectId: 'project-1',
    scope: 'METHOD',
    targetRef: 'src/thing.ts::Thing.doIt',
    originalQuestion: '¿Qué hace?',
    originalAnswer: 'sí',
    normalizedRule: 'sí',
    source: 'HUMAN_ANSWER',
    status: 'ACTIVE',
    supersedesId: null,
    confirmedByUserId: 'user-1',
    confirmedRole: 'ADMIN',
    originHeadSha: 'head-sha',
    sourceRef: null,
    createdAt: CREATED_AT,
    ...overrides,
  } as FunctionalKnowledge;
}

describe('toFunctionalKnowledgeResponse procedencia (INTEROP-2.7)', () => {
  it('emits the procedencia of a rule created with it', () => {
    expect(toFunctionalKnowledgeResponse(buildRow())).toMatchObject({
      confirmedByUserId: 'user-1',
      confirmedRole: 'ADMIN',
      originHeadSha: 'head-sha',
      sourceRef: null,
    });
  });

  it('emits null for every procedencia field of a historical rule', () => {
    const response = toFunctionalKnowledgeResponse(
      buildRow({ confirmedByUserId: null, confirmedRole: null, originHeadSha: null, sourceRef: null }),
    );

    expect(response).toMatchObject({
      confirmedByUserId: null,
      confirmedRole: null,
      originHeadSha: null,
      sourceRef: null,
    });
  });

  it('maps without failing when the row omits the procedencia properties entirely', () => {
    const partial = buildRow();
    delete (partial as Partial<FunctionalKnowledge>).confirmedByUserId;
    delete (partial as Partial<FunctionalKnowledge>).confirmedRole;
    delete (partial as Partial<FunctionalKnowledge>).originHeadSha;
    delete (partial as Partial<FunctionalKnowledge>).sourceRef;

    expect(toFunctionalKnowledgeResponse(partial)).toMatchObject({
      confirmedByUserId: null,
      confirmedRole: null,
      originHeadSha: null,
      sourceRef: null,
      createdAt: CREATED_AT.toISOString(),
    });
  });

  it('passes through the sourceRef of an APPROVED_IMPORT rule', () => {
    const response = toFunctionalKnowledgeResponse(
      buildRow({ source: 'APPROVED_IMPORT', sourceRef: 'import://batch-1' }),
    );

    expect(response.sourceRef).toBe('import://batch-1');
    expect(response.source).toBe('APPROVED_IMPORT');
  });
});
