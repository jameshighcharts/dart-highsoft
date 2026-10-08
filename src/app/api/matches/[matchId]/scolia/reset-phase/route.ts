import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { checkScoliaPhaseReset } from '@/lib/server/scoliaPhaseReset';
import { isUuid } from '@/lib/commentary/realtimeTypes';

type Context = { params: Promise<{ matchId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  if (request.headers.get('origin') && request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  const { matchId } = await params;
  if (!isUuid(matchId)) return NextResponse.json({ error: 'Invalid match' }, { status: 400 });
  try {
    const body = await request.json().catch(() => null) as { manual?: unknown } | null;
    const db = getSupabaseServerClient();
    const checked = await checkScoliaPhaseReset(db, matchId, { manual: body?.manual === true });
    if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 409 });
    const pending = await db.from('scolia_commands').select('id').eq('match_id', matchId)
      .eq('board_id', checked.boardId).eq('command_type', 'RESET_PHASE').in('status', ['pending', 'sent']).limit(1).maybeSingle();
    if (pending.error) throw new Error(pending.error.message);
    if (pending.data) return NextResponse.json({ commandId: pending.data.id }, { status: 202 });
    const result = await db.from('scolia_commands').insert({ board_id: checked.boardId, match_id: matchId,
      command_type: 'RESET_PHASE', payload: {} }).select('id').single();
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ commandId: result.data.id }, { status: 202 });
  } catch (error) {
    console.error('Scolia phase reset failed', error);
    return NextResponse.json({ error: 'Could not request a board reset.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: Context) {
  const { matchId } = await params;
  const commandId = request.nextUrl.searchParams.get('commandId');
  if (!isUuid(matchId) || !commandId || !isUuid(commandId)) return NextResponse.json({ error: 'Invalid reset request' }, { status: 400 });
  const db = getSupabaseServerClient();
  const result = await db.from('scolia_commands').select('status, last_error, scolia_boards(board_phase)')
    .eq('id', commandId).eq('match_id', matchId).eq('command_type', 'RESET_PHASE').maybeSingle();
  if (result.error) return NextResponse.json({ error: 'Could not check board reset.' }, { status: 500 });
  if (!result.data) return NextResponse.json({ error: 'Reset request not found.' }, { status: 404 });
  const board = result.data.scolia_boards as unknown as { board_phase: string | null } | null;
  return NextResponse.json({ status: result.data.status, error: result.data.last_error, phase: board?.board_phase },
    { headers: { 'Cache-Control': 'no-store' } });
}
