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
  throws: ThrowRecord[],
  options: { busted?: boolean; tiebreakRound?: number | null } = {}
): TurnWithThrows {
  return {
    id,
    leg_id: legId,
    player_id: playerId,
    turn_number: turnNumber,
    total_scored: throws.reduce((sum, entry) => sum + entry.scored, 0),
    busted: options.busted ?? false,
    tiebreak_round: options.tiebreakRound ?? null,
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
      eventId: 'pressure-v2:match-1:dart-1',
      engineVersion: 'pressure-v2',
    });
    expect(timeline[0].leverage.pressureIndex).toBeGreaterThan(0);
    expect(firstTurn.throws.map((entry) => entry.id)).toEqual(['dart-2', 'dart-1']);
  });

  it('reuses a verified prefix while producing the same projection for an appended dart', () => {
    const firstTwo = turn('turn-1', 'leg-1', 'a', 1, [
      dart('dart-1', 'turn-1', 1, 'T20', 60),
      dart('dart-2', 'turn-1', 2, 'S20', 20),
    ]);
    const base = {
      playerIds: ['a', 'b'],
      legs: [leg('leg-1', 1, 'a', null)],
      startScore: 301,
      finishRule: 'double_out' as const,
      legsToWin: 2,
    };
    const prefix = reconstructPressureTimeline({
      ...base,
      turnsByLeg: { 'leg-1': [firstTwo] },
    });
    const completedTurn = turn('turn-1', 'leg-1', 'a', 1, [
      ...firstTwo.throws,
      dart('dart-3', 'turn-1', 3, 'T19', 57),
    ]);
    const incremental = reconstructPressureTimeline({
      ...base,
      turnsByLeg: { 'leg-1': [completedTurn] },
    }, { cachedPrefix: prefix });
    const clean = reconstructPressureTimeline({
      ...base,
      turnsByLeg: { 'leg-1': [completedTurn] },
    });

    expect(incremental).toEqual(clean);
    expect(incremental[0]).toBe(prefix[0]);
    expect(incremental[1]).toBe(prefix[1]);
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

  it('keeps a first fair-ending checkout provisional while the opponent completes the round', () => {
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b'],
      legs: [leg('leg-1', 1, 'a', null)],
      turnsByLeg: {
        'leg-1': [turn('turn-a', 'leg-1', 'a', 1, [
          dart('dart-a-1', 'turn-a', 1, 'D20', 40),
        ])],
      },
      startScore: 40,
      finishRule: 'double_out',
      legsToWin: 2,
      fairEnding: true,
    });

    const event = timeline[0];
    const playerA = event.after.projections.find((entry) => entry.id === 'a');
    expect(event.checkedOut).toBe(true);
    expect(event.fairEndingAfter).toMatchObject({
      phase: 'completing_round',
      checkedOutPlayerIds: ['a'],
      pendingPlayerIds: ['b'],
    });
    expect(playerA?.legWinProbability).toBeGreaterThan(0.5);
    expect(playerA?.legWinProbability).toBeLessThan(1);
    expect(event.after.projections.reduce((sum, entry) => sum + entry.legWinProbability, 0))
      .toBeCloseTo(1);
  });

  it('resolves a fair-ending leg only after the rest of the round is complete', () => {
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b'],
      legs: [leg('leg-1', 1, 'a', 'a')],
      turnsByLeg: {
        'leg-1': [
          turn('turn-a', 'leg-1', 'a', 1, [dart('dart-a-1', 'turn-a', 1, 'D20', 40)]),
          turn('turn-b', 'leg-1', 'b', 2, [
            dart('dart-b-1', 'turn-b', 1, 'S1', 1),
            dart('dart-b-2', 'turn-b', 2, 'S1', 1),
            dart('dart-b-3', 'turn-b', 3, 'S1', 1),
          ]),
        ],
      },
      startScore: 40,
      finishRule: 'double_out',
      legsToWin: 2,
      fairEnding: true,
    });

    expect(timeline[0].after.legsWon.a).toBe(0);
    const resolution = timeline.at(-1)!;
    expect(resolution.fairEndingAfter).toMatchObject({ phase: 'resolved', winnerId: 'a' });
    expect(resolution.after.legsWon.a).toBe(1);
    expect(resolution.legWinProbabilityAdded.a).toBeGreaterThan(0);
  });

  it('models a high-round tiebreak without changing the checked-out X01 scores', () => {
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b'],
      legs: [leg('leg-1', 1, 'a', 'a')],
      turnsByLeg: {
        'leg-1': [
          turn('turn-a', 'leg-1', 'a', 1, [dart('dart-a-1', 'turn-a', 1, 'D20', 40)]),
          turn('turn-b', 'leg-1', 'b', 2, [dart('dart-b-1', 'turn-b', 1, 'D20', 40)]),
          turn('tie-a', 'leg-1', 'a', 3, [
            dart('tie-a-1', 'tie-a', 1, 'T20', 60),
            dart('tie-a-2', 'tie-a', 2, 'S20', 20),
            dart('tie-a-3', 'tie-a', 3, 'S20', 20),
          ], { tiebreakRound: 1 }),
          turn('tie-b', 'leg-1', 'b', 4, [
            dart('tie-b-1', 'tie-b', 1, 'T20', 60),
            dart('tie-b-2', 'tie-b', 2, 'S10', 10),
            dart('tie-b-3', 'tie-b', 3, 'S10', 10),
          ], { tiebreakRound: 1 }),
        ],
      },
      startScore: 40,
      finishRule: 'double_out',
      legsToWin: 1,
      fairEnding: true,
    });

    const tiebreakStart = timeline.find((event) => event.dartId === 'dart-b-1')!;
    expect(tiebreakStart.fairEndingAfter).toMatchObject({
      phase: 'tiebreak',
      tiebreakRound: 1,
      tiebreakPlayerIds: ['a', 'b'],
    });
    const partial = timeline.find((event) => event.dartId === 'tie-a-1')!;
    expect(partial.after.scores).toEqual({ a: 0, b: 0 });
    expect(partial.turnScoreAfter).toBe(60);
    expect(partial.after.projections.reduce((sum, entry) => sum + entry.legWinProbability, 0))
      .toBeCloseTo(1);

    const resolution = timeline.at(-1)!;
    expect(resolution.checkedOut).toBe(false);
    expect(resolution.fairEndingAfter).toMatchObject({ phase: 'resolved', winnerId: 'a' });
    expect(resolution.after.projections.map((entry) => entry.matchWinProbability))
      .toEqual([1, 0]);
  });

  it('resolves the original finisher when the opponent busts while trying to join', () => {
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b'],
      legs: [leg('leg-1', 1, 'a', 'a')],
      turnsByLeg: {
        'leg-1': [
          turn('turn-a', 'leg-1', 'a', 1, [dart('dart-a-1', 'turn-a', 1, 'D16', 32)]),
          turn('turn-b', 'leg-1', 'b', 2, [
            dart('dart-b-1', 'turn-b', 1, 'T10', 30),
            dart('dart-b-2', 'turn-b', 2, 'S2', 2),
          ], { busted: true }),
        ],
      },
      startScore: 32,
      finishRule: 'double_out',
      legsToWin: 2,
      fairEnding: true,
    });

    const bust = timeline.at(-1)!;
    expect(bust.busted).toBe(true);
    expect(bust.after.scores.b).toBe(32);
    expect(bust.fairEndingAfter).toMatchObject({ phase: 'resolved', winnerId: 'a' });
  });

  it('advances tied high-round players into a normalized second tiebreak round', () => {
    const timeline = reconstructPressureTimeline({
      playerIds: ['a', 'b'],
      legs: [leg('leg-1', 1, 'a', null)],
      turnsByLeg: {
        'leg-1': [
          turn('turn-a', 'leg-1', 'a', 1, [dart('dart-a-1', 'turn-a', 1, 'D20', 40)]),
          turn('turn-b', 'leg-1', 'b', 2, [dart('dart-b-1', 'turn-b', 1, 'D20', 40)]),
          turn('tie-a-1', 'leg-1', 'a', 3, [
            dart('tie-a-1-1', 'tie-a-1', 1, 'S20', 20),
            dart('tie-a-1-2', 'tie-a-1', 2, 'S20', 20),
            dart('tie-a-1-3', 'tie-a-1', 3, 'S20', 20),
          ], { tiebreakRound: 1 }),
          turn('tie-b-1', 'leg-1', 'b', 4, [
            dart('tie-b-1-1', 'tie-b-1', 1, 'S20', 20),
            dart('tie-b-1-2', 'tie-b-1', 2, 'S20', 20),
            dart('tie-b-1-3', 'tie-b-1', 3, 'S20', 20),
          ], { tiebreakRound: 1 }),
          turn('tie-a-2', 'leg-1', 'a', 5, [
            dart('tie-a-2-1', 'tie-a-2', 1, 'T20', 60),
          ], { tiebreakRound: 2 }),
        ],
      },
      startScore: 40,
      finishRule: 'double_out',
      legsToWin: 2,
      fairEnding: true,
    });

    const roundOneTie = timeline.find((event) => event.dartId === 'tie-b-1-3')!;
    expect(roundOneTie.fairEndingAfter).toMatchObject({
      phase: 'tiebreak', tiebreakRound: 2, tiebreakScores: {},
    });
    const roundTwo = timeline.at(-1)!;
    expect(roundTwo.fairEndingAfter).toMatchObject({
      phase: 'tiebreak', tiebreakRound: 2, tiebreakScores: { a: 60, b: 0 },
    });
    expect(roundTwo.after.projections.reduce((sum, entry) => sum + entry.legWinProbability, 0))
      .toBeCloseTo(1);
  });
});
