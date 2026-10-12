import { NextRequest, NextResponse } from 'next/server';

import { getAuthenticatedSession } from '@/auth';
import { isAuthPerformanceBypassEnabled } from '@/lib/auth/devBypass';
import { LOAD_FAILED_HEADER } from '@/lib/shared/fetchShared';
import { readSharedData } from '@/lib/shared/sharedData';

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  // The proxy skips these routes (src/proxy.ts), so the same sign-in check happens here.
  const authStarted = performance.now();
  const signedIn = isAuthPerformanceBypassEnabled(request) || (await getAuthenticatedSession()) !== null;
  const authDuration = (performance.now() - authStarted).toFixed(1);
  if (!signedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = await params;
  const started = performance.now();
  let result: Awaited<ReturnType<typeof readSharedData>>;
  try {
    result = await readSharedData(name, request.nextUrl.searchParams);
  } catch (error) {
    console.error(`Could not load shared data ${name}:`, error);
    // The database failed: the browser would get the same failure, so it should not retry itself.
    return NextResponse.json({ error: 'Could not load the data' }, { status: 502, headers: { [LOAD_FAILED_HEADER]: '1' } });
  }
  if (result === null) return NextResponse.json({ error: 'Unknown data' }, { status: 404 });
  const duration = (performance.now() - started).toFixed(1);
  return new NextResponse(result.body, {
    headers: {
      'Content-Type': 'application/json',
      // Cached on the server for everyone; the browser keeps its own copy in the query cache.
      'Cache-Control': 'private, no-store',
      // Shown in the browser's network timing: whether the cache answered, and how long it took.
      'Server-Timing': `auth;dur=${authDuration}, shared;desc="${result.computed ? 'computed' : 'cached'}";dur=${duration}`,
    },
  });
}
