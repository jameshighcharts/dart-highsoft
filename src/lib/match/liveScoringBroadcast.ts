import type { TurnRecord, ThrowRecord } from './types.ts';

export type LiveScoringBroadcast = {
  matchId: string;
  turn: TurnRecord;
  throws: ThrowRecord[];
};
export const liveMatchTopic = (matchId: string) => `live_match_${matchId}`;
const version = (value: unknown): bigint | null => typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : null;

export function isLiveScoringBroadcast(value: unknown, matchId: string): value is LiveScoringBroadcast {
  if (!value || typeof value !== 'object') return false;
  const packet = value as LiveScoringBroadcast;
  return packet.matchId === matchId && !!packet.turn && typeof packet.turn.id === 'string'
    && typeof packet.turn.leg_id === 'string' && typeof packet.turn.player_id === 'string'
    && Number.isInteger(packet.turn.turn_number) && typeof packet.turn.busted === 'boolean'
    && Number.isFinite(packet.turn.total_scored) && version(packet.turn.live_revision) !== null
    && Array.isArray(packet.throws) && packet.throws.length > 0 && packet.throws.length <= 3
    && packet.throws.every(dart => dart && dart.turn_id === packet.turn.id && typeof dart.id === 'string'
      && Number.isInteger(dart.dart_index) && dart.dart_index >= 1 && dart.dart_index <= 3
      && typeof dart.segment === 'string' && Number.isFinite(dart.scored) && version(dart.live_revision) !== null);
}

/** Per-row ordering across HTTP snapshots, WAL, and direct broadcasts. */
export class LiveScoringVersions {
  private seen = new Map<string, { revision: bigint | null; deleted: boolean }>();
  accept(table: string, event: { eventType?: string; new?: { id?: string; live_revision?: string | null };
    old?: { id?: string; live_revision?: string | null } }, current?: { live_revision?: string | null }) {
    const deleted = event.eventType === 'DELETE';
    const row = deleted ? event.old : event.new;
    if (!row?.id) return true; // Existing reconciliation handles incomplete WAL payloads.
    const key = `${table}:${row.id}`;
    const incoming = version(row.live_revision);
    const previous = this.seen.get(key);
    const snapshot = version(current?.live_revision);
    const floor = previous?.revision == null ? snapshot
      : snapshot == null || previous.revision > snapshot ? previous.revision : snapshot;
    if (incoming != null && floor != null && (incoming < floor || (incoming === floor && (!deleted || previous?.deleted)))) return false;
    if (!deleted && previous?.deleted && (incoming == null || previous.revision == null || incoming <= previous.revision)) return false;
    // Old installations may produce unversioned WAL rows; preserve that fallback.
    this.seen.set(key, { revision: incoming ?? floor, deleted });
    if (this.seen.size > 10_000) this.seen.delete(this.seen.keys().next().value!);
    return true;
  }
}
