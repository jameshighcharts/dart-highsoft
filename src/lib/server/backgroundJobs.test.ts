import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { finalizeSlackDartPollById } from '@/lib/slack/dartPollService';
import {
  persistDartIQCompletedLeg,
  persistDartIQLiveReplay,
  persistDartIQLiveThrow,
} from './dartiqTelemetry';

import { processBackgroundJob } from './backgroundJobs';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/slack/dartPollService', () => ({
  finalizeSlackDartPollById: vi.fn(),
}));
vi.mock('./dartiqTelemetry', () => ({
  persistDartIQCompletedLeg: vi.fn(),
  persistDartIQLiveReplay: vi.fn(),
  persistDartIQLiveThrow: vi.fn(),
  supersedeDartIQLiveThrow: vi.fn(),
}));

type JobFixture = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'dispatching' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
};

function createSupabase(job: JobFixture | null) {
  const updates: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      if (table !== 'background_jobs') throw new Error(`Unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: job, error: null };
                },
              };
            },
          };
        },
        update(value: Record<string, unknown>) {
          updates.push(value);
          return {
            eq() {
              return {
                async eq() {
                  return { error: null };
                },
                then(resolve: (value: { error: null }) => void) {
                  resolve({ error: null });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { supabase, updates };
}

const dispatchingJob: JobFixture = {
  id: 'job-1',
  job_type: 'slack_dart_poll',
  payload: { pollId: 'poll-1' },
  status: 'dispatching',
  attempts: 1,
  max_attempts: 5,
};

describe('processBackgroundJob', () => {
  beforeEach(() => {
    vi.mocked(finalizeSlackDartPollById).mockReset();
    vi.mocked(persistDartIQCompletedLeg).mockReset();
    vi.mocked(persistDartIQLiveReplay).mockReset();
    vi.mocked(persistDartIQLiveThrow).mockReset();
  });

  it('processes DartIQ capture outside the scoring request', async () => {
    const job = {
      ...dispatchingJob,
      job_type: 'dartiq_live_throw',
      payload: { matchId: 'match-1', throwId: 'throw-1' },
    };
    const test = createSupabase(job);

    await expect(processBackgroundJob({
      supabase: test.supabase,
      jobId: job.id,
      appOrigin: 'https://darts.example',
    })).resolves.toEqual({ id: 'job-1', status: 'completed' });

    expect(persistDartIQLiveThrow).toHaveBeenCalledWith(
      test.supabase,
      'match-1',
      'throw-1'
    );
  });

  it('scopes a correction replay to the affected leg', async () => {
    const job = {
      ...dispatchingJob,
      job_type: 'dartiq_live_replay',
      payload: { matchId: 'match-1', legId: 'leg-2' },
    };
    const test = createSupabase(job);

    await processBackgroundJob({
      supabase: test.supabase,
      jobId: job.id,
      appOrigin: 'https://darts.example',
    });

    expect(persistDartIQLiveReplay).toHaveBeenCalledWith(
      test.supabase,
      'match-1',
      'leg-2'
    );
  });

  it('runs the typed handler and marks a dispatched job completed', async () => {
    const test = createSupabase(dispatchingJob);

    await expect(processBackgroundJob({
      supabase: test.supabase,
      jobId: dispatchingJob.id,
      appOrigin: 'https://darts.example',
    })).resolves.toEqual({ id: 'job-1', status: 'completed' });

    expect(finalizeSlackDartPollById).toHaveBeenCalledWith({
      supabase: test.supabase,
      pollId: 'poll-1',
      appOrigin: 'https://darts.example',
    });
    expect(test.updates).toContainEqual(expect.objectContaining({ status: 'completed' }));
  });

  it('returns a failed handler to the queue for retry', async () => {
    vi.mocked(finalizeSlackDartPollById).mockRejectedValueOnce(new Error('Slack unavailable'));
    const test = createSupabase(dispatchingJob);

    await expect(processBackgroundJob({
      supabase: test.supabase,
      jobId: dispatchingJob.id,
      appOrigin: 'https://darts.example',
    })).resolves.toEqual({
      id: 'job-1',
      status: 'retrying',
      error: 'Slack unavailable',
    });
    expect(test.updates).toContainEqual(expect.objectContaining({
      status: 'pending',
      last_error: 'Slack unavailable',
    }));
  });

  it('permanently fails an unsupported job type', async () => {
    const test = createSupabase({ ...dispatchingJob, job_type: 'unknown_job' });

    await expect(processBackgroundJob({
      supabase: test.supabase,
      jobId: dispatchingJob.id,
      appOrigin: 'https://darts.example',
    })).resolves.toEqual({
      id: 'job-1',
      status: 'failed',
      error: 'Unsupported background job type: unknown_job',
    });
    expect(test.updates).toContainEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('does not run a job that was not claimed by the scheduler', async () => {
    const test = createSupabase({ ...dispatchingJob, status: 'pending' });

    await expect(processBackgroundJob({
      supabase: test.supabase,
      jobId: dispatchingJob.id,
      appOrigin: 'https://darts.example',
    })).resolves.toEqual({ id: 'job-1', status: 'skipped' });
    expect(finalizeSlackDartPollById).not.toHaveBeenCalled();
    expect(test.updates).toEqual([]);
  });
});
