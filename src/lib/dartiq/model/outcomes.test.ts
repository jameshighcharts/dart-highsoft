import { describe, expect, it } from 'vitest';

import { createBehavioralOutcomeModel } from './outcomes';

describe('createBehavioralOutcomeModel', () => {
  it('returns a normalized physical fallback distribution', () => {
    const result = createBehavioralOutcomeModel().distribution({
      currentScore: 501,
      dartsLeft: 3,
      finishRule: 'double_out',
    });

    expect(result.stateBackoffLevel).toBe('fallback');
    expect(result.confidenceTier).toBe('fallback');
    expect(result.outcomes.every((outcome) => outcome.probability >= 0)).toBe(true);
    expect(result.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(1);
  });

  it('uses exact player state evidence when it exists', () => {
    const model = createBehavioralOutcomeModel({
      personal: [{
        currentScore: 40,
        dartsLeft: 1,
        finishRule: 'double_out',
        scoreDelta: 40,
        isDouble: true,
        count: 100,
      }],
      priorStrength: 1,
      exactOutcomeThreshold: 40,
    });
    const result = model.distribution({
      currentScore: 40,
      dartsLeft: 1,
      finishRule: 'double_out',
    });

    expect(result.stateBackoffLevel).toBe('player_exact');
    expect(result.outcomeBackoffLevel).toBe('exact');
    expect(result.outcomes.find((outcome) => outcome.scoreDelta === 40 && outcome.isDouble)
      ?.probability).toBeGreaterThan(0.98);
  });

  it('coarsens sparse non-double outcomes but retains exact doubles', () => {
    const model = createBehavioralOutcomeModel({
      population: [{
        currentScore: 40,
        dartsLeft: 1,
        finishRule: 'double_out',
        scoreDelta: 40,
        isDouble: true,
        count: 3,
      }],
      priorStrength: 1,
      exactOutcomeThreshold: 40,
    });
    const result = model.distribution({
      currentScore: 40,
      dartsLeft: 1,
      finishRule: 'double_out',
    });

    expect(result.outcomeBackoffLevel).toBe('family');
    expect(result.outcomes.find((outcome) => outcome.scoreDelta === 40 && outcome.isDouble)
      ?.probability).toBeGreaterThan(0.7);
    expect(result.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(1);
  });
});
