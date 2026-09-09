import type { SupabaseClient } from '@supabase/supabase-js';
import { replayTurn } from '../../utils/legScoreCalculator.ts';
import type { FinishRule } from '../../utils/x01.ts';
import type { ScoliaScoringSnapshot } from './scoliaAtomicIngestion.ts';

export async function recomputeLegTurns(
  supabase: SupabaseClient, legId: string, _startScore: number, _finishRule: FinishRule
): Promise<void> {
  // Keep the public signature; authoritative rules travel with the versioned snapshot.
  void _startScore;
  void _finishRule;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.rpc('load_x01_recompute_snapshot', { p_leg_id: legId });
    if (error) throw new Error(error.message);
    if (!data) return;
    const { snapshot, revision } = data as { snapshot: ScoliaScoringSnapshot; revision: string };
    const scores = new Map<string, number>();
    const updates: { id: string; total_scored: number; busted: boolean }[] = [];
    for (const turn of snapshot.turns) {
      if (turn.tiebreak_round != null) continue;
      const score = scores.get(turn.player_id) ?? Number(snapshot.match.start_score);
      const result = replayTurn([...turn.throws], score, snapshot.match.finish);
      scores.set(turn.player_id, result.score_after);
      if (result.total_scored !== turn.total_scored || result.busted !== turn.busted) {
        updates.push({ id: turn.id, total_scored: result.total_scored, busted: result.busted });
      }
    }
    if (!updates.length) return;
    const result = await supabase.rpc('commit_x01_recompute', {
      p_match_id: snapshot.match.id, p_leg_id: legId, p_revision: revision, p_updates: updates,
    });
    if (result.error) {
      if (result.error.code === '40001' || result.error.code === '40P01') continue;
      throw new Error(result.error.message);
    }
    if (result.data) return;
  }
  throw new Error('Scoring changed during correction; retry the correction');
}
