export type CommentaryDemoDart = {
  sector: string;
  segment: string;
  scored: number;
  impactXmm: number;
  impactYmm: number;
};

export type CommentaryDemoVisit = {
  player: 'Nikita' | 'Ken';
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

/**
 * A valid 301 double-out leg designed to exercise the full commentary stack:
 * Nikita special -> opposing 180 -> deficit -> comeback 180 -> missed double
 * leave -> bull checkout and punished-miss payoff.
 */
export const BROADCAST_DIRECTOR_DEMO: readonly CommentaryDemoVisit[] = [
  {
    player: 'Nikita',
    purpose: 'Open with the exact order-independent Nikita special.',
    darts: [
      dart('S1', 'S1', 1, 36, -111),
      dart('S5', 'S5', 5, 101, -48),
      dart('S20', 'S20', 20, -3, -116),
    ],
  },
  {
    player: 'Ken',
    purpose: 'Answer immediately with a marquee 180 and become the strong favourite.',
    darts: [
      dart('T20', 'T20', 60, -2, -103),
      dart('T20', 'T20', 60, 3, -101),
      dart('T20', 'T20', 60, 0, -106),
    ],
  },
  {
    player: 'Nikita',
    purpose: 'A quiet visit deepens the apparent collapse without manufacturing drama.',
    darts: [
      dart('S20', 'S20', 20, 4, -119),
      dart('S5', 'S5', 5, 105, -51),
      dart('S20', 'S20', 20, -5, -114),
    ],
  },
  {
    player: 'Ken',
    purpose: 'Consolidate the lead while leaving 41.',
    darts: [
      dart('T20', 'T20', 60, 2, -104),
      dart('S20', 'S20', 20, -4, -121),
      dart('None', 'Miss', 0, 184, 172),
    ],
  },
  {
    player: 'Nikita',
    purpose: 'A comeback 180 turns the match and leaves the bull.',
    darts: [
      dart('T20', 'T20', 60, -2, -102),
      dart('T20', 'T20', 60, 2, -105),
      dart('T20', 'T20', 60, 0, -100),
    ],
  },
  {
    player: 'Ken',
    purpose: 'Reach 40, then miss the one-dart double leave and fail to recover.',
    darts: [
      dart('S1', 'S1', 1, 39, -113),
      dart('S1', 'S1', 1, 34, -117),
      dart('None', 'Miss', 0, -177, 166),
    ],
  },
  {
    player: 'Nikita',
    purpose: 'Take out 50 on the bull for comeback and punished-miss payoff.',
    darts: [dart('Bull', 'DB', 50, 1, -1)],
  },
] as const;

export function commentaryDemoSummary() {
  return BROADCAST_DIRECTOR_DEMO.map((visit, index) => ({
    visit: index + 1,
    player: visit.player,
    score: visit.darts.reduce((sum, entry) => sum + entry.scored, 0),
    darts: visit.darts.map((entry) => entry.segment).join(', '),
    purpose: visit.purpose,
  }));
}
