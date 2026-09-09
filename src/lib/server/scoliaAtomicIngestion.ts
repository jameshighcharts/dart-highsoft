import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { replayTurn } from '../../utils/legScoreCalculator.ts';
import { computeFairEndingState, getNextFairEndingPlayer } from '../../utils/fairEnding.ts';
import type { ScoliaDetectedThrow } from '../scolia/protocol.ts';
import type { MatchRow } from './matchGuards.ts';
import type { TurnWithThrows, LegRecord } from '../match/types.ts';
import type { StoredScoliaEvent, ScoliaThrowIngestionResult } from './scoliaThrowIngestion.ts';
import type { AcceptedScoliaDart } from '../commentary/scoliaRealtimeEvent.ts';

export type ScoliaScoringSnapshot = {
  match: MatchRow; leg: LegRecord; playerIds: string[]; turns: TurnWithThrows[];
};
export type ScoliaScoringPlan = {
  turn: TurnWithThrows; createTurn: boolean; completeTurn: boolean; winnerId: string | null;
};

/** Same pure scoring/fair-ending engine as the existing ingestion path. */
export function planScoliaThrow(snapshot: ScoliaScoringSnapshot, detected: ScoliaDetectedThrow): ScoliaScoringPlan {
  const { match, leg, playerIds } = snapshot;
  if (!playerIds.length) throw new Error('Scolia match has no players');
  const start = Math.max(0, playerIds.indexOf(leg.starting_player_id));
  const order = [...playerIds.slice(start), ...playerIds.slice(0, start)].map(id => ({ id }));
  const inputs = (turns: TurnWithThrows[]) => turns.map(t => ({
    player_id: t.player_id, total_scored: t.total_scored, busted: t.busted,
    tiebreak_round: t.tiebreak_round, throw_count: t.throws.length,
    throws_total: t.throws.reduce((sum, dart) => sum + dart.scored, 0),
  }));
  const before = computeFairEndingState(inputs(snapshot.turns), order, Number(match.start_score), match.fair_ending);
  const latest = snapshot.turns.at(-1);
  const playerId = before.phase === 'normal'
    ? latest && latest.throws.length < 3 && !latest.busted ? latest.player_id : order[snapshot.turns.length % order.length].id
    : getNextFairEndingPlayer(before, order, inputs(snapshot.turns));
  if (!playerId) throw new Error('Could not determine the current player for this Scolia throw');
  const createTurn = !latest || latest.player_id !== playerId || latest.throws.length >= 3 || latest.busted;
  const turn: TurnWithThrows = createTurn ? {
    id: randomUUID(), leg_id: leg.id, player_id: playerId, turn_number: (latest?.turn_number ?? 0) + 1,
    total_scored: 0, busted: false, tiebreak_round: before.phase === 'tiebreak' ? before.tiebreakRound : null, throws: [],
  } : { ...latest!, throws: [...latest!.throws] };
  turn.throws.push({ id: randomUUID(), turn_id: turn.id, dart_index: turn.throws.length + 1,
    segment: detected.segment, scored: detected.scored });
  let score = Number(match.start_score);
  for (const previous of snapshot.turns) {
    if (previous.id === turn.id) break;
    if (previous.player_id === playerId && previous.tiebreak_round == null) {
      score = replayTurn([...previous.throws], score, match.finish).score_after;
    }
  }
  const result = turn.tiebreak_round != null ? { busted: false, finished: false }
    : replayTurn([...turn.throws], score, match.finish);
  const completeTurn = result.busted || result.finished || turn.throws.length >= 3;
  if (completeTurn) {
    turn.total_scored = turn.throws.reduce((sum, dart) => sum + dart.scored, 0);
    turn.busted = result.busted;
  }
  const turns = createTurn ? [...snapshot.turns, turn] : snapshot.turns.map(t => t.id === turn.id ? turn : t);
  const after = computeFairEndingState(inputs(turns), order, Number(match.start_score), match.fair_ending);
  return { turn, createTurn, completeTurn,
    winnerId: completeTurn ? match.fair_ending ? after.winnerId : result.finished ? playerId : null : null };
}

export type Prepared = { kind: 'legacy' } | { kind: 'ignored'; reason: string } | { kind: 'duplicate'; matchId: string; throwId: string; accepted: AcceptedScoliaDart }
  | { kind: 'x01'; revision: string; matchId: string; snapshot?: ScoliaScoringSnapshot };

/** One owner per board; every cache reuse is checked by the database revision. */
export class ScoliaAtomicIngestion {
  private cached: { matchId: string; revision: string; snapshot: ScoliaScoringSnapshot } | null = null;
  private readonly supabase: SupabaseClient;
  constructor(supabase: SupabaseClient) { this.supabase = supabase; }

  async persistAndPrepare(event: {
    board_id: string; message_id: string; event_type: string; payload: unknown;
    occurred_at: string | null; received_at: string;
  }): Promise<{ event: StoredScoliaEvent & { processing_status: string }; prepared: Prepared | null }> {
    const { data, error } = await this.supabase.rpc('persist_and_prepare_scolia_throw', {
      p_event: event, p_known_match_id: this.cached?.matchId ?? null,
      p_known_revision: this.cached?.revision ?? null,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  async ingest(event: StoredScoliaEvent, detected: ScoliaDetectedThrow, initialPrepared?: Prepared | null): Promise<ScoliaThrowIngestionResult | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = attempt === 0 && initialPrepared
        ? { data: initialPrepared, error: null }
        : await this.supabase.rpc('prepare_scolia_x01_throw', {
        p_event_id: event.id, p_known_match_id: this.cached?.matchId ?? null,
        p_known_revision: this.cached?.revision ?? null,
      });
      if (error) throw new Error(error.message);
      const prepared = data as Prepared;
      if (prepared.kind === 'ignored') { this.cached = null; return { status: 'ignored', reason: prepared.reason }; }
      if (prepared.kind === 'legacy') { this.cached = null; return null; }
      if (prepared.kind === 'duplicate') return { status: 'processed', target: { kind: 'match', id: prepared.matchId },
        throwId: prepared.throwId, accepted: prepared.accepted };
      const snapshot = prepared.snapshot ?? (this.cached?.matchId === prepared.matchId && this.cached.revision === prepared.revision ? this.cached.snapshot : null);
      if (!snapshot) throw new Error('Missing revision-checked scoring snapshot');
      const plan = planScoliaThrow(snapshot, detected);
      const commit = await this.supabase.rpc('commit_scolia_x01_throw', {
        p_event_id: event.id, p_match_id: prepared.matchId, p_revision: prepared.revision,
        p_plan: plan, p_detected: detected,
      });
      if (commit.error) {
        this.cached = null;
        if (commit.error.code === '40001' || commit.error.code === '40P01') continue;
        throw new Error(commit.error.message);
      }
      if (commit.data?.stale) { this.cached = null; continue; }
      const accepted = commit.data.accepted as AcceptedScoliaDart;
      const turn = { ...plan.turn, throws: accepted.rows.turn!.throws };
      this.cached = plan.winnerId || commit.data.duplicate ? null : { matchId: prepared.matchId, revision: accepted.revision,
        snapshot: { ...snapshot, match: commit.data.match,
          turns: plan.createTurn ? [...snapshot.turns, turn] : snapshot.turns.map(t => t.id === turn.id ? turn : t) } };
      return { status: 'processed', target: { kind: 'match', id: prepared.matchId }, throwId: accepted.rows.id, accepted };
    }
    throw new Error('Scolia scoring changed concurrently; retry event');
  }
}
