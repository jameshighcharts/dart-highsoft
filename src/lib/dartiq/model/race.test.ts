import { describe, expect, it } from 'vitest';

import {
  combineCurrentLegWithMatch,
  combineOrderedFirstFinishPmfs,
  createCurrentLegMatchContinuations,
  createFirstFinishPmf,
  createFirstFinishPmfTable,
} from './race';

describe('combineOrderedFirstFinishPmfs', () => {
  it('gives the earlier player the leg when both finish on the same visit', () => {
    const result = combineOrderedFirstFinishPmfs([
      { probabilities: [1], truncatedMass: 0 },
      { probabilities: [1], truncatedMass: 0 },
    ]);

    expect(result.probabilities).toEqual([1, 0]);
    expect(result.approximationMode).toBe('exact');
  });

  it('uses within-round order without dart-level interleaving', () => {
    const result = combineOrderedFirstFinishPmfs([
      { probabilities: [0.5, 0.5], truncatedMass: 0 },
      { probabilities: [1], truncatedMass: 0 },
    ]);

    expect(result.probabilities[0]).toBeCloseTo(0.5);
    expect(result.probabilities[1]).toBeCloseTo(0.5);
  });

  it('normalizes a multiplayer race', () => {
    const result = combineOrderedFirstFinishPmfs([
      { probabilities: [0.2, 0.8], truncatedMass: 0 },
      { probabilities: [0.3, 0.7], truncatedMass: 0 },
      { probabilities: [0.4, 0.6], truncatedMass: 0 },
    ]);

    expect(result.probabilities.every((probability) => probability >= 0)).toBe(true);
    expect(result.probabilities.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1);
  });
});

describe('createFirstFinishPmf', () => {
  it('repeatedly advances only surviving score mass', () => {
    const kernel = new Map([
      [40, new Map([[0, 0.5], [20, 0.5]])],
      [20, new Map([[0, 1]])],
    ]);
    const pmf = createFirstFinishPmf({ startScore: 40, kernel });

    expect(pmf.probabilities).toEqual([0.5, 0.5]);
    expect(pmf.truncatedMass).toBe(0);
  });

  it('builds all score PMFs with the same visit-indexed semantics', () => {
    const kernel = new Map([
      [20, new Map([[0, 1]])],
      [40, new Map([[0, 0.5], [20, 0.5]])],
    ]);
    const table = createFirstFinishPmfTable({ kernel, maximumVisits: 3 });

    expect(table.get(20)).toMatchObject({ probabilities: [1], truncatedMass: 0 });
    expect(table.get(40)?.probabilities).toEqual([0.5, 0.5]);
    expect(table.get(40)?.truncatedMass).toBe(0);
  });

  it('fails loudly when a kernel does not cover the requested score', () => {
    expect(() => createFirstFinishPmf({
      startScore: 701,
      kernel: new Map([[501, new Map([[0, 1]])]]),
    })).toThrow('Missing DartIQ visit-kernel state for score 701');
  });
});

describe('combineCurrentLegWithMatch', () => {
  it('alternates the future leg starter in the match recursion', () => {
    const result = combineCurrentLegWithMatch({
      currentLegProbabilities: [0, 1],
      legsWon: [0, 0],
      legsToWin: 2,
      nextStarterIndex: 0,
      futureLegProbabilitiesByStarter: [
        [1, 0],
        [0, 1],
      ],
    });

    expect(result.probabilities).toEqual([0, 1]);
  });

  it('is exactly the current-leg vector dotted with reusable winner continuations', () => {
    const input = {
      legsWon: [1, 0, 1],
      legsToWin: 3,
      nextStarterIndex: 2,
      futureLegProbabilitiesByStarter: [
        [0.5, 0.3, 0.2],
        [0.2, 0.6, 0.2],
        [0.25, 0.25, 0.5],
      ],
    };
    const currentLegProbabilities = [0.2, 0.3, 0.5];
    const continuations = createCurrentLegMatchContinuations(input);
    const direct = combineCurrentLegWithMatch({ ...input, currentLegProbabilities });
    const dotted = currentLegProbabilities.map((_, playerIndex) =>
      currentLegProbabilities.reduce(
        (sum, legChance, winnerIndex) =>
          sum + legChance * continuations.probabilities[winnerIndex][playerIndex],
        0
      )
    );

    dotted.forEach((probability, index) => {
      expect(probability).toBeCloseTo(direct.probabilities[index], 12);
    });
    expect(continuations.approximationMode).toBe(direct.approximationMode);
  });
});
