import { describe, expect, it } from 'vitest';

import { createBehavioralOutcomeModel, selectDartIQNextDartForecast, type DartIQLandingForecast } from './outcomes';

describe('next dart landing forecast eligibility', () => {
  const forecast: DartIQLandingForecast = {
    artifactId: 'geometry-1', validation: 'passed', confidence: 'high',
    segments: [{ segment: 'S20', probability: 0.5 }, { segment: 'S5', probability: 0.2 },
      { segment: 'T20', probability: 0.2 }, { segment: 'Miss', probability: 0.1 }],
  };
  it('exposes only the leading segments without renormalizing away remaining possibilities', () => {
    const result = selectDartIQNextDartForecast(forecast);
    expect(result?.segments).toHaveLength(3);
    expect(result?.segments[0]).toEqual({ segment: 'S20', probability: 0.5 });
    expect(forecast.segments).toHaveLength(4);
  });
  it('does not confuse outcome probability with validated model confidence', () => {
    expect(selectDartIQNextDartForecast(null)).toBeNull();
    expect(selectDartIQNextDartForecast({ ...forecast, confidence: 'low' })).toBeNull();
    expect(selectDartIQNextDartForecast({ ...forecast, validation: 'pending' })).toBeNull();
    expect(selectDartIQNextDartForecast({ ...forecast, validation: 'failed' })).toBeNull();
    expect(selectDartIQNextDartForecast({ ...forecast, artifactId: '' })).toBeNull();
  });
  it('rejects invalid, duplicate, or unnormalized landing vectors', () => {
    for (const segments of [[], [{ segment: 'T25', probability: 1 }],
      [{ segment: 'S20', probability: NaN }], [{ segment: 'S20', probability: 0.9 }],
      [{ segment: 'S20', probability: 0.5 }, { segment: 'S20', probability: 0.5 }]]) {
      expect(selectDartIQNextDartForecast({ ...forecast, segments })).toBeNull();
    }
  });
});

describe('createBehavioralOutcomeModel', () => {
  it('keeps global, class, and exact samples disjoint when their outcomes coincide', () => {
    const context = { currentScore: 40, dartsLeft: 1 as const, finishRule: 'double_out' as const };
    const personal = [
      { ...context, currentScore: 301, scoreDelta: 20, isDouble: false, count: 50 },
      { ...context, currentScore: 32, scoreDelta: 20, isDouble: false, count: 30 },
      { ...context, scoreDelta: 20, isDouble: false, count: 10 },
      { ...context, scoreDelta: 20, isDouble: false, count: 5 },
    ];
    const prior = createBehavioralOutcomeModel().distribution(context);
    const model = createBehavioralOutcomeModel({ personal, population: personal, exactOutcomeThreshold: 1 });
    const result = model.distribution(context);
    const probability = (value: typeof result) => value.outcomes.find((row) => row.scoreDelta === 20 && !row.isDouble)!.probability;
    const global = (probability(prior) * 24 + 50) / (24 + 50);
    const scoreClass = (global * 24 + 30) / (24 + 30);
    expect(probability(result)).toBeCloseTo((scoreClass * 24 + 15) / (24 + 15), 12);
    expect(result.sampleSize).toBe(95);
    expect(result.exactStateSampleSize).toBe(15);
    // Reading a different state must not mutate the shared aggregate pools.
    model.distribution({ ...context, currentScore: 32 });
    expect(model.distribution(context)).toEqual(result);
    expect(personal.map((row) => row.count)).toEqual([50, 30, 10, 5]);
  });

  it('counts a sparse exact checkout sample once, not again as class/global evidence', () => {
    const context = { currentScore: 40, dartsLeft: 1 as const, finishRule: 'double_out' as const };
    const observation = { ...context, scoreDelta: 40, isDouble: true, count: 3 };
    const prior = createBehavioralOutcomeModel().distribution(context);
    const result = createBehavioralOutcomeModel({ personal: [observation], population: [observation] }).distribution(context);
    const finish = (distribution: typeof result) => distribution.outcomes.find((row) => row.isDouble && row.scoreDelta === 40)!.probability;
    expect(finish(result)).toBeCloseTo((finish(prior) * 24 + 3) / 27);
    expect(result.sampleSize).toBe(3);
    expect(result.exactStateSampleSize).toBe(3);
    expect(result.confidenceTier).toBe('player_sparse');
  });

  it('does not label an unseen checkout established because the player has many scoring darts', () => {
    const result = createBehavioralOutcomeModel({ personal: [{
      currentScore: 501, dartsLeft: 1, finishRule: 'double_out', scoreDelta: 20, isDouble: false, count: 500,
    }] }).distribution({ currentScore: 40, dartsLeft: 1, finishRule: 'double_out' });
    expect(result.confidenceTier).toBe('player_sparse');
    expect(result.exactStateSampleSize).toBe(0);
  });
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

  it('does not add separate sparse exact-state layers into fictional exact support', () => {
    const observation = {
      currentScore: 40,
      dartsLeft: 1 as const,
      finishRule: 'double_out' as const,
      scoreDelta: 40,
      isDouble: true,
      count: 20,
    };
    const result = createBehavioralOutcomeModel({
      population: [observation],
      personal: [observation],
      exactOutcomeThreshold: 40,
    }).distribution({ currentScore: 40, dartsLeft: 1, finishRule: 'double_out' });

    expect(result.outcomeBackoffLevel).toBe('family');
    expect(result.exactStateSampleSize).toBe(20);
  });

  it('does not let state-agnostic personal evidence overwrite exact population shape', () => {
    const model = createBehavioralOutcomeModel({
      population: [{
        currentScore: 40,
        dartsLeft: 1,
        finishRule: 'double_out',
        scoreDelta: 40,
        isDouble: true,
        count: 120,
      }],
      personal: [{
        currentScore: 501,
        dartsLeft: 1,
        finishRule: 'double_out',
        scoreDelta: 0,
        isDouble: false,
        count: 500,
      }],
      priorStrength: 24,
      exactOutcomeThreshold: 40,
    });

    const result = model.distribution({
      currentScore: 40,
      dartsLeft: 1,
      finishRule: 'double_out',
    });

    expect(result.stateBackoffLevel).toBe('population_exact');
    expect(result.outcomes.find((outcome) => outcome.scoreDelta === 40 && outcome.isDouble)
      ?.probability).toBeGreaterThan(0.8);
  });
});
