import { describe, expect, it } from 'vitest';
import { createAdaptiveDartIQModel, landingSegment, monitorDartIQDeployment, trainDartIQArtifact, validateDartIQArtifact,
  type DartIQTrainingDart } from './training';

function history(start = 0, matches = 35): DartIQTrainingDart[] {
  return Array.from({ length: matches }, (_, i) => Array.from({ length: 20 }, (_, dart) => ({
    id: `${start + i}-${dart}`, matchId: `match-${start + i}`, playerId: 'a', currentScore: 301,
    finishRule: 'double_out' as const, dartsLeft: 3 as const, segment: 'S20', x: 0, y: 130,
    matchCreatedAt: new Date(Date.UTC(2026, 0, 1 + start + i)).toISOString(),
    completedAt: new Date(Date.UTC(2026, 0, 1 + start + i, 1)).toISOString(),
  }))).flat();
}

describe('automatic DartIQ training', () => {
  it('uses physical millimetres and Scolia orientation, including bulls and neighbours', () => {
    expect(landingSegment(0, 103)).toBe('T20');
    expect(landingSegment(0, 166)).toBe('D20');
    expect(landingSegment(0, 130)).toBe('S20');
    expect(landingSegment(0, -130)).toBe('S3');
    expect(landingSegment(130, 0)).toBe('S6');
    expect(landingSegment(0, 0)).toBe('DB');
    expect(landingSegment(10, 0)).toBe('SB');
    expect(landingSegment(0, 171)).toBe('Miss');
  });

  it('requires independent match support and fits compact deterministic artifacts', () => {
    expect(trainDartIQArtifact(history(0, 10))).toBeNull();
    const rows = history();
    const artifact = trainDartIQArtifact(rows)!;
    expect(artifact.matchCount).toBe(35);
    expect(artifact.population).toHaveLength(1);
    expect(artifact.population[0].count).toBe(700);
    expect(artifact.geometry['a:double_out:3'].S20).toBe(700);
    expect(trainDartIQArtifact(rows)).toEqual(artifact);
    expect(() => trainDartIQArtifact([...rows, rows[0]])).toThrow('Invalid');
  });

  it('does not learn from contradictory coordinates or treat unvalidated contexts as confident', () => {
    const rows = history().map((row) => ({ ...row, x: 130, y: 0 }));
    expect(trainDartIQArtifact(rows)!.geometry).toEqual({});
    const artifact = trainDartIQArtifact(history())!;
    const model = createAdaptiveDartIQModel({ playerId: 'a', deployment: { id: 'frozen', artifact, geometryContexts: ['a:double_out:3'] } });
    const scoring = { currentScore: 301, finishRule: 'double_out' as const, dartsLeft: 3 as const };
    expect(model.predictLanding?.(scoring)?.confidence).toBe('high');
    expect(model.predictLanding?.({ ...scoring, dartsLeft: 2 })).toBeNull();
    expect(model.predictLanding?.({ ...scoring, currentScore: 40 })).toBeNull();
    expect(model.distribution(scoring).outcomes.reduce((sum, row) => sum + row.probability, 0)).toBeCloseTo(1, 12);
    expect(model.distribution(scoring)).toBe(model.distribution(scoring));
    expect(createAdaptiveDartIQModel({ playerId: 'a' }).predictLanding).toBeUndefined();
  });

  it('validates only later matches and never changes the fitted artifact', () => {
    const artifact = trainDartIQArtifact(history())!;
    const before = JSON.stringify(artifact);
    const cutoff = new Date(Date.UTC(2026, 1, 6)).toISOString();
    const empty = validateDartIQArtifact(artifact, cutoff, history(), null);
    expect(empty.eligible).toBe(false);
    expect(empty.baseline.matches).toBe(0);
    const validated = validateDartIQArtifact(artifact, cutoff, history(40), null);
    expect(validated.baseline.matches).toBe(35);
    expect(validated.eligible).toBe(true);
    expect(validated.matchWinCalibrationProven).toBe(false);
    expect(JSON.stringify(artifact)).toBe(before);
    expect(() => validateDartIQArtifact(artifact, history()[0].matchCreatedAt, history(), null)).toThrow('cutoff');
  });

  it('does not roll back on thin data and detects a supported geometry regression', () => {
    const artifact = trainDartIQArtifact(history())!;
    const active = { id: 'active', artifact, geometryContexts: ['a:double_out:3'] };
    const later = history(40).map((row) => ({ ...row, segment: 'S5', x: null, y: null }));
    const cutoff = new Date(Date.UTC(2026, 1, 6)).toISOString();
    expect(monitorDartIQDeployment(active, cutoff, later.slice(0, 20), null).rollback).toBe(false);
    expect(monitorDartIQDeployment(active, cutoff, later, null).baseline.matches).toBe(35);
    expect(monitorDartIQDeployment(active, cutoff, later, null).rollback).toBe(true);
  });

  it('automatically enables a supported geometry context through training and future validation', () => {
    const rows = history().map((row, index) => index % 5 === 0 ? row : {
      ...row, playerId: 'b', finishRule: 'single_out' as const, segment: 'SB', x: null, y: null,
    });
    const artifact = trainDartIQArtifact(rows)!;
    const validated = validateDartIQArtifact(artifact, new Date(Date.UTC(2026, 1, 6)).toISOString(), history(40), null);
    expect(validated.eligible).toBe(true);
    expect(validated.geometryContexts).toContain('a:double_out:3');
    const model = createAdaptiveDartIQModel({ playerId: 'a', deployment: { id: 'activated', artifact, geometryContexts: validated.geometryContexts } });
    expect(model.predictLanding?.({ currentScore: 301, finishRule: 'double_out', dartsLeft: 3 })?.confidence).toBe('high');
    expect(model.predictLanding?.({ currentScore: 40, finishRule: 'double_out', dartsLeft: 3 })).toBeNull();
  });
});
