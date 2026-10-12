import { NextRequest, NextResponse } from 'next/server';

import { LOAD_FAILED_HEADER } from '@/lib/shared/fetchShared';
import { readSharedData } from '@/lib/shared/sharedData';

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
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
      'Server-Timing': `shared;desc="${result.computed ? 'computed' : 'cached'}";dur=${duration}`,
    },
  });
}
