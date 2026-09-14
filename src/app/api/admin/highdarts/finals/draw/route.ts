import { NextResponse } from 'next/server';
import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import {
  highdartsErrorStatus,
  isUuid,
  loadHighdarts,
} from '@/lib/highdarts/server';
import { buildStandings } from '@/lib/highdarts/standings';
import { validateDraw, type DrawSelection } from '@/lib/highdarts/finals';
function parseDraw(body: unknown): DrawSelection | null {
  if (
    !body ||
    typeof body !== 'object' ||
    !('byes' in body) ||
    !Array.isArray(body.byes) ||
    body.byes.length !== 4 ||
    !body.byes.every(isUuid) ||
    !('playoffs' in body) ||
    !Array.isArray(body.playoffs) ||
    body.playoffs.length !== 4
  )
    return null;
  const playoffs: [string, string][] = [];
  for (const pair of body.playoffs) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !isUuid(pair[0]) ||
      !isUuid(pair[1])
    )
      return null;
    playoffs.push([pair[0], pair[1]]);
  }
  return { byes: body.byes, playoffs };
}
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;
  const selection = parseDraw(await request.json().catch(() => null));
  if (!selection)
    return NextResponse.json(
      { error: 'Four byes and four UUID pairs are required.' },
      { status: 400 },
    );
  try {
    const db = getSupabaseServerClient(),
      snapshot = await loadHighdarts(db);
    const validated = validateDraw(buildStandings(snapshot), selection);
    if (!validated.ok)
      return NextResponse.json({ error: validated.error }, { status: 409 });
    const { error } = await db.rpc('lock_highdarts_draw_atomic', {
      p_expected: snapshot,
      p_games: validated.games.map((g) => ({
        stage: g.stage,
        position: g.position,
        player_a_id: g.a?.player.id ?? null,
        player_b_id: g.b?.player.id ?? null,
        player_a_name: g.a?.player.display_name ?? 'TBD',
        player_b_name: g.b?.player.display_name ?? 'TBD',
      })),
    });
    if (error)
      return NextResponse.json(
        { error: error.message },
        { status: highdartsErrorStatus(error.code) },
      );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'Could not load the current standings. Try again.' },
      { status: 500 },
    );
  }
}
export async function DELETE() {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;
  const { error } = await getSupabaseServerClient().rpc(
    'unlock_highdarts_draw_atomic',
  );
  if (error)
    return NextResponse.json(
      { error: error.message },
      { status: highdartsErrorStatus(error.code) },
    );
  return NextResponse.json({ ok: true });
}
