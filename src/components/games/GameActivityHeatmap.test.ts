import { describe, expect, it } from 'vitest';
import { activityLevel, activityThresholds } from './GameActivityHeatmap';

describe('activityLevel', () => {
  it('returns 0 for days with no games', () => {
    expect(activityLevel(0, 13)).toBe(0);
  });

  it('gives the busiest day the darkest level', () => {
    expect(activityLevel(13, 13)).toBe(6);
    expect(activityLevel(1, 1)).toBe(6);
  });

  it('separates a 4-game day from a 13-game day', () => {
    expect(activityLevel(4, 13)).toBeLessThan(activityLevel(13, 13));
    expect(activityLevel(4, 13)).toBe(2);
  });

  it('never drops a non-zero day to level 0', () => {
    expect(activityLevel(1, 100)).toBe(1);
  });

  it('is monotonic in count', () => {
    for (let count = 1; count < 13; count++) {
      expect(activityLevel(count + 1, 13)).toBeGreaterThanOrEqual(activityLevel(count, 13));
    }
  });
});

describe('activityThresholds', () => {
  it('produces increasing thresholds starting at 1', () => {
    const thresholds = activityThresholds(13);
    expect(thresholds[0]).toBe(1);
    for (let i = 1; i < thresholds.length; i++) expect(thresholds[i]).toBeGreaterThanOrEqual(thresholds[i - 1]);
    expect(thresholds).toHaveLength(6);
  });
});
