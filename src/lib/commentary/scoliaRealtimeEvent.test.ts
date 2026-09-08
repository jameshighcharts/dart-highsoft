import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  classifyScoliaRealtimeDart,
  describeCommentaryLanding,
  commentaryLandingForecast,
  loadScoliaRealtimeDartEvent,
  ScoliaDartIQEventCache,
  type ScoliaRealtimeDartFacts,
} from './scoliaRealtimeEvent';

type Row = Record<string, unknown>;

function supabaseWithRows(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = tables[table] ?? [];
      let selectQuery = '';
      const builder = {
        select(query: string) {
          selectQuery = query;
          return builder;
        },
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[column]));
          return builder;
        },
        order(column: string) {
          rows = rows.slice().sort((a, b) => Number(a[column] ?? 0) - Number(b[column] ?? 0));
          return builder;
        },
        single() {
          return Promise.resolve({ data: materialize(rows[0] ?? null), error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: materialize(rows[0] ?? null), error: null });
        },
        then(resolve: (value: { data: Row[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: rows.map((row) => materialize(row)!), error: null }));
        },
      };

      function materialize(row: Row | null) {
        if (!row) return null;
        if (table === 'turns' && selectQuery.includes('throws:throws')) {
          return {
            ...row,
            throws: (tables.throws ?? []).filter((dart) => dart.turn_id === row.id),
          };
        }
        return { ...row };
      }

      return builder;
    },
  } as unknown as SupabaseClient;
}

function facts(overrides: Partial<ScoliaRealtimeDartFacts> = {}): ScoliaRealtimeDartFacts {
  return {
    matchId: 'match',
    legId: 'leg',
    legNumber: 1,
    turnId: 'turn',
    dartId: 'dart',
    playerId: 'player',
    playerName: 'Player',
    dartIndex: 1,
    segment: 'T20',
    scored: 60,
    turnScore: 60,
    visitDarts: [{ dartIndex: 1, segment: 'T20', scored: 60 }],
    busted: false,
    checkedOut: false,
    matchWon: false,
    nikitaSpecial: false,
    ...overrides,
  };
}

describe('classifyScoliaRealtimeDart', () => {
  it('loads an earlier dart without leaking later visit darts or the eventual winner', async () => {
    const supabase = supabaseWithRows({
      matches: [{ id: 'match', winner_player_id: 'a', start_score: '40', finish: 'double_out', legs_to_win: 1, fair_ending: false }],
      match_players: [{ match_id: 'match', player_id: 'a', play_order: 0 }, { match_id: 'match', player_id: 'b', play_order: 1 }],
      legs: [{ id: 'leg', match_id: 'match', leg_number: 1, starting_player_id: 'a', winner_player_id: 'a' }],
      players: [{ id: 'a', display_name: 'A' }, { id: 'b', display_name: 'B' }],
      turns: [{ id: 'turn', leg_id: 'leg', player_id: 'a', turn_number: 1, total_scored: 40, busted: false, tiebreak_round: null }],
      throws: [
        { id: 'first', turn_id: 'turn', dart_index: 1, segment: 'S20', scored: 20 },
        { id: 'finish', turn_id: 'turn', dart_index: 2, segment: 'D10', scored: 20 },
      ],
    });
    const cache = new ScoliaDartIQEventCache();
    const earlier = await loadScoliaRealtimeDartEvent(supabase, 'match', 'first', cache);
    expect(earlier).toMatchObject({
      turnScore: 20, checkedOut: false, matchWon: false, isLatestDart: false,
      visitDarts: [{ dartIndex: 1, segment: 'S20', scored: 20 }],
      narrative: { sequence: 1 },
    });
    const latest = await loadScoliaRealtimeDartEvent(supabase, 'match', 'finish', cache);
    expect(latest).toMatchObject({ turnScore: 40, checkedOut: true, matchWon: true, isLatestDart: true, narrative: { sequence: 2 } });
  });
  it('feeds early darts silently', () => {
    expect(classifyScoliaRealtimeDart(facts())).toMatchObject({
      priority: 'silent',
      shouldSpeak: false,
      eventId: 'scolia-throw:dart',
    });
  });

  it('speaks after an ordinary completed visit', () => {
    expect(classifyScoliaRealtimeDart(facts({ dartIndex: 3, turnScore: 81 }))).toMatchObject({
      priority: 'ordinary',
      shouldSpeak: true,
    });
  });

  it('promotes marquee and terminal events', () => {
    expect(classifyScoliaRealtimeDart(facts({ dartIndex: 3, turnScore: 180 })).priority).toBe('marquee');
    expect(classifyScoliaRealtimeDart(facts({ checkedOut: true })).priority).toBe('marquee');
    expect(classifyScoliaRealtimeDart(facts({ matchWon: true })).priority).toBe('terminal');
    expect(classifyScoliaRealtimeDart(facts({ nikitaSpecial: true })).priority).toBe('marquee');
  });

  it('detects the exact Nikita special from canonical turn darts', async () => {
    const supabase = supabaseWithRows({
      matches: [{
        id: 'match', winner_player_id: null, start_score: '501', finish: 'double_out',
        legs_to_win: 2, fair_ending: false,
      }],
      match_players: [
        { match_id: 'match', player_id: 'a', play_order: 0 },
        { match_id: 'match', player_id: 'b', play_order: 1 },
      ],
      legs: [{
        id: 'leg', match_id: 'match', leg_number: 1,
        starting_player_id: 'a', winner_player_id: null,
      }],
      turns: [{
        id: 'turn', leg_id: 'leg', player_id: 'a', turn_number: 1,
        total_scored: 26, busted: false, tiebreak_round: null,
      }],
      throws: [
        { id: 'one', turn_id: 'turn', dart_index: 1, segment: 'S1', scored: 1 },
        { id: 'five', turn_id: 'turn', dart_index: 2, segment: 'S5', scored: 5 },
        { id: 'dart', turn_id: 'turn', dart_index: 3, segment: 'S20', scored: 20 },
      ],
      players: [{ id: 'a', display_name: 'Player A' }],
      dartiq_player_profiles: [],
      dartiq_population_profiles: [],
    });

    await expect(loadScoliaRealtimeDartEvent(supabase, 'match', 'dart')).resolves.toMatchObject({
      nikitaSpecial: true,
      priority: 'marquee',
      visitDarts: [
        { dartIndex: 1, segment: 'S1', scored: 1 },
        { dartIndex: 2, segment: 'S5', scored: 5 },
        { dartIndex: 3, segment: 'S20', scored: 20 },
      ],
    });
  });

  it('feeds context without speech when the direct policy is unavailable', () => {
    expect(
      classifyScoliaRealtimeDart(facts({ dartIndex: 3, turnScore: 180 }), { allowSpeech: false })
    ).toMatchObject({ priority: 'silent', shouldSpeak: false });
  });

  it('loads a fair-ending checkout as a speaking DartIQ v2 worker event', async () => {
    const supabase = supabaseWithRows({
      matches: [{
        id: 'match', winner_player_id: null, start_score: '40', finish: 'double_out',
        legs_to_win: 2, fair_ending: true,
      }],
      match_players: [
        { match_id: 'match', player_id: 'a', play_order: 0 },
        { match_id: 'match', player_id: 'b', play_order: 1 },
      ],
      legs: [{
        id: 'leg', match_id: 'match', leg_number: 1,
        starting_player_id: 'a', winner_player_id: null,
      }],
      turns: [{
        id: 'turn', leg_id: 'leg', player_id: 'a', turn_number: 1,
        total_scored: 40, busted: false, tiebreak_round: null,
      }],
      throws: [{
        id: 'dart', turn_id: 'turn', dart_index: 1, segment: 'D20', scored: 40,
      }],
      players: [{ id: 'a', display_name: 'Player A' }],
      dartiq_player_profiles: [],
      dartiq_population_profiles: [],
    });

    const event = await loadScoliaRealtimeDartEvent(supabase, 'match', 'dart');

    expect(event).toMatchObject({
      checkedOut: true,
      priority: 'marquee',
      shouldSpeak: true,
      dartiq: {
        schemaVersion: 2,
        engineVersion: 'behavioral-v1',
        fairEnding: { phase: 'completing_round', winnerId: null },
      },
    });
    expect(event.dartiq?.signals).toEqual(
      expect.arrayContaining(['checkout', 'fair_ending_checkout'])
    );
  });

  it('loads a tiebreak-resolving dart as terminal even when the acting player loses', async () => {
    const supabase = supabaseWithRows({
      matches: [{
        id: 'match', winner_player_id: 'a', start_score: '40', finish: 'double_out',
        legs_to_win: 1, fair_ending: true,
      }],
      match_players: [
        { match_id: 'match', player_id: 'a', play_order: 0 },
        { match_id: 'match', player_id: 'b', play_order: 1 },
      ],
      legs: [{
        id: 'leg', match_id: 'match', leg_number: 1,
        starting_player_id: 'a', winner_player_id: 'a',
      }],
      turns: [
        {
          id: 'normal-a', leg_id: 'leg', player_id: 'a', turn_number: 1,
          total_scored: 40, busted: false, tiebreak_round: null,
        },
        {
          id: 'normal-b', leg_id: 'leg', player_id: 'b', turn_number: 2,
          total_scored: 40, busted: false, tiebreak_round: null,
        },
        {
          id: 'tiebreak-a', leg_id: 'leg', player_id: 'a', turn_number: 3,
          total_scored: 100, busted: false, tiebreak_round: 1,
        },
        {
          id: 'tiebreak-b', leg_id: 'leg', player_id: 'b', turn_number: 4,
          total_scored: 81, busted: false, tiebreak_round: 1,
        },
      ],
      throws: [
        { id: 'normal-a-1', turn_id: 'normal-a', dart_index: 1, segment: 'D20', scored: 40 },
        { id: 'normal-b-1', turn_id: 'normal-b', dart_index: 1, segment: 'D20', scored: 40 },
        { id: 'tiebreak-a-1', turn_id: 'tiebreak-a', dart_index: 1, segment: 'T20', scored: 60 },
        { id: 'tiebreak-a-2', turn_id: 'tiebreak-a', dart_index: 2, segment: 'S20', scored: 20 },
        { id: 'tiebreak-a-3', turn_id: 'tiebreak-a', dart_index: 3, segment: 'S20', scored: 20 },
        { id: 'tiebreak-b-1', turn_id: 'tiebreak-b', dart_index: 1, segment: 'T19', scored: 57 },
        { id: 'tiebreak-b-2', turn_id: 'tiebreak-b', dart_index: 2, segment: 'S12', scored: 12 },
        { id: 'tiebreak-b-3', turn_id: 'tiebreak-b', dart_index: 3, segment: 'S12', scored: 12 },
      ],
      players: [{ id: 'b', display_name: 'Player B' }],
      dartiq_player_profiles: [],
      dartiq_population_profiles: [],
    });

    const event = await loadScoliaRealtimeDartEvent(supabase, 'match', 'tiebreak-b-3');

    expect(event).toMatchObject({
      playerId: 'b',
      checkedOut: false,
      matchWon: false,
      priority: 'terminal',
      shouldSpeak: true,
      dartiq: {
        schemaVersion: 2,
        fairEnding: { phase: 'resolved', winnerId: 'a' },
      },
    });
    expect(event.dartiq?.signals).toEqual(
      expect.arrayContaining(['leg_win', 'match_win'])
    );
  });

  it('keeps canonical DartIQ history in the worker cache between sequential darts', async () => {
    const tables: Record<string, Row[]> = {
      matches: [{
        id: 'match', winner_player_id: null, start_score: '301', finish: 'double_out',
        legs_to_win: 2, fair_ending: false,
      }],
      match_players: [
        { match_id: 'match', player_id: 'a', play_order: 0 },
        { match_id: 'match', player_id: 'b', play_order: 1 },
      ],
      legs: [{
        id: 'leg', match_id: 'match', leg_number: 1, starting_player_id: 'a', winner_player_id: null,
      }],
      turns: [{
        id: 'turn', leg_id: 'leg', player_id: 'a', turn_number: 1,
        total_scored: 60, busted: false, tiebreak_round: null,
      }],
      throws: [{ id: 'dart-1', turn_id: 'turn', dart_index: 1, segment: 'T20', scored: 60 }],
      players: [{ id: 'a', display_name: 'Player A' }],
      dartiq_player_profiles: [],
      dartiq_population_profiles: [],
    };
    const supabase = supabaseWithRows(tables);
    const cache = new ScoliaDartIQEventCache();

    await loadScoliaRealtimeDartEvent(supabase, 'match', 'dart-1', cache);
    const cached = cache.get('match')!;
    const base = cached.input.outcomeModels!.a;
    cached.input.outcomeModels = { ...cached.input.outcomeModels, a: { ...base,
      predictLanding: () => ({ artifactId: 'frozen', validation: 'passed', confidence: 'high',
        segments: [{ segment: 'S20', probability: 0.8 }, { segment: 'T20', probability: 0.2 }] }),
    } };
    tables.throws.push({ id: 'dart-2', turn_id: 'turn', dart_index: 2, segment: 'S20', scored: 20,
      impact_x_mm: 0, impact_y_mm: 110 });
    tables.turns[0].total_scored = 80;
    const second = await loadScoliaRealtimeDartEvent(supabase, 'match', 'dart-2', cache);

    expect(second.dartiq).toMatchObject({ dartId: 'dart-2', scoreBefore: 241, scoreAfter: 221 });
    expect(second.landing?.detail).toContain('3.0 mm from the T20');
    expect(second.landingBefore).toMatchObject({ scoreRemaining: 241, dartsLeft: 2, actualSegmentProbability: 0.8 });
    expect(second.landingNext).toMatchObject({ scoreRemaining: 221, dartsLeft: 1 });
    expect(second.narrative).toMatchObject({
      schemaVersion: 1,
      players: expect.arrayContaining([expect.objectContaining({ playerId: 'a' })]),
    });
    expect(cache.get('match')?.timeline).toHaveLength(2);
  });
});


describe('grounded landing commentary', () => {
  it('describes real ring proximity without inventing aim or using contradictory coordinates', () => {
    expect(describeCommentaryLanding('S20', 0, 110)?.detail).toContain('3.0 mm from the T20');
    expect(describeCommentaryLanding('S20', 0, 160)?.detail).toContain('2.0 mm from the D20');
    expect(describeCommentaryLanding('S20', 0, 110)?.detail).toContain('Intended target unknown');
    expect(describeCommentaryLanding('S20', 0, 130)).toBeUndefined();
    expect(describeCommentaryLanding('T20', 0, 110)).toBeUndefined();
    expect(describeCommentaryLanding('S20', null, 110)).toBeUndefined();
    expect(describeCommentaryLanding('S20', NaN, 110)).toBeUndefined();
  });

  it('uses only validated, high-confidence forecasts and preserves probability outside the top three', () => {
    const forecast = { artifactId: 'frozen', validation: 'passed' as const, confidence: 'high' as const,
      segments: [{ segment: 'S20', probability: 0.5 }, { segment: 'T20', probability: 0.3 },
        { segment: 'S5', probability: 0.15 }, { segment: 'S1', probability: 0.05 }] };
    const input: Parameters<typeof commentaryLandingForecast>[0] = {
      playerIds: ['a'], legs: [], turnsByLeg: {}, startScore: 501, finishRule: 'double_out', legsToWin: 1,
      outcomeModels: { a: { version: 'behavioral-v1', distribution: () => { throw new Error('No projection needed'); },
        predictLanding: () => forecast } },
    };
    const state: Parameters<typeof commentaryLandingForecast>[1] = {
      legId: 'leg', legNumber: 1, currentPlayerId: 'a', dartsRemainingInTurn: 2,
      scores: { a: 301 }, legsWon: {}, projections: [], approximationMode: 'standard', fairEnding: null,
    };
    expect(commentaryLandingForecast(input, state, 'S1')).toMatchObject({ playerId: 'a', dartsLeft: 2,
      scoreRemaining: 301, artifactId: 'frozen', actualSegmentProbability: 0.05,
      segments: forecast.segments.slice(0, 3) });
    expect(commentaryLandingForecast(input, { ...state, scores: { a: 170 } })).toBeUndefined();
    expect(commentaryLandingForecast(input, { ...state, currentPlayerId: null })).toBeUndefined();
    expect(commentaryLandingForecast(input, { ...state, fairEnding: {
      phase: 'tiebreak', checkedOutPlayerIds: ['a'], tiebreakRound: 1, tiebreakPlayerIds: ['a'],
      tiebreakScores: {}, winnerId: null, pendingPlayerIds: ['a'], tiebreakDartsThrown: {}, approximationMode: 'fair-ending-weighted',
    } })).toBeUndefined();
    input.outcomeModels!.a.predictLanding = () => ({ ...forecast, validation: 'pending' });
    expect(commentaryLandingForecast(input, state)).toBeUndefined();
    input.outcomeModels!.a.predictLanding = () => ({ ...forecast, confidence: 'low' });
    expect(commentaryLandingForecast(input, state)).toBeUndefined();
  });
});
