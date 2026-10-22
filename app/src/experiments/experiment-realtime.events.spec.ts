import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS, ExperimentRealtimeEvents } from './experiment-realtime.events.js';
import { toExperimentStatusResponse } from './experiment-status.presenter.js';

const run = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'exp-1',
    projectId: 'project-1',
    projectVersionId: 'version-1',
    targetId: 'target-1',
    status: 'RUNNING',
    completedRepetitions: 0,
    totalRepetitions: 6,
    failureCode: null,
    failureMessage: null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: null,
    modelConfig: { provider: 'OPENAI', model: 'm', modelVersion: null, reasoningEffort: null, temperature: 0, maxOutputTokens: 100 },
    budget: { toolCallCap: 20, contextTokenBudget: 8000, maxDurationMs: 60000 },
    executionProfile: 'NODE',
    runnerHint: 'VITEST',
    randomizationSeed: 'seed',
    ...overrides,
  }) as never;

function setup(options: { hasSubscribers?: boolean; findError?: Error } = {}) {
  let current = run();
  const publisher = {
    hasSubscribers: vi.fn().mockReturnValue(options.hasSubscribers ?? true),
    publish: vi.fn(),
  };
  const experimentRunsRepository = {
    findById: options.findError
      ? vi.fn().mockRejectedValue(options.findError)
      : vi.fn().mockImplementation(async () => current),
  };
  const events = new ExperimentRealtimeEvents(publisher as never, experimentRunsRepository as never);
  return {
    events,
    publisher,
    experimentRunsRepository,
    setCurrent: (next: unknown) => (current = next as never),
  };
}

const progressPublications = (publisher: { publish: ReturnType<typeof vi.fn> }) => publisher.publish.mock.calls.length;

describe('intervalo de progreso (D4 / INTEROP-2.18 §6.6)', () => {
  it('es 1500 ms', () => {
    expect(EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS).toBe(1500);
  });
});

describe('ExperimentRealtimeEvents (WI-CORE-074, experiment:update)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes the GET status DTO on a status change, to the room of that experiment', async () => {
    const { events, publisher } = setup();

    await events.statusChanged('exp-1');

    expect(publisher.publish).toHaveBeenCalledWith('experiment:exp-1', 'experiment:update', toExperimentStatusResponse(run()));
  });

  it('the payload carries exactly the fields of the HTTP status DTO (no data outside the contract)', async () => {
    const { events, publisher } = setup();

    await events.statusChanged('exp-1');

    const payload = publisher.publish.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(Object.keys(toExperimentStatusResponse(run())).sort());
  });

  it('does no work without subscribers, for status and progress alike', async () => {
    const { events, publisher, experimentRunsRepository } = setup({ hasSubscribers: false });

    await events.statusChanged('exp-1');
    await events.progressChanged('exp-1');
    vi.advanceTimersByTime(EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS * 3);

    expect(experimentRunsRepository.findById).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('a progress burst emits at most once per interval and the last progress is emitted at the window end (trailing)', async () => {
    const { events, publisher, setCurrent } = setup();

    setCurrent(run({ completedRepetitions: 1 }));
    await events.progressChanged('exp-1');
    expect(progressPublications(publisher)).toBe(1);

    setCurrent(run({ completedRepetitions: 2 }));
    await events.progressChanged('exp-1');
    setCurrent(run({ completedRepetitions: 3 }));
    await events.progressChanged('exp-1');
    expect(progressPublications(publisher)).toBe(1);

    await vi.advanceTimersByTimeAsync(EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS);

    expect(progressPublications(publisher)).toBe(2);
    expect(publisher.publish).toHaveBeenLastCalledWith('experiment:exp-1', 'experiment:update', toExperimentStatusResponse(run({ completedRepetitions: 3 })));
  });

  it('progress after the window is emitted immediately again', async () => {
    const { events, publisher } = setup();

    await events.progressChanged('exp-1');
    await vi.advanceTimersByTimeAsync(EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS + 1);
    await events.progressChanged('exp-1');

    expect(progressPublications(publisher)).toBe(2);
  });

  it('a status change is never throttled and cancels the pending progress of that experiment', async () => {
    const { events, publisher, setCurrent } = setup();

    await events.progressChanged('exp-1');
    setCurrent(run({ completedRepetitions: 2 }));
    await events.progressChanged('exp-1');
    setCurrent(run({ status: 'COMPLETED', completedRepetitions: 6 }));
    await events.statusChanged('exp-1');
    await vi.advanceTimersByTimeAsync(EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS * 2);

    expect(progressPublications(publisher)).toBe(2);
    expect(publisher.publish).toHaveBeenLastCalledWith('experiment:exp-1', 'experiment:update', toExperimentStatusResponse(run({ status: 'COMPLETED', completedRepetitions: 6 })));
  });

  it('never throws when the read or the publish fails (best-effort)', async () => {
    const failing = setup({ findError: new Error('db down') });
    await expect(failing.events.statusChanged('exp-1')).resolves.toBeUndefined();
    await expect(failing.events.progressChanged('exp-1')).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(EXPERIMENT_PROGRESS_EMIT_INTERVAL_MS);

    const { events, publisher } = setup();
    publisher.publish.mockImplementation(() => {
      throw new Error('socket down');
    });
    await expect(events.statusChanged('exp-1')).resolves.toBeUndefined();
  });
});
