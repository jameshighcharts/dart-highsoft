import { NextResponse } from 'next/server';
import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import {
  highdartsErrorStatus,
  isUuid,
  loadHighdarts,
} from '@/lib/highdarts/server';
import { buildStandings } from '@/lib/highdarts/standings';
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;
  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    !('context' in body) ||
    typeof body.context !== 'string' ||
    !('playerIds' in body) ||
    !Array.isArray(body.playerIds) ||
    body.playerIds.length !== 2 ||
    !body.playerIds.every(isUuid) ||
    body.playerIds[0] === body.playerIds[1]
  )
    return NextResponse.json(
      {
        error: 'A qualification tie and two different player IDs are required.',
      },
      { status: 400 },
    );
  try {
    const db = getSupabaseServerClient(),
      snapshot = await loadHighdarts(db);
    const tie = buildStandings(snapshot).ties.find(
      (t) => t.context === body.context,
    );
    if (
      !tie?.ready ||
      !body.playerIds.every((id) => tie.players.some((p) => p.player.id === id))
    )
      return NextResponse.json(
        {
          error:
            'These players do not have a current, completed-group qualification tie.',
        },
        { status: 409 },
      );
    const { data, error } = await db.rpc('create_highdarts_tiebreak_atomic', {
      p_expected: snapshot,
      p_context: tie.context,
      p_office: tie.office,
      p_player_ids: body.playerIds,
    });
    if (error)
      return NextResponse.json(
        { error: error.message },
        { status: highdartsErrorStatus(error.code) },
      );
    return NextResponse.json({ fixtureId: data }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Could not load the qualification tie. Try again.' },
      { status: 500 },
    );
  }
}
