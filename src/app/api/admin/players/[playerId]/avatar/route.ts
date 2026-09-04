import { NextResponse } from 'next/server';

import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { AvatarError, clearPlayerAvatar, readAvatarUpload, setPlayerAvatar } from '@/lib/server/playerAvatar';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof AvatarError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** Upload (or replace) a player's profile picture. multipart/form-data with field `file`. */
export async function POST(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;
  const { playerId } = await params;
  if (!UUID_PATTERN.test(playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
  try {
    const { bytes, contentType } = await readAvatarUpload(request);
    const avatarUrl = await setPlayerAvatar(getSupabaseServerClient(), playerId, bytes, contentType);
    return NextResponse.json({ playerId, avatarUrl });
  } catch (error) {
    return errorResponse(error, 'Failed to upload avatar');
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;
  const { playerId } = await params;
  if (!UUID_PATTERN.test(playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });
  try {
    await clearPlayerAvatar(getSupabaseServerClient(), playerId);
    return NextResponse.json({ playerId, avatarUrl: null });
  } catch (error) {
    return errorResponse(error, 'Failed to remove avatar');
  }
}
