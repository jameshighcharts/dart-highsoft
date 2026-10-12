import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { processBackgroundJob, type BackgroundJobServerHooks } from '@/lib/server/backgroundJobs';
import { DartIQTelemetryBatch } from '@/lib/server/dartiqTelemetry';
import { SHARED_DATA_TAG } from '@/lib/shared/tag';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

const hooks: BackgroundJobServerHooks = {
  // Stale: viewers keep getting the previous copy while the first request after a change
  // recomputes it. Purged (a leg or game result): the next request waits for the new copy.
  revalidateSharedData: ({ purge }) => revalidateTag(SHARED_DATA_TAG, purge ? { expire: 0 } : 'max'),
};

type DispatchBody = { jobIds: string[] };

function parseDispatchBody(value: unknown): DispatchBody | null {
  if (typeof value !== 'object' || value === null || !('jobIds' in value)) return null;
  const jobIds = value.jobIds;
  if (!Array.isArray(jobIds) || jobIds.length === 0 || jobIds.length > 50) return null;
  if (!jobIds.every((jobId) => typeof jobId === 'string' && jobId.length > 0)) return null;
  return { jobIds: [...new Set(jobIds)] };
}

export async function POST(request: NextRequest) {
  const dispatchSecret = process.env.BACKGROUND_JOB_SECRET?.trim();
  if (!dispatchSecret || request.headers.get('authorization') !== `Bearer ${dispatchSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let body: DispatchBody | null = null;
  try {
    body = parseDispatchBody(await request.json());
  } catch {
    // The response below covers malformed JSON and malformed payloads uniformly.
  }
  if (!body) return NextResponse.json({ error: 'Invalid job dispatch payload' }, { status: 400 });

  const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, '');
  const supabase = getSupabaseServerClient();
  const results = [];
  const batch = new DartIQTelemetryBatch();
  for (const jobId of body.jobIds) {
    try {
      results.push(await processBackgroundJob({ supabase, jobId, appOrigin, batch, hooks }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown dispatch failure';
      console.error(`Could not process background job ${jobId}:`, error);
      results.push({ id: jobId, status: 'retrying' as const, error: message });
    }
  }

  const hasRetry = results.some((result) => result.status === 'retrying');
  return NextResponse.json({ results }, { status: hasRetry ? 500 : 200 });
}
