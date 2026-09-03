import { NextResponse } from 'next/server';

import { isGameMode } from '@/lib/games/types';
import { createGameSession, shuffle } from '@/lib/server/createGameSession';
import { loadGameSnapshot } from '@/lib/server/gameThrowLifecycle';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CreateGameBody = {
  mode?: unknown;
  config?: unknown;
  playerIds?: unknown;
  scoliaBoardId?: unknown;
};

export async function POST(request: Request) {
  try {
    let body: CreateGameBody;
    try {
      body = (await request.json()) as CreateGameBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!isGameMode(body.mode)) {
      return NextResponse.json({ error: 'Unknown game mode' }, { status: 400 });
    }
    if (!Array.isArray(body.playerIds) || !body.playerIds.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
      return NextResponse.json({ error: 'playerIds must be a list of player ids' }, { status: 400 });
    }
    let scoliaBoardId: string | null = null;
    if (body.scoliaBoardId !== undefined && body.scoliaBoardId !== null) {
      if (typeof body.scoliaBoardId !== 'string' || !UUID_PATTERN.test(body.scoliaBoardId)) {
        return NextResponse.json({ error: 'scoliaBoardId must be a valid id' }, { status: 400 });
      }
      scoliaBoardId = body.scoliaBoardId;
    }

    const supabase = getSupabaseServerClient();
    const result = await createGameSession(supabase, {
      mode: body.mode,
      config: body.config,
      orderedPlayerIds: shuffle(body.playerIds as string[]),
      scoliaBoardId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const snapshot = await loadGameSnapshot(supabase, result.session.id);
    return NextResponse.json(
      {
        gameId: result.session.id,
        session: result.session,
        players: snapshot?.players ?? [],
        state: snapshot?.state ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/games error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
