import type { ActiveRealtimeCommentarySession } from './realtimeTypes.ts';
type Entry = { sessions: ActiveRealtimeCommentarySession[]; expiresAt: number };
/** Short-lived cache; notifications invalidate synchronously, and expired listeners are never extended. */
export class RealtimeSessionCache {
  private readonly entries = new Map<string, Entry>();
  private generation = 0;
  invalidate(matchId?: string) { this.generation++; if (matchId) this.entries.delete(matchId); else this.entries.clear(); }
  async load(matchId: string, fetch: () => Promise<ActiveRealtimeCommentarySession[]>) {
    const existing = this.entries.get(matchId);
    if (existing && existing.expiresAt > Date.now()) return existing.sessions;
    for (let attempt = 0; attempt < 3; attempt++) {
      const generation = this.generation;
      const sessions = await fetch();
      if (generation !== this.generation) continue;
      const expiresAt = Math.min(Date.now() + 15_000, ...sessions.map(session => Math.min(
        Date.parse(session.last_seen_at ?? '') + 45_000,
        Date.parse(session.created_at ?? '') + 55 * 60_000,
      )));
      if (expiresAt > Date.now()) this.entries.set(matchId, { sessions, expiresAt });
      if (this.entries.size > 100) this.entries.delete(this.entries.keys().next().value!);
      return sessions;
    }
    throw new Error('Realtime listeners changed during lookup');
  }
}
