import { describe, expect, it } from 'vitest';

import type { LegRecord, ThrowRecord, TurnWithThrows } from '@/lib/match/types';
import { reconstructPressureTimeline } from './pressureReplay';

function dart(id: string, turnId: string, dartIndex: number, segment: string, scored: number): ThrowRecord {
  return { id, turn_id: turnId, dart_index: dartIndex, segment, scored };
}

function turn(
  id: string,
  legId: string,
  playerId: string,
  turnNumber: number,
  throws: ThrowRecord[]
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

function leg(id: string, number: number, starter: string, winner: string | null): LegRecord {
  return {
    id,
    match_id: 'match-1',
    leg_number: number,
    starting_player_id: starter,
    winner_player_id: winner,
  };
}

describe('reconstructPressureTimeline', () => {
  it('emits before/after state and WPA for every dart in chronological order', () => {
    const firstTurn = turn('turn-1', 'leg-1', 'a', 1, [
      dart('dart-2', 'turn-1', 2, 'S20', 20),
      dart('dart-1', 'turn-1', 1, 'T20', 60),
    ]);
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b'],
      legs: [leg('leg-1', 1, 'a', null)],
      turnsByLeg: { 'leg-1': [firstTurn] },
      startScore: 301,
      finishRule: 'double_out',
      legsToWin: 2,
    });

    expect(timeline.map((event) => event.dartId)).toEqual(['dart-1', 'dart-2']);
    expect(timeline[0].before.scores.a).toBe(301);
    expect(timeline[0].after.scores.a).toBe(241);
    expect(timeline[1].after.scores.a).toBe(221);
    expect(timeline[0].matchWinProbabilityAdded.a).toBeGreaterThan(0);
    expect(timeline[0]).toMatchObject({
      eventId: 'pressure-v1:match-1:dart-1',
      engineVersion: 'pressure-v1',
    });
    expect(timeline[0].leverage.pressureIndex).toBeGreaterThan(0);
    expect(firstTurn.throws.map((entry) => entry.id)).toEqual(['dart-2', 'dart-1']);
  });

  it('restores score and removes the visit from live form after a bust', () => {
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b'],
      legs: [leg('leg-1', 1, 'a', null)],
      turnsByLeg: {
        'leg-1': [turn('turn-1', 'leg-1', 'a', 1, [
          dart('dart-1', 'turn-1', 1, 'T10', 30),
          dart('dart-2', 'turn-1', 2, 'S2', 2),
        ])],
      },
      startScore: 32,
      finishRule: 'double_out',
      legsToWin: 1,
    });

    expect(timeline[0].after.scores.a).toBe(2);
    expect(timeline[1].busted).toBe(true);
    expect(timeline[1].after.scores.a).toBe(32);
    expect(timeline[1].after.projections.find((entry) => entry.id === 'a')?.dartsThrown).toBe(0);
  });

  it('rolls a completed leg into the next leg state', () => {
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b'],
      legs: [leg('leg-2', 2, 'b', null), leg('leg-1', 1, 'a', 'a')],
      turnsByLeg: {
        'leg-1': [turn('turn-1', 'leg-1', 'a', 1, [dart('dart-1', 'turn-1', 1, 'D20', 40)])],
        'leg-2': [],
      },
      startScore: 40,
      finishRule: 'double_out',
      legsToWin: 2,
    });

    expect(timeline[0].checkedOut).toBe(true);
    expect(timeline[0].after.legId).toBe('leg-2');
    expect(timeline[0].after.legsWon.a).toBe(1);
    expect(timeline[0].after.scores).toEqual({ a: 40, b: 40 });
    expect(timeline[0].after.currentPlayerId).toBe('b');
    expect(timeline[0].turnScoreAfter).toBe(40);
  });

  it('locks match probability after the winning checkout', () => {
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b', 'c'],
      legs: [leg('leg-1', 1, 'a', 'a')],
      turnsByLeg: {
        'leg-1': [turn('turn-1', 'leg-1', 'a', 1, [dart('dart-1', 'turn-1', 1, 'D20', 40)])],
      },
      startScore: 40,
      finishRule: 'double_out',
      legsToWin: 1,
    });

    const probabilities = Object.fromEntries(
      timeline[0].after.projections.map((entry) => [entry.id, entry.matchWinProbability])
    );
    expect(probabilities).toEqual({ a: 1, b: 0, c: 0 });
    expect(timeline[0].matchWinProbabilityAdded.a).toBeGreaterThan(0);
  });

  it('starts a partial replay with the supplied prior leg score', () => {
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b'],
      legs: [leg('leg-3', 3, 'a', null)],
      turnsByLeg: {
        'leg-3': [turn('turn-1', 'leg-3', 'a', 1, [dart('dart-1', 'turn-1', 1, 'S20', 20)])],
      },
      startScore: 301,
      finishRule: 'single_out',
      legsToWin: 3,
      initialLegsWon: { a: 2, b: 0 },
    });

    expect(timeline[0].before.legsWon).toEqual({ a: 2, b: 0 });
    expect(timeline[0].before.projections.find((entry) => entry.id === 'a')?.matchWinProbability)
      .toBeGreaterThan(0.7);
  });

  it('keeps multiplayer probability totals normalized throughout the replay', () => {
    const playerIds = Array.from({ length: 12 }, (_, index) => String(index));
    const timeline = reconstructPressureTimeline({
      playerIds,
      legs: [leg('leg-1', 1, '0', null)],
      turnsByLeg: {
        'leg-1': playerIds.map((playerId, index) =>
          turn(`turn-${playerId}`, 'leg-1', playerId, index + 1, [
            dart(`dart-${playerId}`, `turn-${playerId}`, 1, 'S20', 20),
          ])
        ),
      },
      startScore: 301,
      finishRule: 'single_out',
      legsToWin: 3,
    });

    expect(timeline).toHaveLength(12);
    for (const event of timeline) {
      expect(event.after.projections.reduce((sum, entry) => sum + entry.matchWinProbability, 0)).toBeCloseTo(1);
    }
  });
});
