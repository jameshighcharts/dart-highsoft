import { describe, expect, it } from 'vitest';

import {
  calibrationObservationFromPersisted,
  compareDartIQCalibrationCandidate,
  evaluateDartIQCalibration,
  evaluateDartIQContinuousWindow,
  evaluateDartIQFrozenCandidate,
  temperatureScaleDartIQ,
  type DartIQContinuousObservation,
  type DartIQCalibrationObservation,
  type DartIQCandidateObservation,
} from './calibration';

const slices = {
  finishRule: 'double_out',
  playerCount: 2,
  scoreBand: '1_40',
  checkoutState: 'available',
  actorConfidenceTier: 'player_established',
  cohort: 'manual',
};

function continuous(index: number, overrides: Partial<DartIQContinuousObservation> = {}): DartIQContinuousObservation {
  const start = Date.UTC(2026, 0, 1) + index * 3_600_000;
  return {
    id: `event-${index}`, matchId: `match-${index}`,
    matchCreatedAt: new Date(start).toISOString(),
    evidenceCutoff: new Date(start).toISOString(),
    recordedAt: new Date(start + 60_000).toISOString(),
    completedAt: new Date(start + 120_000).toISOString(),
    winnerPlayerId: 'a', probabilities: { a: 0.7, b: 0.3 }, slices,
    ...overrides,
  };
}

describe('continuous calibration', () => {
  it('evaluates a frozen candidate only on matches started strictly after it was saved', () => {
    const rows = Array.from({ length: 10 }, (_, i) => continuous(i));
    const candidate = { reportId: '1', frozenAt: rows[5].matchCreatedAt,
      family: 'temperature_scaling' as const, temperature: 1.15, sourceFingerprint: 'frozen-source' };
    const report = evaluateDartIQFrozenCandidate(rows, candidate);
    expect(report).toMatchObject({ eventCount: 4, matchCount: 4, excludedEventCount: 6,
      predictionsEmittedLive: false, promotionEnabled: false, recommendation: 'insufficient_data', candidate });
    expect(report.matchBalancedValidation.candidate.brier).toBeGreaterThan(report.matchBalancedValidation.baseline.brier);
    const changed = evaluateDartIQFrozenCandidate(rows.map((row) => ({ ...row, winnerPlayerId: 'b' })), candidate);
    expect(changed.candidate.temperature).toBe(1.15);
  });

  it('waits for later matches and rejects unsupported frozen candidates', () => {
    const candidate = { reportId: '1', frozenAt: continuous(10).matchCreatedAt,
      family: 'temperature_scaling' as const, temperature: 0.85, sourceFingerprint: 'frozen-source' };
    expect(evaluateDartIQFrozenCandidate([continuous(0)], candidate)).toMatchObject({ comparison: null, eventCount: 0 });
    expect(() => evaluateDartIQFrozenCandidate([], { ...candidate, temperature: 2 })).toThrow('Invalid');
    expect(() => evaluateDartIQFrozenCandidate([], { ...candidate, temperature: 1 })).toThrow('Invalid');
    expect(() => evaluateDartIQFrozenCandidate([], { ...candidate, frozenAt: 'invalid' })).toThrow();
    const invalid = continuous(11, { recordedAt: continuous(11).completedAt });
    expect(() => evaluateDartIQFrozenCandidate([invalid], candidate)).toThrow('before resolution');
  });

  it('monitors small windows without enabling promotion or geometry inference', () => {
    const report = evaluateDartIQContinuousWindow([continuous(0, { geometryAvailable: true, approximationModes: ['weighted_tiebreak'] })]);
    expect(report).toMatchObject({ recommendation: 'insufficient_data', promotionEnabled: false,
      geometryModelEnabled: false, geometryEventCount: 1, geometryMatchCount: 1, approximatedEventCount: 1 });
    expect(evaluateDartIQContinuousWindow([]).monitoring.outcomeKind).toBe('match');
  });

  it('keeps whole matches together and excludes matches overlapping training outcomes', () => {
    const rows = Array.from({ length: 100 }, (_, i) => continuous(i));
    rows[60] = continuous(60, { matchCreatedAt: rows[59].matchCreatedAt, evidenceCutoff: rows[59].evidenceCutoff });
    rows.push({ ...rows[0], id: 'second-dart' });
    const report = evaluateDartIQContinuousWindow(rows);
    expect(report).toMatchObject({ trainingMatches: 60, validationMatches: 39, overlappingMatchesExcluded: 1 });
    expect(report.trainingCutoff).toBe(rows[59].completedAt);
  });

  it('selects temperature from training only, even when validation prefers the opposite', () => {
    const rows = Array.from({ length: 100 }, (_, i) => continuous(i));
    const original = evaluateDartIQContinuousWindow(rows);
    const reversed = evaluateDartIQContinuousWindow(rows.map((row, i) => i < 60 ? row : { ...row, winnerPlayerId: 'b' }));
    expect(original.temperature).toBe(0.85);
    expect(reversed.temperature).toBe(original.temperature);
    expect(reversed.recommendation).not.toBe('recommend_for_review');
  });

  it('balances matches rather than letting longer matches dominate loss', () => {
    const first = continuous(0);
    const second = continuous(1, { winnerPlayerId: 'b' });
    const original = evaluateDartIQContinuousWindow([first, second]);
    const repeated = evaluateDartIQContinuousWindow([first, ...Array.from({ length: 40 }, (_, i) => ({ ...second, id: `repeat-${i}` }))]);
    expect(repeated.matchBalancedMonitoring.brier).toBeCloseTo(original.matchBalancedMonitoring.brier, 12);
    expect(repeated.matchBalancedMonitoring.logLoss).toBeCloseTo(original.matchBalancedMonitoring.logLoss, 12);
  });

  it('rejects duplicated, post-resolution, future-evidence, or inconsistent observations', () => {
    const row = continuous(0);
    expect(() => evaluateDartIQContinuousWindow([row, row])).toThrow('Duplicate');
    expect(() => evaluateDartIQContinuousWindow([{ ...row, recordedAt: row.completedAt }])).toThrow('before resolution');
    expect(() => evaluateDartIQContinuousWindow([{ ...row, evidenceCutoff: row.recordedAt }])).toThrow('frozen earlier');
    expect(() => evaluateDartIQContinuousWindow([row, { ...row, id: 'other', winnerPlayerId: 'b' }])).toThrow('Inconsistent');
    expect(() => evaluateDartIQContinuousWindow([{ ...row, probabilities: { a: 0.7, b: 0.8 } }])).toThrow();
  });

  it('preserves impossible outcomes and rejects invalid transform inputs', () => {
    expect(temperatureScaleDartIQ({ a: 1, b: 0 }, 0.85)).toEqual({ a: 1, b: 0 });
    const vector = temperatureScaleDartIQ({ a: 0.6, b: 0.3, c: 0.1 }, 1.15);
    expect(Object.values(vector).reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 12);
    expect(() => temperatureScaleDartIQ({ a: -0.1, b: 1 }, 0.5)).toThrow();
    expect(() => temperatureScaleDartIQ({ a: 0.5, b: 0.5 }, 0)).toThrow();
  });
});

function observation(
  id: string,
  winnerPlayerId: 'a' | 'b',
  probabilities: Record<string, number>
): DartIQCalibrationObservation {
  return {
    id,
    matchId: `match-${id}`,
    outcomeKind: 'leg',
    occurredAt: '2026-02-01T00:00:00.000Z',
    winnerPlayerId,
    probabilities,
    slices,
    validation: { method: 'held_out', trainingCutoff: '2026-01-01T00:00:00.000Z' },
  };
}

function candidateRow(
  id: string,
  winnerPlayerId: 'a' | 'b',
  baselineProbabilities: Record<string, number>,
  candidateProbabilities: Record<string, number>,
  overrides: Partial<DartIQCandidateObservation> = {}
): DartIQCandidateObservation {
  return {
    ...observation(id, winnerPlayerId, baselineProbabilities),
    baselineProbabilities,
    candidateProbabilities,
    ...overrides,
  };
}

const permissiveGates = {
  minimumEvents: 2,
  minimumMatches: 2,
  minimumEventsPerFold: 1,
  minimumValidationFolds: 2,
  minimumEventsPerSlice: 2,
  minimumMatchesPerSlice: 2,
  minimumQualifiedSliceDimensions: 6,
  minimumBrierImprovement: 0.01,
  maximumOverallLogLossRegression: 0,
  maximumOverallCalibrationErrorRegression: 1,
  maximumSliceBrierRegression: 0,
  maximumSliceLogLossRegression: 0,
};

describe('evaluateDartIQCalibration', () => {
  it('adapts persisted evidence using match time rather than reconstruction time', () => {
    const adapted = calibrationObservationFromPersisted({
      projectionEventId: 'projection-1',
      matchId: 'match-1',
      outcomeKind: 'leg',
      matchCreatedAt: '2026-02-01T00:00:00.000Z',
      historicalEvidenceCutoffAt: '2026-02-01T00:00:00.000Z',
      winnerPlayerId: 'a',
      probabilities: { a: 0.7, b: 0.3 },
      finishRule: 'double_out',
      playerCount: 2,
      scoreBand: '1_40',
      checkoutState: 'available',
      actorConfidenceTier: 'player_established',
      cohort: 'scolia',
      validation: { method: 'held_out', trainingCutoff: '2026-01-01T00:00:00.000Z' },
    });

    expect(adapted.occurredAt).toBe('2026-02-01T00:00:00.000Z');
    expect(adapted.slices).toMatchObject({
      actorConfidenceTier: 'player_established',
      cohort: 'scolia',
    });
    expect(() => calibrationObservationFromPersisted({
      ...adapted,
      projectionEventId: adapted.id,
      matchCreatedAt: '2026-02-01T00:00:00.000Z',
      historicalEvidenceCutoffAt: '2026-02-02T00:00:00.000Z',
      finishRule: adapted.slices.finishRule,
      playerCount: adapted.slices.playerCount,
      scoreBand: adapted.slices.scoreBand,
      checkoutState: adapted.slices.checkoutState,
      actorConfidenceTier: adapted.slices.actorConfidenceTier,
      cohort: 'scolia',
    })).toThrow(/cannot follow match creation/);
  });

  it('computes full-vector multiclass Brier, log loss, and class reliability', () => {
    const report = evaluateDartIQCalibration([
      observation('one', 'a', { a: 0.75, b: 0.25 }),
      observation('two', 'b', { a: 0.25, b: 0.75 }),
    ], { reliabilityBucketCount: 4 });

    expect(report.metrics.eventCount).toBe(2);
    expect(report.metrics.matchCount).toBe(2);
    expect(report.metrics.classPredictionCount).toBe(4);
    expect(report.metrics.multiclassBrierScore).toBeCloseTo(0.125);
    expect(report.metrics.logLoss).toBeCloseTo(-Math.log(0.75));
    expect(report.reliability).toHaveLength(4);
    expect(report.reliability[1]).toMatchObject({
      predictionCount: 2,
      meanPredictedProbability: 0.25,
      observedFrequency: 0,
    });
    expect(report.reliability[3]).toMatchObject({
      predictionCount: 2,
      meanPredictedProbability: 0.75,
      observedFrequency: 1,
    });
    expect(report.slices.find((slice) => slice.key === 'finishRule=double_out')?.metrics.eventCount)
      .toBe(2);
  });

  it('scores every class in a multiplayer vector rather than only the winner', () => {
    const report = evaluateDartIQCalibration([{
      ...observation('three-player', 'a', { a: 0.6, b: 0.3, c: 0.1 }),
      slices: { ...slices, playerCount: 3 },
    }]);

    expect(report.metrics.classPredictionCount).toBe(3);
    expect(report.metrics.multiclassBrierScore).toBeCloseTo(0.26);
  });

  it('rejects invalid, incomplete, and in-sample probability evidence', () => {
    expect(() => evaluateDartIQCalibration([
      observation('bad-sum', 'a', { a: 0.6, b: 0.3 }),
    ])).toThrow(/sums to/);
    expect(() => evaluateDartIQCalibration([
      observation('missing-winner', 'a', { b: 0.5, c: 0.5 }),
    ])).toThrow(/winner is absent/);
    expect(() => evaluateDartIQCalibration([{
      ...observation('leaked', 'a', { a: 0.5, b: 0.5 }),
      occurredAt: '2025-12-31T00:00:00.000Z',
    }])).toThrow(/not out-of-sample/);
    expect(() => evaluateDartIQCalibration([
      observation('leg', 'a', { a: 0.5, b: 0.5 }),
      { ...observation('match', 'a', { a: 0.5, b: 0.5 }), outcomeKind: 'match' },
    ])).toThrow(/cannot mix leg and match/);
  });
});

describe('compareDartIQCalibrationCandidate', () => {
  it('recommends a materially better held-out candidate for human review', () => {
    const result = compareDartIQCalibrationCandidate([
      candidateRow('one', 'a', { a: 0.5, b: 0.5 }, { a: 0.8, b: 0.2 }),
      candidateRow('two', 'b', { a: 0.5, b: 0.5 }, { a: 0.2, b: 0.8 }),
    ], permissiveGates);

    expect(result.recommendation).toBe('recommend_for_review');
    expect(result.failures).toEqual([]);
    expect(result.qualifiedSliceCount).toBe(6);
    expect(result.candidate.metrics.multiclassBrierScore)
      .toBeLessThan(result.baseline.metrics.multiclassBrierScore);
  });

  it('rejects a candidate that regresses inside a qualified slice', () => {
    const rows = [
      candidateRow('checkout-a', 'a', { a: 0.7, b: 0.3 }, { a: 0.45, b: 0.55 }),
      candidateRow('checkout-b', 'b', { a: 0.3, b: 0.7 }, { a: 0.55, b: 0.45 }),
      candidateRow('open-a', 'a', { a: 0.5, b: 0.5 }, { a: 0.99, b: 0.01 }, {
        slices: { ...slices, checkoutState: 'none' },
      }),
      candidateRow('open-b', 'b', { a: 0.5, b: 0.5 }, { a: 0.01, b: 0.99 }, {
        slices: { ...slices, checkoutState: 'none' },
      }),
    ];
    const result = compareDartIQCalibrationCandidate(rows, {
      ...permissiveGates,
      minimumEvents: 4,
      minimumMatches: 4,
    });

    expect(result.recommendation).toBe('reject');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'slice_brier_regression',
        sliceKey: 'checkoutState=available',
      }),
    ]));
  });

  it('reports insufficient data instead of approving a sparse result', () => {
    const result = compareDartIQCalibrationCandidate([
      candidateRow('one', 'a', { a: 0.5, b: 0.5 }, { a: 0.8, b: 0.2 }),
    ], permissiveGates);

    expect(result.recommendation).toBe('insufficient_data');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'insufficient_events' }),
    ]));
  });

  it('requires paired candidates to use the same player support', () => {
    expect(() => compareDartIQCalibrationCandidate([
      candidateRow('misaligned', 'a', { a: 0.5, b: 0.5 }, { a: 0.5, c: 0.5 }),
    ], permissiveGates)).toThrow(/do not align/);
  });

  it('requires enough genuinely future walk-forward folds', () => {
    const walkForward = (fold: number, id: string): DartIQCandidateObservation => candidateRow(
      id,
      fold === 1 ? 'a' : 'b',
      { a: 0.5, b: 0.5 },
      fold === 1 ? { a: 0.8, b: 0.2 } : { a: 0.2, b: 0.8 },
      {
        occurredAt: `2026-0${fold + 1}-01T00:00:00.000Z`,
        validation: {
          method: 'walk_forward',
          fold,
          trainingCutoff: `2026-0${fold}-01T00:00:00.000Z`,
        },
      }
    );
    const result = compareDartIQCalibrationCandidate([
      walkForward(1, 'fold-one'),
      walkForward(2, 'fold-two'),
    ], permissiveGates);

    expect(result.validationMethod).toBe('walk_forward');
    expect(result.recommendation).toBe('recommend_for_review');
  });
});
