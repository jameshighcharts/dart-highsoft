import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AcceptedScoliaDart } from '../lib/commentary/scoliaRealtimeEvent';
import { ScoliaScoreBroadcaster } from './scoliaScoreBroadcaster';

const accepted = { revision: '3', rows: { turn: { id: 'turn', leg_id: 'leg', player_id: 'player',
  turn_number: 1, total_scored: 0, busted: false, tiebreak_round: null, live_revision: '1',
  player: { display_name: 'Private metadata' },
  throws: [{ id: 'dart', turn_id: 'turn', dart_index: 1, segment: 'S20', scored: 20, live_revision: '2' }],
} } } as unknown as AcceptedScoliaDart;
describe('committed score broadcaster', () => {
  it('uses an authorized private channel, HTTP while joining, then the existing socket', async () => {
    let status!: (status: string) => void;
    const channel = { subscribe: vi.fn(callback => { status = callback; }), send: vi.fn().mockResolvedValue('ok'),
      httpSend: vi.fn().mockResolvedValue({ success: true }) };
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn().mockResolvedValue('ok') };
    const broadcaster = new ScoliaScoreBroadcaster(client as unknown as SupabaseClient);
    broadcaster.publish('match', accepted);
    expect(client.channel).toHaveBeenCalledWith('live_match_match', { config: { private: true } });
    expect(channel.httpSend).toHaveBeenCalledOnce();
    expect(channel.httpSend.mock.calls[0][1].turn).not.toHaveProperty('player');
    status('SUBSCRIBED');
    broadcaster.publish('match', accepted);
    expect(channel.send).toHaveBeenCalledOnce();
    expect(client.channel).toHaveBeenCalledOnce();
    broadcaster.close();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
  it('never throws into scoring when broadcast setup fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broadcaster = new ScoliaScoreBroadcaster({ channel: () => { throw new Error('unavailable'); } } as unknown as SupabaseClient);
    expect(() => broadcaster.publish('match', accepted)).not.toThrow();
    warn.mockRestore();
  });
  it.each(['socket', 'http'] as const)('recovers after more than four synchronous %s failures and releases each failed channel', async mode => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    const send = vi.fn(() => {
      if (fail) throw new Error('synchronous send failed');
      return Promise.resolve(mode === 'socket' ? 'ok' : { success: true });
    });
    const channel = { subscribe: (callback: (status: string) => void) => {
      if (mode === 'socket') callback('SUBSCRIBED');
    }, send, httpSend: send };
    const client = { channel: vi.fn(() => channel), removeChannel: vi.fn().mockResolvedValue('ok') };
    const broadcaster = new ScoliaScoreBroadcaster(client as unknown as SupabaseClient);
    for (let i = 0; i < 5; i++) expect(() => broadcaster.publish('match', accepted)).not.toThrow();
    expect(send).toHaveBeenCalledTimes(5);
    expect(client.removeChannel).toHaveBeenCalledTimes(5);
    fail = false;
    broadcaster.publish('match', accepted);
    expect(send).toHaveBeenCalledTimes(6);
    await Promise.resolve();
    broadcaster.close();
    warn.mockRestore();
  });

});
