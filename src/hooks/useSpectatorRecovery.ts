import { useEffect, useRef } from 'react';
import { incrementRealtimeMetric } from '@/lib/match/realtimeMetrics';

/**
 * Recovery checks are single-flight and never download an unchanged snapshot. Without
 * `pollWhileConnected`, a connected view is only checked after a rejoin or wake, for views
 * whose revision changes with every dart (where a periodic check would reload constantly).
 */
export function useSpectatorRecovery({ matchId, enabled, connected, recoveryVersion, refresh, hasSnapshot = true,
  pollWhileConnected = true }: {
  matchId: string; enabled: boolean; connected: boolean; recoveryVersion: number;
  refresh: () => Promise<void>; hasSnapshot?: boolean; pollWhileConnected?: boolean;
}) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  const inFlight = useRef(false);
  const known = useRef<{ matchId: string; revision: string } | null>(null);
  const previousConnection = useRef({ matchId, version: recoveryVersion });
  // A first subscribe while the first snapshot is still loading catches up once it lands, rather
  // than replacing that load with a second one and delaying the first paint.
  const catchUpAfterSnapshot = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = connected && hasSnapshot ? 60_000 : 15_000;
    // A failed catch-up keeps retrying even when connected views otherwise skip routine checks.
    let catchUpOutstanding = false;
    const controller = new AbortController();
    const available = () => !document.hidden && navigator.onLine;
    const schedule = () => {
      clearTimeout(timer);
      if (connected && !pollWhileConnected && !catchUpOutstanding) return;
      if (!disposed && available()) timer = setTimeout(() => void check(), delay);
    };
    const check = async () => {
      if (disposed || !available()) return;
      if (inFlight.current) {
        clearTimeout(timer);
        timer = setTimeout(() => void check(), 1_000);
        return;
      }
      inFlight.current = true;
      try {
        incrementRealtimeMetric(matchId, 'fallbackPollTicks');
        const response = await fetch(`/api/matches/${matchId}/revision`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Revision check failed');
        const { revision } = await response.json() as { revision: string };
        if (typeof revision !== 'string') throw new Error('Invalid revision');
        if (disposed) return;
        const changed = known.current?.matchId !== matchId || known.current.revision !== revision;
        if (changed) {
          await refreshRef.current();
          if (!disposed) known.current = { matchId, revision };
        }
        delay = connected ? 60_000 : changed ? 15_000 : Math.min(60_000, delay * 2);
        catchUpOutstanding = false;
      } catch {
        delay = 20_000;
        catchUpOutstanding = true;
      } finally {
        inFlight.current = false;
        schedule();
      }
    };
    const wake = () => { if (available()) void check(); };
    // A successful rejoin gets one catch-up check for missed updates.
    const rejoined = previousConnection.current.matchId === matchId
      && recoveryVersion > previousConnection.current.version;
    previousConnection.current = { matchId, version: recoveryVersion };
    if (connected && rejoined && !hasSnapshot) catchUpAfterSnapshot.current = true;
    else if (connected && (rejoined || (hasSnapshot && catchUpAfterSnapshot.current))) {
      catchUpAfterSnapshot.current = false;
      void check();
    } else schedule();
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [matchId, enabled, connected, recoveryVersion, hasSnapshot, pollWhileConnected]);
}
