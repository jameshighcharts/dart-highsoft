import { describe, expect, it, vi } from 'vitest';
import { createBehavioralOutcomeModel, type DartIQLandingForecast } from './model/outcomes';

import type { LegRecord, ThrowRecord, TurnWithThrows } from '@/lib/match/types';
import { DartIQTracker } from './tracker';

function dart(id: string, turnId: string, dartIndex: number, segment: string, scored: number): ThrowRecord {
  return { id, turn_id: turnId, dart_index: dartIndex, segment, scored };
}

function turn(
  throws: ThrowRecord[],
  id = 'turn-1',
  legId = 'leg-1',
  playerId = 'a',
  turnNumber = 1
): TurnWithThrows {
  return {
    id,
    leg_id: legId,
    player_id: playerId,
    turn_number: turnNumber,
    total_scored: throws.reduce((sum, entry) => sum + entry.scored, 0),
    busted: false,
    tiebreak_round: null,
    throws,
  };
}

const leg: LegRecord = {
  id: 'leg-1',
  match_id: 'match-1',
  leg_number: 1,
  starting_player_id: 'a',
  winner_player_id: null,
};

const base = {
  playerIds: ['a', 'b'],
  legs: [leg],
  startScore: 301,
  finishRule: 'double_out' as const,
  legsToWin: 2,
};

describe('DartIQTracker', () => {
  it('uses the current pre-dart state for a validated forecast and refreshes after corrections', () => {
    const forecast: DartIQLandingForecast = { artifactId: 'geometry-1', confidence: 'high', validation: 'passed',
      segments: [{ segment: 'S20', probability: 0.6 }, { segment: 'S5', probability: 0.4 }] };
    const predictLanding = vi.fn().mockReturnValue(forecast);
    const outcomeModels = { a: { ...createBehavioralOutcomeModel(), predictLanding } };
    const tracker = new DartIQTracker();
    const opening = tracker.update({ ...base, outcomeModels, turnsByLeg: {} });
    expect(opening.nextDartForecast?.artifactId).toBe('geometry-1');
    expect(predictLanding).toHaveBeenLastCalledWith({ currentScore: 301, dartsLeft: 3, finishRule: 'double_out' });
    const input = { ...base, outcomeModels, turnsByLeg: { 'leg-1': [turn([dart('d1','turn-1',1,'S20',20)])] } };
    tracker.update(input);
    expect(predictLanding).toHaveBeenLastCalledWith({ currentScore: 281, dartsLeft: 2, finishRule: 'double_out' });
    const callCount = predictLanding.mock.calls.length;
    tracker.update(input);
    expect(predictLanding).toHaveBeenCalledTimes(callCount);
    tracker.update({ ...input, turnsByLeg: {} });
    expect(predictLanding).toHaveBeenLastCalledWith({ currentScore: 301, dartsLeft: 3, finishRule: 'double_out' });
  });

  it('produces the opening state before the first dart', () => {
    const tracker = new DartIQTracker();
    const snapshot = tracker.update({ ...base, turnsByLeg: { 'leg-1': [] } });

    expect(snapshot.sequence).toBe(0);
    expect(snapshot.latestEvent).toBeNull();
    expect(snapshot.nextDartForecast).toBeNull();
    expect(snapshot.state).toMatchObject({
      currentPlayerId: 'a',
      currentVisitStartScore: 301,
      dartsRemainingInTurn: 3,
      scores: { a: 301, b: 301 },
    });
    expect(snapshot.state.projections.reduce((sum, player) => sum + player.matchWinProbability, 0))
      .toBeCloseTo(1);
  });

  it('reuses an accepted prefix and advances only the appended dart', () => {
    const tracker = new DartIQTracker();
    tracker.update({
      ...base,
      turnsByLeg: {
        'leg-1': [turn([dart('dart-1', 'turn-1', 1, 'T20', 60)])],
      },
    });
    const firstEvent = tracker.events()[0];
    const snapshot = tracker.update({
      ...base,
      turnsByLeg: {
        'leg-1': [turn([
          dart('dart-1', 'turn-1', 1, 'T20', 60),
          dart('dart-2', 'turn-1', 2, 'S20', 20),
        ])],
      },
    });

    expect(snapshot.sequence).toBe(2);
    expect(tracker.events()[0]).toBe(firstEvent);
    expect(snapshot.state).toMatchObject({
      currentPlayerId: 'a',
      currentVisitStartScore: 301,
      dartsRemainingInTurn: 1,
      scores: { a: 221, b: 301 },
    });
  });

  it('invalidates the prefix when a persisted dart is corrected in place', () => {
    const tracker = new DartIQTracker();
    tracker.update({
      ...base,
      turnsByLeg: {
        'leg-1': [turn([dart('dart-1', 'turn-1', 1, 'S20', 20)])],
      },
    });
    const original = tracker.events()[0];
    const corrected = tracker.update({
      ...base,
      turnsByLeg: {
        'leg-1': [turn([dart('dart-1', 'turn-1', 1, 'T20', 60)])],
      },
    });

    expect(corrected.state.scores.a).toBe(241);
    expect(tracker.events()[0]).not.toBe(original);
  });

  it('keeps completed-leg events when the live match advances to a new leg', () => {
    const tracker = new DartIQTracker();
    const firstLegTurn = turn([
      dart('dart-1', 'turn-1', 1, 'D20', 40),
    ]);
    tracker.update({
      ...base,
      startScore: 40,
      turnsByLeg: { 'leg-1': [firstLegTurn] },
    });
    const secondLeg: LegRecord = {
      ...leg,
      id: 'leg-2',
      leg_number: 2,
      starting_player_id: 'b',
    };
    const secondLegTurn = turn([
      dart('dart-2', 'turn-2', 1, 'S20', 20),
    ], 'turn-2', 'leg-2', 'b');

    const snapshot = tracker.update({
      ...base,
      startScore: 40,
      legs: [{ ...leg, winner_player_id: 'a' }, secondLeg],
      turnsByLeg: {
        'leg-1': [firstLegTurn],
        'leg-2': [secondLegTurn],
      },
    });

    expect(tracker.events().map((event) => event.dartId)).toEqual(['dart-1', 'dart-2']);
    expect(snapshot.state).toMatchObject({
      legId: 'leg-2',
      scores: { a: 40, b: 20 },
      legsWon: { a: 1, b: 0 },
    });
  });
});
