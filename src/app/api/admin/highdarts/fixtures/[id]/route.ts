import { NextResponse } from 'next/server';
import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { highdartsErrorStatus, isUuid } from '@/lib/highdarts/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  if (
    !isUuid(id) ||
    !body ||
    typeof body !== 'object' ||
    !('side' in body) ||
    (body.side !== 'a' && body.side !== 'b') ||
    !('playerId' in body) ||
    !isUuid(body.playerId)
  )
    return NextResponse.json(
      { error: 'Valid side and playerId required' },
      { status: 400 },
    );
  const db = getSupabaseServerClient();
  const { error } = await db.rpc('map_highdarts_player_atomic', {
    p_fixture_id: id,
    p_side: body.side,
    p_player_id: body.playerId,
  });
  if (error)
    return NextResponse.json(
      { error: error.message },
      { status: highdartsErrorStatus(error.code) },
    );
  return NextResponse.json({ ok: true });
}
