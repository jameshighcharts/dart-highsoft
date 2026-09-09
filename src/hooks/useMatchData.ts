"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { loadMatchData } from '@/lib/match/loadMatchData';
import { recordPerfMetric } from '@/lib/match/perfMetrics';
import type { LegRecord, MatchRecord, Player, TurnRecord, TurnWithThrows, MatchPlayersRow } from '@/lib/match/types';

type UseMatchDataResult = {
  loading: boolean;
  setLoading: (value: boolean) => void;
  error: string | null;
  setError: (value: string | null) => void;
  match: MatchRecord | null;
  setMatch: (value: MatchRecord | null) => void;
  players: Player[];
  setPlayers: (value: Player[]) => void;
  legs: LegRecord[];
  setLegs: (value: LegRecord[]) => void;
  turns: TurnRecord[];
  setTurns: (value: TurnRecord[] | ((prev: TurnRecord[]) => TurnRecord[])) => void;
  turnsByLeg: Record<string, TurnRecord[]>;
  setTurnsByLeg: Dispatch<SetStateAction<Record<string, TurnRecord[]>>>;
  turnThrowCounts: Record<string, number>;
  setTurnThrowCounts: (value: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  spectatorLoading: boolean;
  setSpectatorLoading: (value: boolean) => void;
  loadAll: () => Promise<void>;
  loadAllSpectator: (throwOnError?: boolean) => Promise<void>;
  loadMatchOnly: () => Promise<MatchRecord | null>;
  loadLegsOnly: () => Promise<LegRecord[]>;
  loadPlayersOnly: () => Promise<Player[]>;
  loadTurnsForLeg: (legId: string) => Promise<TurnRecord[]>;
};

export function useMatchData(matchId: string): UseMatchDataResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchRecord | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [legs, setLegs] = useState<LegRecord[]>([]);
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [turnsByLeg, setTurnsByLeg] = useState<Record<string, TurnRecord[]>>({});
  const [turnThrowCounts, setTurnThrowCounts] = useState<Record<string, number>>({});
  const [spectatorLoading, setSpectatorLoading] = useState(false);

  const loadAllRequestIdRef = useRef(0);
  const loadAllSpectatorRequestIdRef = useRef(0);
  // A multi-query HTTP snapshot has no ordering against incoming live events.
  // Invalidate the entire read if any relevant event arrives while it is in
  // flight; applying only selected rows would also need deletion tombstones.
  const liveEpochRef = useRef(0);
  const ownerRef = useRef(0);
  useEffect(() => {
    const events = ['supabase-scoring-commit', 'supabase-throws-change',
      'supabase-turns-change', 'supabase-legs-change', 'supabase-matches-change',
      'supabase-match-players-change'];
    const invalidate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const eventMatch = detail?.matchId ?? detail?.new?.match_id ?? detail?.old?.match_id
        ?? (event.type === 'supabase-matches-change' ? detail?.new?.id ?? detail?.old?.id : undefined);
      if (!eventMatch || eventMatch === matchId) liveEpochRef.current += 1;
    };
    events.forEach(event => window.addEventListener(event, invalidate));
    return () => {
      events.forEach(event => window.removeEventListener(event, invalidate));
      ownerRef.current += 1;
      liveEpochRef.current += 1;
      loadAllRequestIdRef.current += 1;
      loadAllSpectatorRequestIdRef.current += 1;
    };
  }, [matchId]);

  const readSnapshot = useCallback(async (options: Parameters<typeof loadMatchData>[2]) => {
    const owner = ownerRef.current;
    const supabase = await getSupabaseClient();
    // Bounded retries preserve live updates even during sustained play. A busy
    // or failed recovery remains unacknowledged and can retry on the next check.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (owner !== ownerRef.current) throw new Error('Match snapshot owner changed');
      const epoch = liveEpochRef.current;
      const result = await loadMatchData(supabase, matchId, options);
      if (owner !== ownerRef.current) throw new Error('Match snapshot owner changed');
      if (epoch === liveEpochRef.current) return { result, epoch };
    }
    throw new Error('Match changed during snapshot recovery');
  }, [matchId]);


  const loadAll = useCallback(async () => {
    const requestId = ++loadAllRequestIdRef.current;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setLoading(true);
    setError(null);
    try {
      const { result, epoch } = await readSnapshot({ includeTurnsByLegSummary: true });
      if (epoch !== liveEpochRef.current) throw new Error('Match changed before snapshot application');

      if (requestId !== loadAllRequestIdRef.current) return;

      setMatch(result.match);
      setPlayers(result.players);
      setLegs(result.legs);
      setTurns(result.turns);
      setTurnThrowCounts(result.turnThrowCounts);
      setTurnsByLeg(result.turnsByLeg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
    } finally {
      if (process.env.NODE_ENV !== 'production') {
        const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const durationMs = Math.round(endedAt - startedAt);
        console.debug(`[perf] match loadAll took ${durationMs}ms`);
        recordPerfMetric(matchId, 'matchLoadAllMs', durationMs);
      }
      if (requestId === loadAllRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [matchId, readSnapshot]);

  // Separate loading function for spectator mode that doesn't show loading screen
  const loadAllSpectator = useCallback(async (throwOnError = false) => {
    const requestId = ++loadAllSpectatorRequestIdRef.current;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setSpectatorLoading(true);
    setError(null);
    try {
      const { result, epoch } = await readSnapshot({
        includeTurnsByLegSummary: false,
        includeTurnsByLegThrows: true,
      });
      if (epoch !== liveEpochRef.current) throw new Error('Match changed before snapshot application');

      if (requestId !== loadAllSpectatorRequestIdRef.current) {
        if (throwOnError) throw new Error('Spectator recovery was superseded');
        return;
      }

      if (result.match) setMatch(result.match);
      setPlayers(result.players);
      setLegs(result.legs);
      setTurns(result.turns);
      setTurnThrowCounts(result.turnThrowCounts);
      setTurnsByLeg(result.turnsByLeg);

      // NOTE: throw counts are derived from the loaded turns above to avoid extra queries.
    } catch (e) {
      console.error(
        'Spectator mode refresh error:',
        e instanceof Error ? e.message : JSON.stringify(e)
      );
      // Recovery must not acknowledge a revision when the snapshot failed.
      if (throwOnError) throw e;
      // Don't set error state in spectator mode to avoid disrupting the view
    } finally {
      if (process.env.NODE_ENV !== 'production') {
        const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const durationMs = Math.round(endedAt - startedAt);
        console.debug(`[perf] spectator loadAll took ${durationMs}ms`);
        recordPerfMetric(matchId, 'spectatorLoadAllMs', durationMs);
      }
      if (requestId === loadAllSpectatorRequestIdRef.current) {
        setSpectatorLoading(false);
        setLoading(false);
      }
    }
  }, [matchId, readSnapshot]);

  const loadMatchOnly = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient();
      const { data, error: matchError } = await supabase.from('matches').select('*').eq('id', matchId).single();
      if (matchError) throw matchError;
      const nextMatch = (data ?? null) as MatchRecord | null;
      setMatch(nextMatch);
      return nextMatch;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      return null;
    }
  }, [matchId]);

  const loadLegsOnly = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient();
      const { data, error: legsError } = await supabase
        .from('legs')
        .select('*')
        .eq('match_id', matchId)
        .order('leg_number');
      if (legsError) throw legsError;
      const nextLegs = ((data ?? []) as LegRecord[]) ?? [];
      setLegs(nextLegs);
      return nextLegs;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      return [];
    }
  }, [matchId]);

  const loadPlayersOnly = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient();
      const { data, error: matchPlayersError } = await supabase
        .from('match_players')
        .select('*, players:player_id(*)')
        .eq('match_id', matchId)
        .order('play_order');
      if (matchPlayersError) throw matchPlayersError;
      const nextPlayers = (((data as MatchPlayersRow[] | null) ?? []).map((r) => r.players) ?? []) as Player[];
      setPlayers(nextPlayers);
      return nextPlayers;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      return [];
    }
  }, [matchId]);

  const loadTurnsForLeg = useCallback(async (legId: string) => {
    try {
      const supabase = await getSupabaseClient();
      const { data: updatedTurns, error } = await supabase
        .from('turns')
        .select(
          `
            *,
            throws:throws(id, live_revision, turn_id, dart_index, segment, scored)
          `
        )
        .eq('leg_id', legId)
        .order('turn_number');
      if (error) throw error;

      const nextTurns =
        ((updatedTurns ?? []) as TurnWithThrows[]).sort((a, b) => a.turn_number - b.turn_number) as unknown as TurnRecord[];
      const throwCounts: Record<string, number> = {};
      for (const turn of (updatedTurns ?? []) as TurnWithThrows[]) {
        throwCounts[turn.id] = (turn.throws ?? []).length;
      }

      setTurns(nextTurns);
      setTurnThrowCounts(throwCounts);
      setTurnsByLeg((prev) => ({ ...prev, [legId]: nextTurns }));
      return nextTurns;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      return [];
    }
  }, []);

  return {
    loading,
    setLoading,
    error,
    setError,
    match,
    setMatch,
    players,
    setPlayers,
    legs,
    setLegs,
    turns,
    setTurns,
    turnsByLeg,
    setTurnsByLeg,
    turnThrowCounts,
    setTurnThrowCounts,
    spectatorLoading,
    setSpectatorLoading,
    loadAll,
    loadAllSpectator,
    loadMatchOnly,
    loadLegsOnly,
    loadPlayersOnly,
    loadTurnsForLeg,
  };
}
