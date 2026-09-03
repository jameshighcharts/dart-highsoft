import { describe, expect, it } from 'vitest';

import type { DartIQPlayerHistoryProfile, DartIQPopulationProfile } from './evidence';
import { createDartIQSkillModel } from './evidence';

function profile(overrides: Partial<DartIQPlayerHistoryProfile> = {}): DartIQPlayerHistoryProfile {
  return {
    playerId: 'a', finishRule: 'double_out', matchesPlayed: 10, visits: 100,
    dartsThrown: 300, scoringPoints: 6000, threeDartAverage: 60,
    busts: 5, bustRate: 0.05, checkoutOpportunities: 40, checkouts: 10,
    checkoutRate: 0.25, ...overrides,
  };
}

function population(overrides: Partial<DartIQPopulationProfile> = {}): DartIQPopulationProfile {
  return { ...profile(), dartsThrown: 10_000, visits: 3_000, ...overrides };
}

describe('createDartIQSkillModel', () => {
  it('uses conservative fallbacks without history', () => {
    expect(createDartIQSkillModel()).toMatchObject({
      threeDartAverage: 45,
      checkoutRate: 0.12,
      bustRate: 0.04,
      profileSource: 'fallback',
      profileConfidence: 0,
    });
  });

  it('uses the installation population for a new player', () => {
    const result = createDartIQSkillModel(undefined, population({ threeDartAverage: 57 }));
    expect(result.profileSource).toBe('population');
    expect(result.threeDartAverage).toBeGreaterThan(55);
    expect(result.threeDartAverage).toBeLessThan(57);
  });

  it('shrinks a small personal sample strongly toward the population', () => {
    const result = createDartIQSkillModel(
      profile({ dartsThrown: 9, visits: 3, threeDartAverage: 100, checkoutOpportunities: 2, checkoutRate: 1 }),
      population({ threeDartAverage: 50, checkoutRate: 0.18 })
    );
    expect(result.threeDartAverage).toBeLessThan(55);
    expect(result.checkoutRate).toBeLessThan(0.25);
  });

  it('lets substantial personal history meaningfully drive the model', () => {
    const result = createDartIQSkillModel(
      profile({ dartsThrown: 3_000, visits: 1_000, threeDartAverage: 72, checkoutOpportunities: 400, checkoutRate: 0.31 }),
      population({ threeDartAverage: 48, checkoutRate: 0.14 })
    );
    expect(result.profileSource).toBe('personal');
    expect(result.profileConfidence).toBeGreaterThan(0.95);
    expect(result.threeDartAverage).toBeGreaterThan(70);
    expect(result.checkoutRate).toBeGreaterThan(0.29);
  });
});
