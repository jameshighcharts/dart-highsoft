import { describe, expect, it } from 'vitest';

import { calculateProbabilityVectorConsequence } from './replay';

describe('DartIQ replay consequence', () => {
  it('equals acting-player absolute WPA in a normalized two-player field', () => {
    const consequence = calculateProbabilityVectorConsequence(
      [
        { id: 'a', legWinProbability: 0.4, matchWinProbability: 0.3 },
        { id: 'b', legWinProbability: 0.6, matchWinProbability: 0.7 },
      ],
      [
        { id: 'a', legWinProbability: 0.65, matchWinProbability: 0.5 },
        { id: 'b', legWinProbability: 0.35, matchWinProbability: 0.5 },
      ]
    );

    expect(consequence.leg).toBeCloseTo(0.25);
    expect(consequence.match).toBeCloseTo(0.2);
  });

  it('captures movement among non-actors in multiplayer', () => {
    const consequence = calculateProbabilityVectorConsequence(
      [
        { id: 'a', legWinProbability: 0.5, matchWinProbability: 0.5 },
        { id: 'b', legWinProbability: 0.3, matchWinProbability: 0.3 },
        { id: 'c', legWinProbability: 0.2, matchWinProbability: 0.2 },
      ],
      [
        { id: 'a', legWinProbability: 0.5, matchWinProbability: 0.5 },
        { id: 'b', legWinProbability: 0.1, matchWinProbability: 0.1 },
        { id: 'c', legWinProbability: 0.4, matchWinProbability: 0.4 },
      ]
    );

    expect(consequence).toEqual({ leg: 0.2, match: 0.2 });
  });

  it('measures probability mass when the player support changes', () => {
    const consequence = calculateProbabilityVectorConsequence(
      [
        { id: 'a', legWinProbability: 0.4, matchWinProbability: 0.4 },
        { id: 'b', legWinProbability: 0.6, matchWinProbability: 0.6 },
      ],
      [{ id: 'a', legWinProbability: 1, matchWinProbability: 1 }]
    );

    expect(consequence).toEqual({ leg: 0.6, match: 0.6 });
  });
});
