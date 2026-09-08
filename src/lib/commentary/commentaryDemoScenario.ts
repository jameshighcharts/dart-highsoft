import type { DartIQHistoricalFact } from '../dartiq/evidence.ts';

export const COMMENTARY_DEMO_PLAYERS = ['Ada', 'Ben', 'Jo', 'Max', 'Liv', 'Sam'] as const;

/** Explicitly synthetic history, confined to the local demo's test players. */
export function commentaryDemoRivalryFacts(playerId: (name: CommentaryDemoPlayer) => string): DartIQHistoricalFact[] {
  return [{
    kind: 'matchup_history', subjectPlayerId: playerId('Ada'), counterpartPlayerId: playerId('Ben'),
    support: 5, confidenceTier: 'supported', evidence: {
      sharedMatches: 5, subjectWins: 1, counterpartWins: 3, otherWinnerMatches: 1,
      twoPlayerMatches: 0, latestWinnerPlayerId: playerId('Ben'), currentWinnerStreak: 3,
    },
  }];
}

export type CommentaryDemoPlayer = (typeof COMMENTARY_DEMO_PLAYERS)[number];

export type CommentaryDemoDart = {
  sector: string;
  segment: string;
  scored: number;
  impactXmm: number;
  impactYmm: number;
};

export type CommentaryDemoVisit = {
  round: number;
  player: CommentaryDemoPlayer;
  purpose: string;
  darts: CommentaryDemoDart[];
};

const dart = (
  sector: string,
  segment: string,
  scored: number,
  impactXmm: number,
  impactYmm: number
): CommentaryDemoDart => ({ sector, segment, scored, impactXmm, impactYmm });

const miss = () => dart('None', 'Miss', 0, 184, 172);
const visit = (
  round: number,
  player: CommentaryDemoPlayer,
  purpose: string,
  darts: CommentaryDemoDart[]
): CommentaryDemoVisit => ({ round, player, purpose, darts });

/**
 * One valid, deliberately long 301 double-out office leg for six players.
 * Everyone gets five visits before the finish. The scoring stays human while
 * still producing isolated trebles, useful doubles, awkward leaves, checkout
 * pressure, and enough silence between real moments for the policy to breathe.
 */
export const BROADCAST_DIRECTOR_DEMO: readonly CommentaryDemoVisit[] = [
  // Round 1 — establish six distinct, believably scrappy starts.
  visit(1, 'Ada', 'A steady 41 opens the long office rotation.', [
    dart('S20', 'S20', 20, -4, -121), dart('S5', 'S5', 5, 103, -49),
    dart('S16', 'S16', 16, -112, 3),
  ]),
  visit(1, 'Ben', 'A low 26 gives ordinary commentary room to stay quiet.', [
    dart('S20', 'S20', 20, 3, -119), dart('S3', 'S3', 3, 111, 35),
    dart('S3', 'S3', 3, 108, 38),
  ]),
  visit(1, 'Jo', 'Three singles make a useful but unflashy 45.', [
    dart('S20', 'S20', 20, -5, -118), dart('S20', 'S20', 20, 4, -122),
    dart('S5', 'S5', 5, 105, -52),
  ]),
  visit(1, 'Max', 'One clean treble is followed by two genuine misses.', [
    dart('T20', 'T20', 60, -2, -103), miss(), miss(),
  ]),
  visit(1, 'Liv', 'A scattered 22 keeps the field bunched.', [
    dart('S5', 'S5', 5, 102, -48), dart('S12', 'S12', 12, 94, 53),
    dart('S5', 'S5', 5, 106, -46),
  ]),
  visit(1, 'Sam', 'A first-dart T19 lands, then the visit disappears.', [
    dart('T19', 'T19', 57, 1, 103), miss(), miss(),
  ]),

  // Round 2 — routine scoring with one sudden 81.
  visit(2, 'Ada', 'Three twenties bring calm, repeatable scoring.', [
    dart('S20', 'S20', 20, -4, -120), dart('S20', 'S20', 20, 3, -117),
    dart('S20', 'S20', 20, -1, -123),
  ]),
  visit(2, 'Ben', 'A modest 45 starts repairing the slow opening.', [
    dart('S20', 'S20', 20, 2, -120), dart('S20', 'S20', 20, -5, -118),
    dart('S5', 'S5', 5, 103, -51),
  ]),
  visit(2, 'Jo', 'A T20 turns two loose singles into a sudden 81.', [
    dart('T20', 'T20', 60, 2, -104), dart('S20', 'S20', 20, -3, -121),
    dart('S1', 'S1', 1, 36, -111),
  ]),
  visit(2, 'Max', 'Back to earth with 41 after the early treble.', [
    dart('S20', 'S20', 20, -2, -117), dart('S16', 'S16', 16, -111, 1),
    dart('S5', 'S5', 5, 104, -47),
  ]),
  visit(2, 'Liv', 'Three single twenties keep Liv attached to the pack.', [
    dart('S20', 'S20', 20, 3, -118), dart('S20', 'S20', 20, -3, -122),
    dart('S20', 'S20', 20, 1, -116),
  ]),
  visit(2, 'Sam', 'Another office 26 slows the early T19 momentum.', [
    dart('S12', 'S12', 12, 93, 54), dart('S7', 'S7', 7, -103, 51),
    dart('S7', 'S7', 7, -100, 47),
  ]),

  // Round 3 — the scoring round: everybody becomes relevant.
  visit(3, 'Ada', 'A treble-led 85 puts Ada within two visits.', [
    dart('T20', 'T20', 60, -2, -102), dart('S20', 'S20', 20, 4, -119),
    dart('S5', 'S5', 5, 102, -50),
  ]),
  visit(3, 'Ben', 'A first ton drags Ben straight into contention.', [
    dart('T20', 'T20', 60, 2, -105), dart('S20', 'S20', 20, -4, -120),
    dart('S20', 'S20', 20, 3, -117),
  ]),
  visit(3, 'Jo', 'A believable 95 leaves the most dangerous score.', [
    dart('T19', 'T19', 57, -2, 102), dart('S20', 'S20', 20, 2, -120),
    dart('S18', 'S18', 18, -56, 98),
  ]),
  visit(3, 'Max', 'Max answers with a ton and reaches 100 exactly.', [
    dart('T20', 'T20', 60, -1, -104), dart('S20', 'S20', 20, -4, -118),
    dart('S20', 'S20', 20, 4, -121),
  ]),
  visit(3, 'Liv', 'T19 and D11 make an unconventional but valid 99.', [
    dart('T19', 'T19', 57, 2, 104), dart('S20', 'S20', 20, -3, -119),
    dart('D11', 'D11', 22, -118, -37),
  ]),
  visit(3, 'Sam', 'A 98 means all six players now have a live route inward.', [
    dart('T20', 'T20', 60, 1, -103), dart('S20', 'S20', 20, 4, -120),
    dart('S18', 'S18', 18, -58, 96),
  ]),

  // Round 4 — everyone reaches the sharp end by a different route.
  visit(4, 'Ada', 'Three singles leave 60 and make the next round matter.', [
    dart('S20', 'S20', 20, -4, -119), dart('S20', 'S20', 20, 3, -121),
    dart('S15', 'S15', 15, -80, 80),
  ]),
  visit(4, 'Ben', 'A T20 plus two fives also leaves 60.', [
    dart('T20', 'T20', 60, -2, -104), dart('S5', 'S5', 5, 102, -49),
    dart('S5', 'S5', 5, 106, -52),
  ]),
  visit(4, 'Jo', 'Two twenties and a miss park Jo on 40.', [
    dart('S20', 'S20', 20, -3, -119), dart('S20', 'S20', 20, 4, -121), miss(),
  ]),
  visit(4, 'Max', 'T20, S1, miss leaves the awkward 39.', [
    dart('T20', 'T20', 60, 2, -102), dart('S1', 'S1', 1, 36, -112), miss(),
  ]),
  visit(4, 'Liv', 'A useful D10 helps an 80 leave D20.', [
    dart('T20', 'T20', 60, -1, -105), dart('D10', 'D10', 20, 6, -166), miss(),
  ]),
  visit(4, 'Sam', 'T20 and D15 combine for 90, leaving 30.', [
    dart('T20', 'T20', 60, 1, -103), dart('D15', 'D15', 30, -111, 111), miss(),
  ]),

  // Round 5 — six credible finish positions, but nobody gets out.
  visit(5, 'Ada', 'A single twenty leaves D20 after two misses.', [
    dart('S20', 'S20', 20, -4, -120), miss(), miss(),
  ]),
  visit(5, 'Ben', 'Twenty and eight leave D16, then the visit ends quietly.', [
    dart('S20', 'S20', 20, 3, -119), dart('S8', 'S8', 8, 69, 94), miss(),
  ]),
  visit(5, 'Jo', 'Eight scored leaves D16 and keeps Jo waiting.', [
    miss(), dart('S8', 'S8', 8, 70, 92), miss(),
  ]),
  visit(5, 'Max', 'Seven and sixteen rescue 39 into a D8 leave.', [
    dart('S7', 'S7', 7, -103, 50), dart('S16', 'S16', 16, -112, 2), miss(),
  ]),
  visit(5, 'Liv', 'Four scored from 40 leaves 36 and another live route.', [
    miss(), dart('S4', 'S4', 4, 80, 58), miss(),
  ]),
  visit(5, 'Sam', 'Ten and four leave D8 as the whole field bunches up.', [
    dart('S10', 'S10', 10, 6, -116), dart('S4', 'S4', 4, 81, 57), miss(),
  ]),

  // Round 6 — one final miss, a setup single, and a clean double payoff.
  visit(6, 'Ada', 'Miss, S8, D16 closes the six-player office epic.', [
    miss(), dart('S8', 'S8', 8, 69, 94), dart('D16', 'D16', 32, -166, 2),
  ]),
] as const;

export function commentaryDemoSummary() {
  return BROADCAST_DIRECTOR_DEMO.map((entry, index) => ({
    visit: index + 1,
    round: entry.round,
    player: entry.player,
    score: entry.darts.reduce((sum, dartEntry) => sum + dartEntry.scored, 0),
    darts: entry.darts.map((dartEntry) => dartEntry.segment).join(', '),
    purpose: entry.purpose,
  }));
}
