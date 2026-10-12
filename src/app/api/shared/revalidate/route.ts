import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { SHARED_DATA_TAG } from '@/lib/shared/tag';

/**
 * Expires the shared data right away, for a viewer who just finished a game: the next request
 * recomputes instead of being served the copy from before it.
 */
export async function POST() {
  revalidateTag(SHARED_DATA_TAG, { expire: 0 });
  return new NextResponse(null, { status: 204 });
}
