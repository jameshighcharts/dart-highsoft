import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

vi.mock('server-only', () => ({}));

const processBackgroundJobMock = vi.fn();
vi.mock('@/lib/server/backgroundJobs', () => ({
  processBackgroundJob: (...args: unknown[]) => processBackgroundJobMock(...args),
}));
vi.mock('@/lib/supabaseServer', () => ({
  getSupabaseServerClient: () => ({ kind: 'supabase' }),
}));

describe('POST /api/background-jobs', () => {
  beforeEach(() => {
    vi.stubEnv('BACKGROUND_JOB_SECRET', 'test-dispatch-secret');
    processBackgroundJobMock.mockResolvedValue({ id: 'job-1', status: 'completed' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('rejects requests that do not carry the dispatch secret', async () => {
    const response = await POST(new NextRequest('https://darts.example/api/background-jobs', {
      method: 'POST',
      body: JSON.stringify({ jobIds: ['job-1'] }),
    }));

    expect(response.status).toBe(401);
    expect(processBackgroundJobMock).not.toHaveBeenCalled();
  });

  it('deduplicates a valid batch and dispatches each job', async () => {
    processBackgroundJobMock
      .mockResolvedValueOnce({ id: 'job-1', status: 'completed' })
      .mockResolvedValueOnce({ id: 'job-2', status: 'skipped' });
    const response = await POST(new NextRequest('https://darts.example/api/background-jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-dispatch-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jobIds: ['job-1', 'job-1', 'job-2'] }),
    }));

    expect(response.status).toBe(200);
    expect(processBackgroundJobMock).toHaveBeenCalledTimes(2);
    expect(processBackgroundJobMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      jobId: 'job-1',
      appOrigin: 'https://darts.example',
    }));
    expect(processBackgroundJobMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      jobId: 'job-2',
    }));
  });

  it('rejects an empty job batch', async () => {
    const response = await POST(new NextRequest('https://darts.example/api/background-jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-dispatch-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jobIds: [] }),
    }));

    expect(response.status).toBe(400);
    expect(processBackgroundJobMock).not.toHaveBeenCalled();
  });
});
