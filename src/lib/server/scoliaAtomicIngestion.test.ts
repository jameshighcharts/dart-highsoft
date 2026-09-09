import { describe, expect, it } from 'vitest';
import { planScoliaThrow, type ScoliaScoringSnapshot } from './scoliaAtomicIngestion';
import { replayTurn } from '@/utils/legScoreCalculator';
import { BROADCAST_DIRECTOR_DEMO, COMMENTARY_DEMO_PLAYERS } from '@/lib/commentary/commentaryDemoScenario';

const base = (fair = false, score = '301'): ScoliaScoringSnapshot => ({
  match: { id: 'match', winner_player_id: null, completed_at: null, ended_early: false,
    start_score: score, finish: 'double_out', legs_to_win: 1, fair_ending: fair, tournament_match_id: null },
  leg: { id: 'leg', match_id: 'match', leg_number: 1, starting_player_id: 'a', winner_player_id: null },
  playerIds: ['a', 'b'], turns: [],
});
function append(snapshot: ScoliaScoringSnapshot, segment: string, scored: number) {
  const plan = planScoliaThrow(snapshot, { segment: segment as 'S20', scored });
  snapshot.turns = plan.createTurn ? [...snapshot.turns, plan.turn] : snapshot.turns.map(t => t.id === plan.turn.id ? plan.turn : t);
  return plan;
}
describe('atomic Scolia scoring plan', () => {
  it('matches the existing replay engine through the long office demo', () => {
    const snapshot = base(); snapshot.playerIds = [...COMMENTARY_DEMO_PLAYERS]; snapshot.leg.starting_player_id = 'Ada';
    const scores = new Map(snapshot.playerIds.map(id => [id,301]));
    for (const visit of BROADCAST_DIRECTOR_DEMO) {
      for (const dart of visit.darts) {
        const plan = append(snapshot, dart.segment, dart.scored);
        expect(plan.turn.player_id).toBe(visit.player);
        const result = replayTurn([...plan.turn.throws], scores.get(visit.player)!, 'double_out');
        expect(plan.completeTurn).toBe(result.busted || result.finished || plan.turn.throws.length === 3);
        if (plan.completeTurn) {
          expect(plan.turn.busted).toBe(result.busted);
          expect(plan.winnerId).toBe(result.finished ? visit.player : null);
          scores.set(visit.player, result.score_after);
        }
      }
    }
  });
  it('keeps partial totals, settles early busts, and rotates players', () => {
    const s = base(false,'40');
    expect(append(s,'S20',20).turn.total_scored).toBe(0);
    expect(append(s,'S20',20)).toMatchObject({ completeTurn: true, winnerId: null, turn: { busted: true, total_scored: 40 } });
    expect(append(s,'S1',1).turn.player_id).toBe('b');
  });
  it('retains fair-ending entitlement and repeated tied tiebreaks', () => {
    const s = base(true,'40');
    expect(append(s,'D20',40).winnerId).toBeNull();
    expect(append(s,'D20',40).winnerId).toBeNull();
    for (let round=1;round<=2;round++) {
      for (const pid of ['a','b']) for(let dart=0;dart<3;dart++) {
        expect(append(s,'S20',20)).toMatchObject({ winnerId: null, turn: { player_id: pid, tiebreak_round: round } });
      }
    }
    for(let dart=0;dart<3;dart++) append(s,'T20',60);
    append(s,'S20',20); append(s,'S20',20);
    expect(append(s,'S20',20).winnerId).toBe('a');
  });
  it('replays corrected prior raw darts instead of trusting stale turn totals', () => {
    const s=base(false,'101');
    for(const pid of ['a','b']) { void pid; append(s,'S20',20);append(s,'S20',20);append(s,'S20',20); }
    Object.assign(s.turns[0].throws[0],{segment:'S11',scored:11}); // a actually has 50, not 41.
    expect(append(s,'DB',50).winnerId).toBe('a');
  });
});
