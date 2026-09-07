import { describe, expect, it } from 'vitest';
import {
  sandboxExperimentRequestId,
  sandboxGenerationRequestId,
  sandboxManualRetryRequestId,
} from './sandbox-request-id.util.js';

describe('sandbox request-id builders (DEC-IDEMP-001)', () => {
  it('generation: same jobId+targetId always yields the same requestId', () => {
    const a = sandboxGenerationRequestId('job-1', 'target-1');
    const b = sandboxGenerationRequestId('job-1', 'target-1');

    expect(a).toBe(b);
    expect(sandboxGenerationRequestId('job-1', 'target-2')).not.toBe(a);
  });

  it('experiment: same jobId+strategy+repetition always yields the same requestId', () => {
    const a = sandboxExperimentRequestId('job-1', 'RAG', 1);
    const b = sandboxExperimentRequestId('job-1', 'RAG', 1);

    expect(a).toBe(b);
    expect(sandboxExperimentRequestId('job-1', 'RAG', 2)).not.toBe(a);
    expect(sandboxExperimentRequestId('job-1', 'GENERALIST_AGENT', 1)).not.toBe(a);
  });

  it('manual-retry: same retryJobId+targetId always yields the same requestId', () => {
    const a = sandboxManualRetryRequestId('retry-job-1', 'target-1');
    const b = sandboxManualRetryRequestId('retry-job-1', 'target-1');

    expect(a).toBe(b);
    expect(sandboxManualRetryRequestId('retry-job-2', 'target-1')).not.toBe(a);
  });

  it('the three URN kinds never collide with each other for the same ids', () => {
    const generation = sandboxGenerationRequestId('job-1', 'target-1');
    const retry = sandboxManualRetryRequestId('job-1', 'target-1');

    expect(generation).not.toBe(retry);
  });
});
