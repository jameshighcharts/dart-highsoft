import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DartIQDartEvent, DartIQReplayState } from '@/lib/dartiq/replay';

const { loadMatchData, loadFrozenDartIQEvidence, reconstructDartIQTimeline } = vi.hoisted(() => ({
  loadMatchData: vi.fn(),
  loadFrozenDartIQEvidence: vi.fn(),
  reconstructDartIQTimeline: vi.fn(),
}));

vi.mock('@/lib/match/loadMatchData', () => ({ loadMatchData }));
vi.mock('./dartiqEvidence', () => ({ loadFrozenDartIQEvidence }));
vi.mock('@/lib/dartiq/replay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dartiq/replay')>();
  return { ...actual, reconstructDartIQTimeline };
});

import { persistDartIQCompletedLeg } from './dartiqTelemetry';

function state(aLeg: number, aMatch: number, bLeg: number, bMatch: number): DartIQReplayState {
  const projection = (
    id: string,
    legWinProbability: number,
    matchWinProbability: number
  ) => ({
    id,
    scoreRemaining: id === 'a' ? 40 : 100,
    legsWon: 0,
    threeDartAverage: 60,
    dartsThrown: 9,
    adjustedThreeDartAverage: 60,
    expectedDartsRemaining: id === 'a' ? 2 : 5,
    legWinProbability,
    matchWinProbability,
    baselineThreeDartAverage: 55,
    historicalDarts: 90,
    profileConfidence: 0.7,
    profileSource: 'personal' as const,
    checkoutRate: 0.3,
    populationCheckoutRate: 0.2,
    bustRate: 0.04,
  });
  return {
    legId: 'leg-1',
    legNumber: 1,
    currentPlayerId: 'a',
    currentVisitStartScore: 100,
    dartsRemainingInTurn: 1,
    scores: { a: 40, b: 100 },
    legsWon: { a: 0, b: 0 },
    projections: [projection('a', aLeg, aMatch), projection('b', bLeg, bMatch)],
    fairEnding: null,
  };
}

function event(): DartIQDartEvent {
  return {
    eventId: 'dartiq:dart-1',
    engineVersion: 'behavioral-v1',
    matchId: 'match-1',
    sequence: 1,
    legId: 'leg-1',
    legNumber: 1,
    turnId: 'turn-1',
    playerId: 'a',
    dartId: 'dart-1',
    dartIndex: 3,
    segment: 'D20',
    scored: 40,
    turnScoreAfter: 40,
    busted: false,
    checkedOut: true,
    semanticStakes: {
      oneDartFinishAvailable: true,
      finishAvailableThisVisit: true,
      matchWinAvailableThisVisit: false,
    },
    consequence: { leg: 0.35, match: 0.2 },
    checkout: {
      checkoutProbabilityBefore: 0.3,
      checkoutProbabilityAfter: 1,
      nextVisitCheckoutProbability: 0,
      leaveProbabilityChange: 1,
      createdBogey: false,
      avoidedBogey: false,
    },
    fairEndingBefore: null,
    fairEndingAfter: null,
    before: state(0.65, 0.55, 0.35, 0.45),
    after: state(1, 0.75, 0, 0.25),
    matchWinProbabilityAdded: { a: 0.2, b: -0.2 },
    legWinProbabilityAdded: { a: 0.35, b: -0.35 },
  };
}

type Write = { table: string; operation: 'insert' | 'upsert' | 'update' | 'rpc'; payload: unknown };

function fakeSupabase() {
  const writes: Write[] = [];
  const from = (table: string) => {
    let operation: Exclude<Write['operation'], 'rpc'> | 'select' = 'select';
    let payload: unknown;
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      in: () => builder,
      maybeSingle: async () => {
        if (table === 'dartiq_model_versions') return { data: { id: 7 }, error: null };
        if (table === 'dartiq_population_evidence') {
          return { data: { id: 11, content_hash: 'population-hash' }, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => ({ data: null, error: null }),
      insert: (value: unknown) => {
        operation = 'insert';
        payload = value;
        writes.push({ table, operation, payload });
        return builder;
      },
      upsert: (value: unknown) => {
        operation = 'upsert';
        payload = value;
        writes.push({ table, operation, payload });
        return builder;
      },
      update: (value: unknown) => {
        operation = 'update';
        payload = value;
        writes.push({ table, operation, payload });
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === 'dartiq_player_evidence' && operation === 'select') {
          return Promise.resolve({
            data: [
              { id: 21, player_id: 'a', content_hash: 'a-hash' },
              { id: 22, player_id: 'b', content_hash: 'b-hash' },
            ],
            error: null,
          }).then(resolve);
        }
        if (table === 'dartiq_projection_events' && operation === 'insert') {
          return Promise.resolve({ data: [{ id: 31, source_throw_id: 'dart-1' }], error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return builder;
  };
  const rpc = async (name: string, payload: unknown) => {
    writes.push({ table: name, operation: 'rpc', payload });
    return { data: [{ source_throw_id: 'dart-1', projection_event_id: 31 }], error: null };
  };
  return { client: { from, rpc }, writes };
}

describe('persistDartIQCompletedLeg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMatchData.mockResolvedValue({
      match: {
        id: 'match-1', start_score: '501', finish: 'double_out', legs_to_win: 2,
        fair_ending: false, winner_player_id: null, ended_early: false,
      },
      players: [{ id: 'a', display_name: 'A' }, { id: 'b', display_name: 'B' }],
      legs: [{
        id: 'leg-1', match_id: 'match-1', leg_number: 1,
        starting_player_id: 'a', winner_player_id: 'a',
      }],
      turnsByLeg: { 'leg-1': [] },
    });
    loadFrozenDartIQEvidence.mockResolvedValue({
      playerProfiles: [],
      populationProfile: undefined,
      playerOutcomes: [],
      populationOutcomes: [],
    });
    reconstructDartIQTimeline.mockReturnValue([event()]);
  });

  it('writes one event batch, the full player vector, and a resolution', async () => {
    const { client, writes } = fakeSupabase();
    await expect(
      persistDartIQCompletedLeg(client as never, 'match-1', 'leg-1')
    ).resolves.toEqual({ persisted: 1, skipped: null });

    const replacement = writes.find(
      (write) => write.table === 'replace_dartiq_leg_projection_events'
    );
    expect(replacement?.operation).toBe('rpc');
    expect(replacement?.payload).toEqual(expect.objectContaining({
      p_events: [
      expect.objectContaining({
        source_throw_id: 'dart-1',
        live_capture_status: 'not_supported',
        live_capture_cause: 'completed_leg_reconstruction',
        outcome_model_applicable: true,
        confidence_tier: expect.any(String),
        pre_state_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      ],
      p_player_projections: [
        expect.objectContaining({ player_id: 'a', match_probability_before: 0.55, match_probability_after: 0.75 }),
        expect.objectContaining({ player_id: 'b', match_probability_before: 0.45, match_probability_after: 0.25 }),
      ],
      p_revision_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'dartiq_projection_resolutions',
      operation: 'insert',
      payload: expect.objectContaining({ kind: 'leg', winner_player_id: 'a' }),
    }));
  });

  it('sends a stable content hash so the locked RPC can reuse an identical revision', async () => {
    const first = fakeSupabase();
    await persistDartIQCompletedLeg(first.client as never, 'match-1', 'leg-1');
    const firstPayload = first.writes.find(
      (write) => write.table === 'replace_dartiq_leg_projection_events'
    )?.payload as { p_revision_hash: string };
    const { client, writes } = fakeSupabase();

    await persistDartIQCompletedLeg(client as never, 'match-1', 'leg-1');

    expect(writes.some((write) => write.table === 'dartiq_projection_events')).toBe(false);
    const secondPayload = writes.find(
      (write) => write.table === 'replace_dartiq_leg_projection_events'
    )?.payload as { p_revision_hash: string };
    expect(secondPayload.p_revision_hash).toBe(firstPayload.p_revision_hash);
  });

  it('changes the revision hash when a same-ID dart outcome changes', async () => {
    const original = fakeSupabase();
    await persistDartIQCompletedLeg(original.client as never, 'match-1', 'leg-1');
    const originalHash = (original.writes.find(
      (write) => write.table === 'replace_dartiq_leg_projection_events'
    )?.payload as { p_revision_hash: string }).p_revision_hash;
    reconstructDartIQTimeline.mockReturnValueOnce([{
      ...event(),
      segment: 'S20',
      scored: 20,
      checkedOut: false,
    }]);
    const { client, writes } = fakeSupabase();

    await persistDartIQCompletedLeg(client as never, 'match-1', 'leg-1');

    const replacement = writes.find((write) =>
      write.table === 'replace_dartiq_leg_projection_events'
    );
    expect(replacement).toEqual(expect.objectContaining({
      table: 'replace_dartiq_leg_projection_events',
      operation: 'rpc',
    }));
    expect((replacement?.payload as { p_revision_hash: string }).p_revision_hash)
      .not.toBe(originalHash);
  });
});
