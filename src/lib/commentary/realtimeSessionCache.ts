import type { ActiveRealtimeCommentarySession } from './realtimeTypes.ts';
type Entry = { sessions: ActiveRealtimeCommentarySession[]; expiresAt: number };
/** Short-lived cache; notifications invalidate synchronously, and expired listeners are never extended. */
export class RealtimeSessionCache {
  private readonly entries = new Map<string, Entry>();
  private generation = 0;
  // Per match, so a listener change in one match never makes another match's lookup retry.
  private readonly matchGenerations = new Map<string, number>();
  invalidate(matchId?: string) {
    if (!matchId) { this.generation++; this.entries.clear(); return; }
    this.entries.delete(matchId);
    const next = (this.matchGenerations.get(matchId) ?? 0) + 1;
    this.matchGenerations.delete(matchId);
    this.matchGenerations.set(matchId, next);
    if (this.matchGenerations.size > 1_000) {
      // A forgotten counter restarts at zero; bump the global one so no in-flight lookup mistakes that for "unchanged".
      this.matchGenerations.delete(this.matchGenerations.keys().next().value!);
      this.generation++;
    }
  }
  private version(matchId: string) { return `${this.generation}:${this.matchGenerations.get(matchId) ?? 0}`; }
  async load(matchId: string, fetch: () => Promise<ActiveRealtimeCommentarySession[]>) {
    const existing = this.entries.get(matchId);
    if (existing && existing.expiresAt > Date.now()) return existing.sessions;
    for (let attempt = 0; attempt < 3; attempt++) {
      const version = this.version(matchId);
      const sessions = await fetch();
      if (version !== this.version(matchId)) continue;
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
