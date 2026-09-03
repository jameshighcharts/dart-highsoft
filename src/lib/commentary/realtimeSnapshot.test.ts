import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { MatchRow } from '../server/matchGuards';
import { loadRealtimeCommentarySnapshot } from './realtimeSnapshot';

function mockSupabase(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      let rows = tables[table] ?? [];
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[column]));
          return builder;
        },
        order(column: string) {
          rows = rows.slice().sort((a, b) => Number(a[column]) - Number(b[column]));
          return Promise.resolve({ data: rows, error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(resolve: (value: { data: typeof rows; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: rows, error: null }));
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('loadRealtimeCommentarySnapshot', () => {
  it('captures canonical scores, legs, source, and the next fair-ending player', async () => {
    const match: MatchRow = {
      id: 'match', winner_player_id: null, completed_at: null, ended_early: false,
      start_score: '40', finish: 'double_out', legs_to_win: 2, fair_ending: true,
      tournament_match_id: null, scolia_board_id: 'board', rematch_of_match_id: 'previous',
    };
    const snapshot = await loadRealtimeCommentarySnapshot(mockSupabase({
      match_players: [
        { match_id: 'match', player_id: 'a', play_order: 0, players: { display_name: 'A' } },
        { match_id: 'match', player_id: 'b', play_order: 1, players: { display_name: 'B' } },
      ],
      legs: [
        { id: 'old', match_id: 'match', leg_number: 1, starting_player_id: 'a', winner_player_id: 'b' },
        { id: 'current', match_id: 'match', leg_number: 2, starting_player_id: 'a', winner_player_id: null },
      ],
      turns: [{
        id: 'turn-a', leg_id: 'current', player_id: 'a', turn_number: 1,
        total_scored: 40, busted: false, tiebreak_round: null,
        throws: [{ id: 'dart-a', turn_id: 'turn-a', dart_index: 1, segment: 'D20', scored: 40 }],
      }],
      dartiq_player_evidence: [{
        match_id: 'match', player_id: 'a', raw_evidence: {
          profile: {
            player_id: 'a', finish_rule: 'double_out', matches_played: 8, visits: 80,
            darts_thrown: 240, scoring_points: 4800, three_dart_average: 60,
            busts: 4, bust_rate: 0.05, checkout_opportunities: 30, checkouts: 9,
            checkout_rate: 0.3,
          },
          outcomes: [],
        },
      }],
      dartiq_population_evidence: [{
        match_id: 'match', raw_evidence: {
          profile: {
            finish_rule: 'double_out', player_match_samples: 30, visits: 300,
            darts_thrown: 900, scoring_points: 13500, three_dart_average: 45,
            busts: 15, bust_rate: 0.05, checkout_opportunities: 100, checkouts: 12,
            checkout_rate: 0.12,
          },
          outcomes: [],
        },
      }],
      matches: [{ id: 'previous', winner_player_id: 'b' }],
    }), match);

    expect(snapshot).toMatchObject({
      kind: 'match_snapshot',
      scoringSource: 'scolia',
      sequence: 1,
      players: [
        { id: 'a', score: 0, legsWon: 0, historicalBaseline: { profileSource: 'personal' } },
        { id: 'b', score: 40, legsWon: 1, historicalBaseline: { profileSource: 'population' } },
      ],
      currentLeg: {
        id: 'current',
        currentPlayerId: 'b',
        fairEndingState: { phase: 'completing_round', checkedOutPlayerIds: ['a'] },
      },
      rematch: {
        previousMatchId: 'previous',
        previousWinnerId: 'b',
        revengePlayerIds: ['a'],
      },
      narrative: { schemaVersion: 1, rematch: { previousMatchId: 'previous' } },
    });
  });
});
