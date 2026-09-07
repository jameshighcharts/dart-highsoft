import { describe, expect, it } from 'vitest';

import { detectedThrowFromMessage } from '@/lib/scolia/protocol';
import { parseSegmentLabel } from '@/utils/legScoreCalculator';
import { isNikitaSpecial } from '@/utils/nikitaSpecial';
import { applyThrow } from '@/utils/x01';

import {
  BROADCAST_DIRECTOR_DEMO,
  COMMENTARY_DEMO_PLAYERS,
  commentaryDemoSummary,
} from './commentaryDemoScenario';

describe('BROADCAST_DIRECTOR_DEMO', () => {
  it('is a valid six-player 301 double-out leg with Ada winning on D16', () => {
    const scores = Object.fromEntries(COMMENTARY_DEMO_PLAYERS.map((player) => [player, 301]));
    let winner: string | null = null;

    BROADCAST_DIRECTOR_DEMO.forEach((visit, visitIndex) => {
      expect(visit.player).toBe(COMMENTARY_DEMO_PLAYERS[visitIndex % COMMENTARY_DEMO_PLAYERS.length]);
      const visitStart = scores[visit.player];
      for (const [dartIndex, dart] of visit.darts.entries()) {
        expect(winner).toBeNull();
        const outcome = applyThrow(scores[visit.player], parseSegmentLabel(dart.segment), 'double_out');
        expect(outcome.busted).toBe(false);
        scores[visit.player] = outcome.newScore;
        if (outcome.finished) {
          expect(visitIndex).toBe(BROADCAST_DIRECTOR_DEMO.length - 1);
          expect(dartIndex).toBe(visit.darts.length - 1);
          winner = visit.player;
        }
      }
      if (scores[visit.player] > visitStart) {
        throw new Error('The demo unexpectedly increased a score');
      }
    });

    expect(winner).toBe('Ada');
    expect(scores).toEqual({ Ada: 0, Ben: 32, Jo: 32, Max: 16, Liv: 36, Sam: 16 });
    expect(BROADCAST_DIRECTOR_DEMO.at(-1)?.darts.at(-1)).toMatchObject({
      segment: 'D16',
      scored: 32,
    });
  });

  it('gives the whole office a long turn without spamming Nikita specials', () => {
    const visitsByPlayer = Object.fromEntries(COMMENTARY_DEMO_PLAYERS.map((player) => [player, 0]));
    for (const visit of BROADCAST_DIRECTOR_DEMO) visitsByPlayer[visit.player] += 1;

    expect(visitsByPlayer).toEqual({ Ada: 6, Ben: 5, Jo: 5, Max: 5, Liv: 5, Sam: 5 });
    expect(BROADCAST_DIRECTOR_DEMO).toHaveLength(31);
    expect(BROADCAST_DIRECTOR_DEMO.filter((visit) => isNikitaSpecial(visit.darts))).toHaveLength(0);
  });

  it('contains varied, deterministic commentary beats', () => {
    const summary = commentaryDemoSummary();
    expect(summary[0]).toMatchObject({ round: 1, player: 'Ada', score: 41 });
    expect(summary.some((visit) => visit.score === 100)).toBe(true);
    expect(summary.some((visit) => visit.darts.includes('T19'))).toBe(true);
    expect(summary.some((visit) => visit.darts.includes('D11'))).toBe(true);
    expect(summary.filter((visit) => visit.darts.includes('Miss')).length).toBeGreaterThanOrEqual(12);
    expect(summary.at(-1)?.purpose).toContain('office epic');
  });

  it('uses Scolia sectors that reproduce every declared segment and score', () => {
    for (const visit of BROADCAST_DIRECTOR_DEMO) {
      for (const dart of visit.darts) {
        expect(detectedThrowFromMessage({
          type: 'THROW_DETECTED',
          id: 'demo-dart',
          payload: {
            sector: dart.sector,
            bounceout: dart.sector === 'None',
          },
        })).toMatchObject({ segment: dart.segment, scored: dart.scored });
      }
    }
  });
});
