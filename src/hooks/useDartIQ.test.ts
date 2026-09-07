import { describe, expect, it } from 'vitest';

import {
  normalizeDartIQPlayerProfile,
  normalizeDartIQPopulationProfile,
} from '@/lib/dartiq/evidence';

describe('DartIQ evidence row normalization', () => {
  it('normalizes Postgres numeric strings for a player profile', () => {
    expect(normalizeDartIQPlayerProfile({
      player_id: 'a', finish_rule: 'double_out', matches_played: '12', visits: '90',
      darts_thrown: '270', scoring_points: '5400', three_dart_average: '60.00',
      busts: '4', bust_rate: '0.0444', checkout_opportunities: '30', checkouts: '8',
      checkout_rate: '0.2667',
    })).toMatchObject({
      playerId: 'a', matchesPlayed: 12, dartsThrown: 270,
      threeDartAverage: 60, checkoutRate: 0.2667,
    });
  });

  it('uses player-match samples as the population sample count', () => {
    expect(normalizeDartIQPopulationProfile({
      finish_rule: 'single_out', player_match_samples: '44', visits: '400',
      darts_thrown: '1200', scoring_points: '22000', three_dart_average: '55',
      busts: '3', bust_rate: '0.0075', checkout_opportunities: '100', checkouts: '50',
      checkout_rate: '0.5',
    })).toMatchObject({ matchesPlayed: 44, finishRule: 'single_out', visits: 400 });
  });
});
