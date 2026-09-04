import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { finalizeSlackDartPollById } from '@/lib/slack/dartPollService';
import {
  persistDartIQCompletedLeg,
  persistDartIQLiveReplay,
  persistDartIQLiveThrow,
  supersedeDartIQLiveThrow,
} from './dartiqTelemetry';

type BackgroundJobStatus = 'pending' | 'dispatching' | 'completed' | 'failed';

type BackgroundJobRow = {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: BackgroundJobStatus;
  attempts: number;
  max_attempts: number;
};

export type BackgroundJobResult = {
  id: string;
  status: 'completed' | 'retrying' | 'failed' | 'skipped';
  error?: string;
};

class PermanentJobError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBackgroundJob(value: unknown): BackgroundJobRow {
  if (!isRecord(value)) throw new PermanentJobError('Background job row is invalid');
  const status = value.status;
  if (
    typeof value.id !== 'string' ||
    typeof value.job_type !== 'string' ||
    !isRecord(value.payload) ||
    (status !== 'pending' && status !== 'dispatching' && status !== 'completed' && status !== 'failed') ||
    typeof value.attempts !== 'number' ||
    typeof value.max_attempts !== 'number'
  ) {
    throw new PermanentJobError('Background job row is invalid');
  }
  return {
    id: value.id,
    job_type: value.job_type,
    payload: value.payload,
    status,
    attempts: value.attempts,
    max_attempts: value.max_attempts,
  };
}

function slackDartPollId(payload: Record<string, unknown>): string {
  const pollId = payload.pollId;
  if (typeof pollId !== 'string' || pollId.length === 0) {
    throw new PermanentJobError('slack_dart_poll requires payload.pollId');
  }
  return pollId;
}

function requiredPayloadId(payload: Record<string, unknown>, key: string, jobType: string) {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PermanentJobError(`${jobType} requires payload.${key}`);
  }
  return value;
}

async function runJob(
  supabase: SupabaseClient,
  job: BackgroundJobRow,
  appOrigin: string,
): Promise<void> {
  switch (job.job_type) {
    case 'slack_dart_poll':
      await finalizeSlackDartPollById({
        supabase,
        pollId: slackDartPollId(job.payload),
        appOrigin,
      });
      return;
    case 'dartiq_live_throw':
      await persistDartIQLiveThrow(
        supabase,
        requiredPayloadId(job.payload, 'matchId', job.job_type),
        requiredPayloadId(job.payload, 'throwId', job.job_type)
      );
      return;
    case 'dartiq_live_replay': {
      const matchId = requiredPayloadId(job.payload, 'matchId', job.job_type);
      const supersedeThrowId = job.payload.supersedeThrowId;
      if (supersedeThrowId != null && typeof supersedeThrowId !== 'string') {
        throw new PermanentJobError('dartiq_live_replay payload.supersedeThrowId must be a string');
      }
      if (supersedeThrowId) {
        await supersedeDartIQLiveThrow(supabase, matchId, supersedeThrowId);
      }
      await persistDartIQLiveReplay(
        supabase,
        matchId,
        requiredPayloadId(job.payload, 'legId', job.job_type)
      );
      return;
    }
    case 'dartiq_completed_leg':
      await persistDartIQCompletedLeg(
        supabase,
        requiredPayloadId(job.payload, 'matchId', job.job_type),
        requiredPayloadId(job.payload, 'legId', job.job_type)
      );
      return;
    default:
      throw new PermanentJobError(`Unsupported background job type: ${job.job_type}`);
  }
}

async function enqueueDartIQJob(
  supabase: SupabaseClient,
  input: {
    jobType: 'dartiq_live_throw' | 'dartiq_live_replay' | 'dartiq_completed_leg';
    payload: Record<string, string>;
    deduplicationKey?: string;
  }
) {
  const { error } = await supabase.from('background_jobs').insert({
    job_type: input.jobType,
    payload: input.payload,
    run_at: new Date().toISOString(),
    deduplication_key: input.deduplicationKey ?? null,
  });
  if (error && error.code !== '23505') throw new Error(error.message);
}

export function enqueueDartIQLiveThrow(
  supabase: SupabaseClient,
  matchId: string,
  throwId: string
) {
  return enqueueDartIQJob(supabase, {
    jobType: 'dartiq_live_throw',
    payload: { matchId, throwId },
    deduplicationKey: `dartiq_live_throw:${throwId}`,
  });
}

export function enqueueDartIQLiveReplay(
  supabase: SupabaseClient,
  matchId: string,
  legId: string,
  supersedeThrowId?: string
) {
  return enqueueDartIQJob(supabase, {
    jobType: 'dartiq_live_replay',
    payload: {
      matchId,
      legId,
      ...(supersedeThrowId ? { supersedeThrowId } : {}),
    },
  });
}

export function enqueueDartIQCompletedLeg(
  supabase: SupabaseClient,
  matchId: string,
  legId: string
) {
  return enqueueDartIQJob(supabase, {
    jobType: 'dartiq_completed_leg',
    payload: { matchId, legId },
    deduplicationKey: `dartiq_completed_leg:${legId}`,
  });
}

async function recordJobFailure(
  supabase: SupabaseClient,
  job: BackgroundJobRow,
  error: unknown,
): Promise<BackgroundJobResult> {
  const message = error instanceof Error ? error.message : 'Unknown background job failure';
  const permanentlyFailed = error instanceof PermanentJobError || job.attempts >= job.max_attempts;
  const retryAt = new Date(Date.now() + 15_000).toISOString();
  const failurePatch = permanentlyFailed
    ? {
        status: 'failed' as const,
        locked_at: null,
        last_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      }
    : {
        status: 'pending' as const,
        run_at: retryAt,
        locked_at: null,
        last_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      };
  const { error: updateError } = await supabase
    .from('background_jobs')
    .update(failurePatch)
    .eq('id', job.id)
    .eq('status', 'dispatching');
  if (updateError) throw new Error(`${message}; could not record job failure: ${updateError.message}`);
  return {
    id: job.id,
    status: permanentlyFailed ? 'failed' : 'retrying',
    error: message,
  };
}

export async function processBackgroundJob(options: {
  supabase: SupabaseClient;
  jobId: string;
  appOrigin: string;
}): Promise<BackgroundJobResult> {
  const { data, error } = await options.supabase
    .from('background_jobs')
    .select('id, job_type, payload, status, attempts, max_attempts')
    .eq('id', options.jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { id: options.jobId, status: 'skipped', error: 'Job does not exist' };

  let job: BackgroundJobRow;
  try {
    job = parseBackgroundJob(data);
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : 'Background job row is invalid';
    const { error: updateError } = await options.supabase
      .from('background_jobs')
      .update({
        status: 'failed',
        locked_at: null,
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', options.jobId);
    if (updateError) throw new Error(`${message}; could not mark invalid job failed: ${updateError.message}`);
    return { id: options.jobId, status: 'failed', error: message };
  }
  if (job.status !== 'dispatching') return { id: job.id, status: 'skipped' };

  try {
    await runJob(options.supabase, job, options.appOrigin);
    const { error: updateError } = await options.supabase
      .from('background_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        locked_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'dispatching');
    if (updateError) throw new Error(updateError.message);
    return { id: job.id, status: 'completed' };
  } catch (jobError) {
    console.error(`Background job ${job.id} failed:`, jobError);
    return recordJobFailure(options.supabase, job, jobError);
  }
}
