import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { AcceptedScoliaDart } from '../lib/commentary/scoliaRealtimeEvent.ts';
import { isLiveScoringBroadcast, liveMatchTopic } from '../lib/match/liveScoringBroadcast.ts';
import type { LiveScoringBroadcast } from '../lib/match/liveScoringBroadcast.ts';

/** Best-effort acceleration only: durable Postgres Changes remains the fallback. */
export class ScoliaScoreBroadcaster {
  private channel: RealtimeChannel | null = null;
  private matchId: string | null = null;
  private ready = false;
  private pending = 0;
  private readonly supabase: SupabaseClient;
  constructor(supabase: SupabaseClient) { this.supabase = supabase; }
  publish(matchId: string, accepted: AcceptedScoliaDart) {
    try { this.send(matchId, accepted); }
    catch (error) {
      this.close();
      console.warn('[scolia] Score broadcast unavailable; WAL remains active', error);
    }
  }
  private send(matchId: string, accepted: AcceptedScoliaDart) {
    const source = accepted.rows.turn;
    if (!source || this.pending >= 4) return;
    const packet: LiveScoringBroadcast = { matchId, turn: {
      id: source.id, leg_id: source.leg_id, player_id: source.player_id,
      turn_number: source.turn_number, total_scored: source.total_scored, busted: source.busted,
      tiebreak_round: source.tiebreak_round, live_revision: source.live_revision,
    }, throws: source.throws.map(dart => ({ ...dart })) };
    if (!isLiveScoringBroadcast(packet, matchId)) return;
    if (this.matchId !== matchId) {
      this.close(); this.matchId = matchId;
      const channel = this.supabase.channel(liveMatchTopic(matchId), { config: { private: true } });
      this.channel = channel;
      channel.subscribe(status => { if (this.channel === channel) this.ready = status === 'SUBSCRIBED'; });
    }
    const channel = this.channel!;
    const sending = this.ready
      ? channel.send({ type: 'broadcast', event: 'scoring-commit', payload: packet })
      : channel.httpSend('scoring-commit', packet, { timeout: 2_000 });
    this.pending++;
    void sending.then(result => {
      if (result !== 'ok' && !(typeof result === 'object' && result.success)) {
        console.warn('[scolia] Score broadcast rejected; WAL remains active', result);
      }
    }).catch(error => console.warn('[scolia] Score broadcast failed; WAL remains active', error))
      .finally(() => { this.pending--; });
  }
  close() {
    const channel = this.channel;
    this.channel = null; this.matchId = null; this.ready = false;
    if (channel) {
      try {
        void this.supabase.removeChannel(channel).catch(error => console.warn('[scolia] Broadcast channel cleanup failed', error));
      } catch (error) { console.warn('[scolia] Broadcast channel cleanup failed', error); }
    }
  }
}
