import { describe, expect, it } from 'vitest';

import type { ScoliaRealtimeDartEvent } from './scoliaRealtimeEvent';
import type { RealtimeCommentarySnapshot } from './realtimeSnapshot';
import {
  RealtimeNarrativeWireState,
  renderRealtimeSnapshot,
  renderScoliaRealtimeEvent,
} from './realtimeWireFormat';

const PLAYER_A = '5c1f2a3b-1111-4aaa-8bbb-000000000001';
const PLAYER_B = '5c1f2a3b-2222-4aaa-8bbb-000000000002';

function snapshot(): RealtimeCommentarySnapshot {
  return {
    schemaVersion: 1,
    kind: 'match_snapshot',
    matchId: 'match-id',
    generatedAt: '2026-09-03T10:00:00.000Z',
    sequence: 1,
    scoringSource: 'scolia',
    startScore: 501,
    finishRule: 'double_out',
    legsToWin: 3,
    fairEnding: false,
    players: [
      {
        id: PLAYER_A, name: 'Nikita', playOrder: 0, score: 40, legsWon: 1,
        historicalBaseline: {
          threeDartAverage: 61.24, checkoutRate: 0.18, populationCheckoutRate: 0.12,
          bustRate: 0.04, historicalDarts: 240, profileConfidence: 0.7, profileSource: 'personal',
        },
      },
      {
        id: PLAYER_B, name: 'Ken', playOrder: 1, score: 80, legsWon: 1,
        historicalBaseline: {
          threeDartAverage: 54, checkoutRate: 0.13, populationCheckoutRate: 0.12,
          bustRate: 0.05, historicalDarts: 120, profileConfidence: 0.5, profileSource: 'personal',
        },
      },
    ],
    currentLeg: {
      id: 'leg', number: 3, startingPlayerId: PLAYER_A, currentPlayerId: PLAYER_A,
      fairEndingState: null,
    },
    matchWinnerId: null,
    rematch: null,
    narrative: {
      schemaVersion: 1,
      sequence: 1,
      biggestSwing: null,
      rematch: null,
      activeStoryArc: null,
      storyArcCandidates: [],
      players: [{
        playerId: PLAYER_A,
        completedVisits: 8,
        currentThreeDartAverage: 64.2,
        baselineThreeDartAverage: 61.2,
        baselineDelta: 3,
        baselinePerformance: 'near_baseline',
        tendencies: ['repeated 100-plus scoring'],
        checkoutPressure: {
          opportunities: 2, conversions: 1,
          highPressureOpportunities: 1, highPressureConversions: 0,
          recentMissedDoubles: [],
        },
      }],
    },
  };
}

function event(narrative = snapshot().narrative): ScoliaRealtimeDartEvent {
  return {
    schemaVersion: 1,
    kind: 'accepted_scolia_dart',
    eventId: 'event', matchId: 'match-id', legId: 'leg', legNumber: 3,
    turnId: 'turn', dartId: 'dart', playerId: PLAYER_A, playerName: 'Nikita',
    dartIndex: 1, segment: 'D20', scored: 40, turnScore: 40,
    visitDarts: [{ dartIndex: 1, segment: 'D20', scored: 40 }],
    busted: false, checkedOut: true, matchWon: false, nikitaSpecial: false,
    priority: 'marquee', shouldSpeak: true, narrative,
    dartiq: {
      schemaVersion: 2, engineVersion: 'behavioral-v1', type: 'dart', eventId: 'dartiq',
      matchId: 'match-id', legId: 'leg', legNumber: 3, turnId: 'turn', dartId: 'dart',
      sequence: 2, playerId: PLAYER_A, dartIndex: 1, segment: 'D20', scored: 40,
      turnScoreAfter: 40, scoreBefore: 40, scoreAfter: 0, busted: false, checkedOut: true,
      legProbabilityBefore: 0.52, legProbabilityAfter: 0.74,
      matchProbabilityBefore: 0.48, matchProbabilityAfter: 0.61,
      legWpa: 0.22, matchWpa: 0.13,
      consequence: { leg: 0.22, match: 0.13 },
      semanticStakes: {
        oneDartFinishAvailable: true,
        finishAvailableThisVisit: true,
        matchWinAvailableThisVisit: false,
      },
      checkout: {
        checkoutProbabilityBefore: 0.35, checkoutProbabilityAfter: 1,
        nextVisitCheckoutProbability: 1, leaveProbabilityChange: 0.65,
        createdBogey: false, avoidedBogey: false,
      },
      signals: ['checkout', 'leg_win', 'large_swing'], priority: 'marquee', shouldSpeak: true,
    },
  };
}

describe('Realtime commentary wire format', () => {
  it('renders a named, rounded snapshot without UUIDs or JSON', () => {
    const text = renderRealtimeSnapshot(2, snapshot(), new RealtimeNarrativeWireState());

    expect(text).toContain('Nikita: 40 left, 1 legs');
    expect(text).toContain('historical average 61.2');
    expect(text).not.toContain(PLAYER_A);
    expect(text).not.toContain('{');
  });

  it('renders compact dart facts and only changed narrative memory', () => {
    const state = new RealtimeNarrativeWireState();
    renderRealtimeSnapshot(1, snapshot(), state);
    const first = renderScoliaRealtimeEvent(1, event(), state);
    const changed = snapshot().narrative;
    changed.players[0] = { ...changed.players[0], currentThreeDartAverage: 70 };
    const second = renderScoliaRealtimeEvent(1, event(changed), state);

    expect(first).toContain('Nikita · leg 3 · dart 1: D20 for 40; score 40 → 0; leg won.');
    expect(first).toContain('match 48% → 61% (+13pp)');
    expect(first).not.toContain('Memory update');
    expect(second).toContain('Memory update — Nikita: average 70.0');
    expect(second).not.toContain(PLAYER_A);
    expect(second.length).toBeLessThan(700);
  });
});
