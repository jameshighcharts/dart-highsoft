import { NextResponse } from 'next/server';

import { isGuardResponse, requireUser } from '@/lib/auth/requireAdmin';
import { findLinkedPlayer } from '@/lib/server/myPlayer';
import { AvatarError, clearPlayerAvatar, readAvatarUpload, setPlayerAvatar } from '@/lib/server/playerAvatar';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof AvatarError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function POST(request: Request) {
  const guard = await requireUser();
  if (isGuardResponse(guard)) return guard;
  try {
    const supabase = getSupabaseServerClient();
    const player = await findLinkedPlayer(supabase, guard.user.slackTeamId, guard.user.slackUserId);
    if (!player) return NextResponse.json({ error: 'No player linked to your account' }, { status: 404 });
    const { bytes, contentType } = await readAvatarUpload(request);
    const avatarUrl = await setPlayerAvatar(supabase, player.id, bytes, contentType);
    return NextResponse.json({ playerId: player.id, avatarUrl });
  } catch (error) {
    return errorResponse(error, 'Failed to upload avatar');
  }
}

export async function DELETE() {
  const guard = await requireUser();
  if (isGuardResponse(guard)) return guard;
  try {
    const supabase = getSupabaseServerClient();
    const player = await findLinkedPlayer(supabase, guard.user.slackTeamId, guard.user.slackUserId);
    if (!player) return NextResponse.json({ error: 'No player linked to your account' }, { status: 404 });
    await clearPlayerAvatar(supabase, player.id);
    return NextResponse.json({ playerId: player.id, avatarUrl: null });
  } catch (error) {
    return errorResponse(error, 'Failed to remove avatar');
  }
}
