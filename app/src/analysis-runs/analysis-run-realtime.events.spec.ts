import { describe, expect, it, vi } from 'vitest';
import { AnalysisRunRealtimeEvents } from './analysis-run-realtime.events.js';
import { toAnalysisRunDetailResponse } from './dto/analysis-run.response.js';
import type { AnalysisRun, AnalysisSymbol } from '../generated/prisma/client.js';

const run = {
  id: 'run-1',
  projectId: 'project-1',
  repositoryId: 'repo-1',
  repositoryName: 'org/repo',
  prNumber: 7,
  prTitle: 'Title',
  prState: 'OPEN',
  baseRef: 'main',
  headRef: 'feature',
  baseSha: 'b',
  headSha: 'h',
  draft: false,
  actorLogin: 'octocat',
  status: 'PROCESSING',
  current: true,
  attemptCount: 1,
  actionRequiredCount: 0,
  generatedTestsCount: 0,
  indexMode: 'FULL',
  changesetBaseSha: 'b',
  changesetHeadSha: 'h',
  indexDeltaBaseSha: null,
  functionalBehaviorValidated: false,
  resultSummary: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:01.000Z'),
  completedAt: null,
  pullRequestCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
  repositoryBindingEligible: true,
} as unknown as AnalysisRun;

const symbols = [
  { language: 'typescript', kind: 'function', qualifiedName: 'a.b', filePath: 'src/a.ts', changeKind: 'MODIFIED' },
] as unknown as AnalysisSymbol[];

function setup(overrides: { hasSubscribers?: boolean; found?: AnalysisRun | null; findError?: Error; publishError?: Error } = {}) {
  const publisher = {
    hasSubscribers: vi.fn().mockReturnValue(overrides.hasSubscribers ?? true),
    publish: vi.fn().mockImplementation(() => {
      if (overrides.publishError) throw overrides.publishError;
    }),
  };
  const analysisRunsRepository = {
    findById: overrides.findError
      ? vi.fn().mockRejectedValue(overrides.findError)
      : vi.fn().mockResolvedValue(overrides.found === undefined ? run : overrides.found),
  };
  const symbolsRepository = { findByAnalysisRun: vi.fn().mockResolvedValue(symbols) };
  const events = new AnalysisRunRealtimeEvents(publisher as never, analysisRunsRepository as never, symbolsRepository as never);
  return { events, publisher, analysisRunsRepository, symbolsRepository };
}

describe('AnalysisRunRealtimeEvents (WI-CORE-074, analysis-run:update)', () => {
  it('publishes the GET detail DTO to the room of that Run only', async () => {
    const { events, publisher } = setup();

    await events.runChanged('run-1');

    expect(publisher.hasSubscribers).toHaveBeenCalledWith('analysis-run:run-1');
    expect(publisher.publish).toHaveBeenCalledWith(
      'analysis-run:run-1',
      'analysis-run:update',
      toAnalysisRunDetailResponse(run, symbols),
    );
  });

  it('does no database work when nobody is subscribed to the Run', async () => {
    const { events, publisher, analysisRunsRepository, symbolsRepository } = setup({ hasSubscribers: false });

    await events.runChanged('run-1');

    expect(analysisRunsRepository.findById).not.toHaveBeenCalled();
    expect(symbolsRepository.findByAnalysisRun).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('publishes nothing when the Run no longer resolves', async () => {
    const { events, publisher } = setup({ found: null });

    await events.runChanged('run-1');

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('never throws when the read fails (best-effort, the domain flow is not broken)', async () => {
    const { events, publisher } = setup({ findError: new Error('db down') });

    await expect(events.runChanged('run-1')).resolves.toBeUndefined();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('never throws when the publisher fails', async () => {
    const { events } = setup({ publishError: new Error('socket down') });

    await expect(events.runChanged('run-1')).resolves.toBeUndefined();
  });
});
