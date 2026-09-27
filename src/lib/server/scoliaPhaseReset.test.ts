import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkScoliaPhaseReset } from './scoliaPhaseReset';

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
function database(matchChanges = {}, boardChanges = {}, darts: object[] = []) {
  const tables: Record<string, unknown> = {
    throws: darts,
    matches: { id: 'match', scolia_board_id: 'board', bull_off: null, ...matchChanges },
    scolia_boards: { id: 'board', board_status: 'Ready', board_phase: 'Takeout', board_phase_changed_at: secondsAgo(30),
      worker_connection_status: 'connected', worker_heartbeat_at: new Date().toISOString(), ...boardChanges },
  };
  return { from: vi.fn((table: string) => {
    const result = { data: tables[table], error: null };
    const query = { select: () => query, eq: () => query, limit: async () => result,
      single: async () => result, maybeSingle: async () => result };
    return query;
  }) } as unknown as SupabaseClient;
}

describe('stuck takeout reset guard', () => {
  it('refuses once the match has a dart, however long the takeout', async () => {
    expect(await checkScoliaPhaseReset(database({}, {}, [{ id: 'dart' }]), 'match'))
      .toEqual({ error: 'The match has already started. Reset is only available before the first dart.' });
  });

  it('allows a reset before the first dart once the board has been stuck in Takeout', async () => {
    expect(await checkScoliaPhaseReset(database(), 'match')).toEqual({ boardId: 'board' });
  });

  it('refuses during a normal, short dart removal', async () => {
    expect(await checkScoliaPhaseReset(database({}, { board_phase_changed_at: secondsAgo(3) }), 'match'))
      .toEqual({ error: 'The board is still removing darts. Give it a few seconds.' });
  });

  it('allows an immediate reset when the takeout began before the match was created', async () => {
    expect(await checkScoliaPhaseReset(database({ created_at: secondsAgo(2) }, { board_phase_changed_at: secondsAgo(4) }), 'match'))
      .toEqual({ boardId: 'board' });
  });

  it('allows boards that predate the phase timestamp', async () => {
    expect(await checkScoliaPhaseReset(database({}, { board_phase_changed_at: null }), 'match')).toEqual({ boardId: 'board' });
  });

  it.each([
    [{ completed_at: '2026-09-10' }, {}],
    [{ scolia_board_id: null }, {}],
    [{}, { board_phase: 'Throw' }],
    [{}, { worker_connection_status: 'reconnecting' }],
  ])('refuses finished matches, boards that recovered, and offline boards: %j %j', async (matchChanges, boardChanges) => {
    expect(await checkScoliaPhaseReset(database(matchChanges, boardChanges), 'match')).toHaveProperty('error');
  });
});
