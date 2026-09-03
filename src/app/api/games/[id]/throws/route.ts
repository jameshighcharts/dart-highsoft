import { NextResponse } from 'next/server';

import { appendGameThrow, loadGameSnapshot, removeLastGameThrow } from '@/lib/server/gameThrowLifecycle';
import { commandSourceForGameSession, enqueueCurrentRoundScoliaThrowCommand } from '@/lib/server/scoliaCommands';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

type ThrowBody = { segment?: unknown; scored?: unknown; playerId?: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let body: ThrowBody;
    try {
      body = (await request.json()) as ThrowBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof body.segment !== 'string') {
      return NextResponse.json({ error: 'segment is required' }, { status: 400 });
    }
    if (body.scored !== undefined && typeof body.scored !== 'number') {
      return NextResponse.json({ error: 'scored must be a number' }, { status: 400 });
    }
    if (body.playerId !== undefined && typeof body.playerId !== 'string') {
      return NextResponse.json({ error: 'playerId must be a string' }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const snapshot = await loadGameSnapshot(supabase, id);
    if (!snapshot) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    if (snapshot.session.scolia_board_id) {
      return NextResponse.json(
        { error: 'Manual scoring is disabled while a Scolia board is assigned to this game' },
        { status: 409 }
      );
    }

    const result = await appendGameThrow(supabase, snapshot, {
      segment: body.segment,
      scored: body.scored as number | undefined,
      playerId: body.playerId as string | undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ throw: result.throw, state: result.state }, { status: 201 });
  } catch (error) {
    console.error('POST /api/games/[id]/throws error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let throwId: string | undefined;
    try {
      const body = (await request.json()) as { throwId?: unknown };
      if (typeof body.throwId === 'string') throwId = body.throwId;
    } catch {
      // Empty body: undo the latest dart.
    }

    const supabase = getSupabaseServerClient();
    const snapshot = await loadGameSnapshot(supabase, id);
    if (!snapshot) return NextResponse.json({ error: 'Game not found' }, { status: 404 });

    const result = await removeLastGameThrow(supabase, snapshot, throwId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    try {
      await enqueueCurrentRoundScoliaThrowCommand(
        supabase,
        commandSourceForGameSession(snapshot.session),
        { dartIndex: result.deleted.dart_index, scoliaEventId: result.deleted.scolia_event_id },
        'DELETE_THROW'
      );
    } catch (commandError) {
      console.error('Failed to queue Scolia throw deletion:', commandError);
    }
    return NextResponse.json({ ok: true, deletedThrow: result.deleted, state: result.state, reopened: result.reopened });
  } catch (error) {
    console.error('DELETE /api/games/[id]/throws error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
