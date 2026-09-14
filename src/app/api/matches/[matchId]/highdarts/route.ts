import { NextResponse } from 'next/server';
import { highdartsErrorStatus, isUuid } from '@/lib/highdarts/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params;
  const body: unknown = await request.json().catch(() => null);
  if (
    !isUuid(matchId) ||
    !body ||
    typeof body !== 'object' ||
    !('fixtureId' in body) ||
    !isUuid(body.fixtureId)
  ) {
    return NextResponse.json(
      { error: 'A valid fixtureId and matchId are required' },
      { status: 400 },
    );
  }
  const { error } = await getSupabaseServerClient().rpc(
    'link_highdarts_match_atomic',
    { p_match_id: matchId, p_fixture_id: body.fixtureId },
  );
  if (error)
    return NextResponse.json(
      { error: error.message },
      { status: highdartsErrorStatus(error.code) },
    );
  return NextResponse.json({ ok: true });
}
