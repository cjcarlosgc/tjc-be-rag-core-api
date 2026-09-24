import { describe, expect, it, vi } from 'vitest';
import { ExperimentRunsRepository } from './experiment-runs.repository.js';

describe('ExperimentRunsRepository.findRepetitions', () => {
  it('returns only the latest attempt for each strategy and repetition', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'rag-2', strategy: 'RAG', repetition: 1, attempt: 2 },
      { id: 'rag-1', strategy: 'RAG', repetition: 1, attempt: 1 },
      { id: 'rag-other', strategy: 'RAG', repetition: 2, attempt: 1 },
      { id: 'agent-1', strategy: 'GENERALIST_AGENT', repetition: 1, attempt: 1 },
    ]);
    const repository = new ExperimentRunsRepository({
      experimentRepetition: { findMany },
    } as never);

    const repetitions = await repository.findRepetitions('experiment-1');

    expect(findMany).toHaveBeenCalledWith({
      where: { experimentId: 'experiment-1' },
      orderBy: [{ strategy: 'asc' }, { repetition: 'asc' }, { attempt: 'desc' }],
    });
    expect(repetitions.map(({ id }) => id)).toEqual(['rag-2', 'rag-other', 'agent-1']);
  });
});
