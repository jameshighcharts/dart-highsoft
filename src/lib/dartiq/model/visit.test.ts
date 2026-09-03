import { describe, expect, it } from 'vitest';

import type {
  DartIQDartOutcome,
  DartIQOutcomeModel,
} from './outcomes';
import { solveDartIQVisit } from './visit';

function fixedModel(outcomes: DartIQDartOutcome[]): DartIQOutcomeModel {
  return {
    version: 'behavioral-v1',
    distribution: () => ({
      outcomes,
      stateBackoffLevel: 'fallback',
      outcomeBackoffLevel: 'exact',
      confidenceTier: 'fallback',
      sampleSize: 0,
    }),
  };
}

describe('solveDartIQVisit', () => {
  it('matches a closed-form one-dart finish distribution', () => {
    const result = solveDartIQVisit(fixedModel([
      { scoreDelta: 40, isDouble: true, probability: 0.25 },
      { scoreDelta: 20, isDouble: false, probability: 0.75 },
    ]), {
      visitStartScore: 40,
      currentScore: 40,
      dartsLeft: 1,
      finishRule: 'double_out',
    });

    expect(Object.fromEntries(result)).toEqual({ '0': 0.25, '20': 0.75 });
  });

  it('routes every double-out bust back to the visit-start score', () => {
    const result = solveDartIQVisit(fixedModel([
      { scoreDelta: 2, isDouble: false, probability: 0.4 },
      { scoreDelta: 1, isDouble: false, probability: 0.6 },
    ]), {
      visitStartScore: 100,
      currentScore: 2,
      dartsLeft: 1,
      finishRule: 'double_out',
    });

    expect(Object.fromEntries(result)).toEqual({ '100': 1 });
  });

  it('keeps the irreducible partial-visit start score through recursion', () => {
    const result = solveDartIQVisit(fixedModel([
      { scoreDelta: 20, isDouble: false, probability: 0.5 },
      { scoreDelta: 40, isDouble: true, probability: 0.5 },
    ]), {
      visitStartScore: 100,
      currentScore: 40,
      dartsLeft: 2,
      finishRule: 'double_out',
    });

    expect(result.get(0)).toBeCloseTo(0.5);
    expect(result.get(100)).toBeCloseTo(0.5);
    expect([...result.values()].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it('allows any exact zero under single-out', () => {
    const result = solveDartIQVisit(fixedModel([
      { scoreDelta: 20, isDouble: false, probability: 1 },
    ]), {
      visitStartScore: 20,
      currentScore: 20,
      dartsLeft: 1,
      finishRule: 'single_out',
    });

    expect(Object.fromEntries(result)).toEqual({ '0': 1 });
  });
});
