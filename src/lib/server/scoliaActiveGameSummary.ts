import type { SupabaseClient } from '@supabase/supabase-js';

import { GAME_MODE_INFO } from '@/lib/games/labels';
import type { GameMode } from '@/lib/games/types';
import type { ScoliaBoardOccupant } from '@/lib/scolia/types';

type PlayerRef = { display_name: string } | { display_name: string }[] | null;

function playerName(ref: PlayerRef): string | null {
  if (!ref) return null;
  const row = Array.isArray(ref) ? ref[0] : ref;
  return row?.display_name ?? null;
}

function latest(dates: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const value of dates) {
    if (value && (!best || value > best)) best = value;
  }
  return best;
}

/** Builds a short summary for each active match, keyed by match id. */
export async function summarizeActiveMatches(
  supabase: SupabaseClient,
  matchIds: string[]
): Promise<Map<string, ScoliaBoardOccupant>> {
  const result = new Map<string, ScoliaBoardOccupant>();
  if (matchIds.length === 0) return result;

  const [matches, legs] = await Promise.all([
    supabase
      .from('matches')
      .select('id, start_score, legs_to_win, created_at, match_players(play_order, player:players(display_name))')
      .in('id', matchIds),
    supabase.from('legs').select('id, match_id, created_at').in('match_id', matchIds),
  ]);
  if (matches.error) throw new Error(matches.error.message);
  if (legs.error) throw new Error(legs.error.message);

  const legRows = (legs.data ?? []) as { id: string; match_id: string; created_at: string }[];
  const legIds = legRows.map((leg) => leg.id);
  const turns = legIds.length
    ? await supabase.from('turns').select('leg_id, created_at').in('leg_id', legIds)
    : { data: [], error: null };
  if (turns.error) throw new Error(turns.error.message);
  const turnRows = (turns.data ?? []) as { leg_id: string; created_at: string }[];

  type MatchRow = {
    id: string;
    start_score: number;
    legs_to_win: number;
    created_at: string;
    match_players: { play_order: number; player: PlayerRef }[] | null;
  };
  for (const match of (matches.data ?? []) as MatchRow[]) {
    const matchLegs = legRows.filter((leg) => leg.match_id === match.id);
    const matchLegIds = new Set(matchLegs.map((leg) => leg.id));
    const matchTurns = turnRows.filter((turn) => matchLegIds.has(turn.leg_id));
    const players = [...(match.match_players ?? [])]
      .sort((a, b) => a.play_order - b.play_order)
      .map((mp) => playerName(mp.player))
      .filter((name): name is string => Boolean(name));
    result.set(match.id, {
      kind: 'match',
      id: match.id,
      label: `${match.start_score} · first to ${match.legs_to_win} ${match.legs_to_win === 1 ? 'leg' : 'legs'}`,
      players,
      startedAt: match.created_at,
      lastActivityAt: latest([
        ...matchTurns.map((turn) => turn.created_at),
        ...matchLegs.map((leg) => leg.created_at),
      ]),
      legsPlayed: matchLegs.length,
      turnsTaken: matchTurns.length,
    });
  }
  return result;
}

/** Builds a short summary for each active game session, keyed by session id. */
export async function summarizeActiveGameSessions(
  supabase: SupabaseClient,
  sessionIds: string[]
): Promise<Map<string, ScoliaBoardOccupant>> {
  const result = new Map<string, ScoliaBoardOccupant>();
  if (sessionIds.length === 0) return result;

  const [sessions, throws] = await Promise.all([
    supabase
      .from('game_sessions')
      .select('id, mode, created_at, game_session_players(play_order, player:players(display_name))')
      .in('id', sessionIds),
    supabase.from('game_throws').select('session_id, created_at').in('session_id', sessionIds),
  ]);
  if (sessions.error) throw new Error(sessions.error.message);
  if (throws.error) throw new Error(throws.error.message);
  const throwRows = (throws.data ?? []) as { session_id: string; created_at: string }[];

  type SessionRow = {
    id: string;
    mode: string;
    created_at: string;
    game_session_players: { play_order: number; player: PlayerRef }[] | null;
  };
  for (const session of (sessions.data ?? []) as SessionRow[]) {
    const sessionThrows = throwRows.filter((row) => row.session_id === session.id);
    const players = [...(session.game_session_players ?? [])]
      .sort((a, b) => a.play_order - b.play_order)
      .map((gp) => playerName(gp.player))
      .filter((name): name is string => Boolean(name));
    result.set(session.id, {
      kind: 'game',
      id: session.id,
      label: GAME_MODE_INFO[session.mode as GameMode]?.name ?? session.mode,
      players,
      startedAt: session.created_at,
      lastActivityAt: latest(sessionThrows.map((row) => row.created_at)),
      legsPlayed: null,
      turnsTaken: sessionThrows.length,
    });
  }
  return result;
}
