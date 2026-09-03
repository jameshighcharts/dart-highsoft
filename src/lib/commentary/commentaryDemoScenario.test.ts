import { describe, expect, it } from 'vitest';

import { BROADCAST_DIRECTOR_DEMO, commentaryDemoSummary } from './commentaryDemoScenario';

describe('BROADCAST_DIRECTOR_DEMO', () => {
  it('is a valid scripted 301 result with Nikita winning on the bull', () => {
    const totals = { Nikita: 0, Ken: 0 };
    for (const visit of BROADCAST_DIRECTOR_DEMO) {
      totals[visit.player] += visit.darts.reduce((sum, dart) => sum + dart.scored, 0);
    }
    expect(totals).toEqual({ Nikita: 301, Ken: 262 });
    expect(BROADCAST_DIRECTOR_DEMO.at(-1)?.darts).toMatchObject([{ segment: 'DB', scored: 50 }]);
  });

  it('contains the key marquee and narrative beats', () => {
    const summary = commentaryDemoSummary();
    expect(summary[0]).toMatchObject({ player: 'Nikita', score: 26, darts: 'S1, S5, S20' });
    expect(summary.filter((visit) => visit.score === 180)).toHaveLength(2);
    expect(summary.at(-2)?.purpose).toContain('miss');
  });
});
