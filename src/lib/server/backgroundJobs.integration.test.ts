import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { processBackgroundJob } from './backgroundJobs';

vi.mock('server-only', () => ({}));

describe('background job Slack integration', () => {
  it('cancels a due poll with too few yes votes and completes its job', async () => {
    const job = {
      id: 'job-1',
      job_type: 'slack_dart_poll',
      payload: { pollId: 'poll-1' },
      status: 'dispatching',
      attempts: 1,
      max_attempts: 5,
    };
    const poll = {
      id: 'poll-1',
      team_id: 'team-1',
      channel_id: 'channel-1',
      message_ts: null,
      created_by_slack_user_id: 'user-1',
      scheduled_for: '2026-09-03T08:00:00.000Z',
      time_zone: 'Europe/Oslo',
      status: 'open',
      match_id: null,
      failure_message: null,
    };
    const votes = [{ slack_user_id: 'user-1', display_name: 'James', choice: true }];

    function updateBuilder(target: Record<string, unknown>, patch: Record<string, unknown>) {
      const builder = {
        eq() { return builder; },
        in() {
          Object.assign(target, patch);
          return Promise.resolve({ error: null });
        },
        then(resolve: (value: { error: null }) => void) {
          Object.assign(target, patch);
          resolve({ error: null });
        },
      };
      return builder;
    }

    const supabase = {
      from(table: string) {
        if (table === 'background_jobs') {
          return {
            select() {
              return {
                eq() {
                  return { maybeSingle: async () => ({ data: job, error: null }) };
                },
              };
            },
            update(patch: Record<string, unknown>) {
              return updateBuilder(job, patch);
            },
          };
        }
        if (table === 'slack_dart_polls') {
          return {
            select() {
              return {
                eq() {
                  return { maybeSingle: async () => ({ data: poll, error: null }) };
                },
              };
            },
            update(patch: Record<string, unknown>) {
              return updateBuilder(poll, patch);
            },
          };
        }
        if (table === 'slack_dart_votes') {
          return {
            select() {
              return {
                eq() {
                  return { order: async () => ({ data: votes, error: null }) };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;

    await expect(processBackgroundJob({
      supabase,
      jobId: job.id,
      appOrigin: 'https://darts.example',
    })).resolves.toEqual({ id: 'job-1', status: 'completed' });

    expect(poll.status).toBe('cancelled');
    expect(job.status).toBe('completed');
  });
});
