import { NextRequest, NextResponse } from 'next/server';

import { readSharedData } from '@/lib/shared/sharedData';

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  let body: string | null;
  try {
    body = await readSharedData(name, request.nextUrl.searchParams);
  } catch (error) {
    console.error(`Could not load shared data ${name}:`, error);
    return NextResponse.json({ error: 'Could not load the data' }, { status: 502 });
  }
  if (body === null) return NextResponse.json({ error: 'Unknown data' }, { status: 404 });
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json',
      // Cached on the server for everyone; the browser keeps its own copy in the query cache.
      'Cache-Control': 'private, no-store',
    },
  });
}
