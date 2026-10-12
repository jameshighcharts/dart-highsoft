type HeartbeatStatus = 'sent' | 'ok' | 'error' | 'timeout' | 'disconnected';

type ProbedRealtime = {
  onHeartbeat: (callback: (status: HeartbeatStatus) => void) => void;
  sendHeartbeat: () => Promise<void> | void;
  isConnected: () => boolean;
};

/** No heartbeat reply within this long after waking means the socket died while we slept. */
export const WAKE_PROBE_TIMEOUT_MS = 5_000;
/**
 * realtime-js closes the socket if its scheduled heartbeat finds any heartbeat still unanswered,
 * so a probe sent just before that tick would get no time to be answered. Inside this window the
 * imminent tick is the probe.
 */
export const PROBE_REPLY_WINDOW_MS = 2_000;

type ProbeTarget = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'hidden'>;
};

/**
 * A socket that died while the tab was hidden or the device slept looks connected until the next
 * scheduled heartbeat misses, which can take up to two heartbeat intervals. On wake, probe at once:
 * realtime-js treats a heartbeat still unanswered when the next one is due as a timeout and
 * reconnects, which also rejoins every channel and lets the views reconcile what they missed.
 */
export function installRealtimeWakeProbe(
  realtime: ProbedRealtime,
  target: ProbeTarget = window,
  heartbeatIntervalMs: number | null = null,
): () => void {
  let awaitingSince: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let probing = false;
  let lastScheduledAt: number | null = null;
  realtime.onHeartbeat((status) => {
    if (status === 'sent') {
      awaitingSince ??= Date.now();
      if (!probing) lastScheduledAt = Date.now();
    } else awaitingSince = null;
  });
  /** Milliseconds until the next scheduled heartbeat, or null when unknown. */
  const untilTick = () => heartbeatIntervalMs !== null && lastScheduledAt !== null
    ? Math.max(0, lastScheduledAt + heartbeatIntervalMs - Date.now()) : null;
  const sendProbe = () => {
    probing = true;
    try { void realtime.sendHeartbeat(); } finally { probing = false; }
  };
  const probe = () => {
    if (target.document.hidden || timer || !realtime.isConnected()) return;
    // An earlier heartbeat is already overdue: the next send declares the timeout and reconnects.
    if (awaitingSince !== null && Date.now() - awaitingSince >= WAKE_PROBE_TIMEOUT_MS) {
      void realtime.sendHeartbeat();
      return;
    }
    const tickIn = untilTick();
    const tickIsProbe = tickIn !== null && tickIn < PROBE_REPLY_WINDOW_MS;
    if (awaitingSince === null && !tickIsProbe) sendProbe();
    timer = setTimeout(() => {
      timer = null;
      if (awaitingSince !== null && Date.now() - awaitingSince >= WAKE_PROBE_TIMEOUT_MS) void realtime.sendHeartbeat();
    }, WAKE_PROBE_TIMEOUT_MS + (tickIsProbe ? tickIn : 0));
  };
  target.addEventListener('online', probe);
  target.addEventListener('focus', probe);
  target.document.addEventListener('visibilitychange', probe);
  return () => {
    if (timer) clearTimeout(timer);
    target.removeEventListener('online', probe);
    target.removeEventListener('focus', probe);
    target.document.removeEventListener('visibilitychange', probe);
  };
}
