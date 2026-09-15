import { describe, expect, it } from 'vitest';
import { buildSheetExport } from './sheetExport';
import { buildStandings, type Snapshot } from './standings';
import { fixture, finish } from '@/test-utils/highdartsFixtures';

describe('published tournament sheet export', () => {
  it('keeps repeated fixtures separate and exports completed results only', () => {
    const done = finish(fixture('bergen', 'a', 'b', 1), 'a', 60, 30);
    const ended = finish(fixture('bergen', 'a', 'b', 3), 'a');
    if (ended.match) ended.match.ended_early = true;
    const output = buildSheetExport({ fixtures: [done, fixture('bergen', 'b', 'a', 2), ended], players: [] });
    expect(output.fixtures.map(f => f.number)).toEqual([1, 2, 3]);
    expect(output.fixtures.map(f => f.result)).toEqual([[2, 0, 60, 30], ['', '', '', ''], ['', '', '', '']]);
    expect(output.finals).toEqual([]);
    expect(output.byes).toEqual(['', '', '', '']);
  });

  it('uses the app standings and dart-weighted average, excluding tiebreak darts', () => {
    const first = finish(fixture('bergen', 'a', 'b', 1), 'a', 60, 30);
    const second = finish(fixture('bergen', 'a', 'b', 2), 'a', 90, 30);
    second.match?.legs[0].turns.push({ player_id: 'a', total_scored: 90, darts_thrown: 3, busted: false, tiebreak_round: null });
    second.match?.legs[0].turns.push({ player_id: 'a', total_scored: 180, darts_thrown: 3, busted: false, tiebreak_round: 1 });
    const snapshot: Snapshot = { fixtures: [first, second], players: [{ id: 'a', display_name: 'Alice', avatar_url: 'private-avatar' }] };
    const output = buildSheetExport(snapshot);
    const table = buildStandings(snapshot).offices[0].table;
    expect(output.standings[0].rows[0]).toEqual([1, 'a', 2, 2, 80]);
    expect(output.standings[0].rows[0][4]).toEqual(table[0].average);
    expect(JSON.stringify(output)).not.toContain('private-avatar');
    expect(output.fixtures[0]).not.toHaveProperty('match');
    expect(output.fixtures[0]).not.toHaveProperty('player_a_id');
  });

  it('exports each side’s stored counting decision and clears an unlocked draw', () => {
    const counted = { ...finish(fixture('vik', 'a', 'b'), 'a'), counts_for_a: false, counts_for_b: true };
    const final = { ...finish(fixture('vik', 'a', 'b'), 'a'), stage: 'final' as const };
    const live = buildSheetExport({ fixtures: [counted, final], players: [] });
    expect(live.fixtures[0].counts).toEqual([0, 1]);
    expect(live.finals[0].values).toEqual(['a', 'b', 'a']);
    expect(buildSheetExport({ fixtures: [counted], players: [] }).finals).toEqual([]);
  });
});
