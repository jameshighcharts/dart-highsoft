import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { finalizeSlackDartPollById } from '@/lib/slack/dartPollService';

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
    default:
      throw new PermanentJobError(`Unsupported background job type: ${job.job_type}`);
  }
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
