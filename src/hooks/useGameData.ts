'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/supabaseClient';
import type { GameMode, GameSessionStatus, GameThrowInput } from '@/lib/games/types';

// Client-side mirrors of the server row types (src/lib/server/*), kept local so
// the client bundle never imports server modules.
export type GameSessionData = {
  id: string;
  mode: GameMode;
  config: Record<string, unknown>;
  status: GameSessionStatus;
  winner_player_id: string | null;
  scolia_board_id: string | null;
  created_at: string;
  completed_at: string | null;
};

export type GamePlayerData = {
  player_id: string;
  play_order: number;
  display_name: string;
};

export type GameThrowData = {
  id: string;
  session_id: string;
  player_id: string;
  round_number: number;
  turn_index: number;
  dart_index: number;
  segment: string;
  scored: number;
  meta: Record<string, unknown>;
  /** True for optimistic rows that have not been confirmed by the server yet. */
  pending?: boolean;
};

const SESSION_COLUMNS = 'id, mode, config, status, winner_player_id, scolia_board_id, created_at, completed_at';
const THROW_COLUMNS = 'id, session_id, player_id, round_number, turn_index, dart_index, segment, scored, meta';
const REFETCH_DEBOUNCE_MS = 150;

type PlayerRow = {
  player_id: string;
  play_order: number;
  players: { display_name: string } | { display_name: string }[] | null;
};

export function rowToThrowInput(row: GameThrowData): GameThrowInput {
  return {
    id: row.id,
    playerId: row.player_id,
    roundNumber: row.round_number,
    turnIndex: row.turn_index,
    dartIndex: row.dart_index,
    segment: row.segment,
    scored: row.scored,
  };
}

function displayNameFromRow(row: PlayerRow): string {
  const rel = row.players;
  if (!rel) return 'Unknown';
  if (Array.isArray(rel)) return rel[0]?.display_name ?? 'Unknown';
  return rel.display_name ?? 'Unknown';
}

export function useGameData(gameId: string) {
  const [session, setSession] = useState<GameSessionData | null>(null);
  const [players, setPlayers] = useState<GamePlayerData[]>([]);
  const [throws, setThrows] = useState<GameThrowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient();
      const [sessionRes, playersRes, throwsRes] = await Promise.all([
        supabase.from('game_sessions').select(SESSION_COLUMNS).eq('id', gameId).maybeSingle(),
        supabase
          .from('game_session_players')
          .select('player_id, play_order, players(display_name)')
          .eq('session_id', gameId)
          .order('play_order'),
        supabase
          .from('game_throws')
          .select(THROW_COLUMNS)
          .eq('session_id', gameId)
          .order('turn_index')
          .order('dart_index'),
      ]);
      if (!mountedRef.current) return;

      if (sessionRes.error) throw new Error(sessionRes.error.message);
      if (playersRes.error) throw new Error(playersRes.error.message);
      if (throwsRes.error) throw new Error(throwsRes.error.message);
      if (!sessionRes.data) {
        setSession(null);
        setError('Game not found');
        return;
      }

      setSession(sessionRes.data as unknown as GameSessionData);
      setPlayers(
        ((playersRes.data ?? []) as unknown as PlayerRow[]).map((row) => ({
          player_id: row.player_id,
          play_order: row.play_order,
          display_name: displayNameFromRow(row),
        }))
      );
      setThrows((throwsRes.data ?? []) as unknown as GameThrowData[]);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load game');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [gameId]);

  // Initial load.
  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    void refetch();
    return () => {
      mountedRef.current = false;
    };
  }, [refetch]);

  // Realtime: any change to this session's throws or the session row triggers a debounced refetch.
  useEffect(() => {
    let cancelled = false;
    let supabase: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!cancelled) void refetch();
      }, REFETCH_DEBOUNCE_MS);
    };

    void (async () => {
      supabase = await getSupabaseClient();
      if (cancelled) return;
      channel = supabase
        .channel(`game_${gameId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_throws', filter: `session_id=eq.${gameId}` },
          scheduleRefetch
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${gameId}` },
          scheduleRefetch
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [gameId, refetch]);

  const orderedPlayerIds = useMemo(
    () => players.slice().sort((a, b) => a.play_order - b.play_order).map((p) => p.player_id),
    [players]
  );

  return { session, players, orderedPlayerIds, throws, loading, error, refetch, setThrows };
}
