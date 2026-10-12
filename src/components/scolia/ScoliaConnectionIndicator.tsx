'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, LoaderCircle, WifiOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { getSupabaseClient } from '@/lib/supabaseClient';
import {
  publicStatusFromRow,
  useScoliaBoardRealtime,
  type RealtimeChannelStatus,
} from '@/hooks/useScoliaBoardRealtime';
import {
  describeScoliaConnection,
  formatElapsed,
  isChannelLive,
  type ScoliaConnectionHealth,
  type ScoliaConnectionTone,
} from '@/lib/scolia/connectionHealth';
import type { ScoliaBoardPublicStatus } from '@/lib/scolia/types';
import type { LiveConnectionState } from '@/hooks/useRealtime';

const TONE_CLASS: Record<ScoliaConnectionTone, string> = {
  ready: 'border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
  degraded: 'border-amber-500/60 bg-amber-50 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100',
  down: 'border-red-500/70 bg-red-50 text-red-950 dark:bg-red-950/60 dark:text-red-100',
};

function ToneIcon({ health }: { health: ScoliaConnectionHealth }) {
  const className = 'size-4 shrink-0';
  if (health.tone === 'ready') return <CircleCheck className={cn(className, 'text-emerald-500')} aria-hidden />;
  if (health.label === 'You are offline') return <WifiOff className={className} aria-hidden />;
  if (health.tone === 'degraded') return <LoaderCircle className={cn(className, 'animate-spin text-amber-500')} aria-hidden />;
  return <CircleAlert className={cn(className, 'text-red-500')} aria-hidden />;
}

/**
 * The board's health as one line. `compact` is a pill for headers and corners; the default is a
 * full-width bar that spells out what a degraded state means for scoring.
 */
export function ScoliaConnectionPill({ health, now, compact = false, className }: {
  health: ScoliaConnectionHealth;
  now: number;
  compact?: boolean;
  className?: string;
}) {
  const elapsed = health.tone === 'ready' ? null : formatElapsed(health.since, now);
  const headline = elapsed ? `${health.label} · ${elapsed}` : health.label;
  return (
    <div
      role="status"
      aria-live="polite"
      title={health.detail ?? undefined}
      className={cn(
        'flex items-center gap-2 border',
        compact ? 'inline-flex rounded-full px-2.5 py-1 text-xs' : 'w-full rounded-lg px-3 py-2 text-sm',
        TONE_CLASS[health.tone],
        className,
      )}
    >
      <ToneIcon health={health} />
      <span className="font-semibold tabular-nums">{headline}</span>
      {health.detail && (!compact || health.tone !== 'ready') ? (
        <span className={cn('min-w-0 truncate opacity-80', compact && 'hidden sm:inline')}>{health.detail}</span>
      ) : null}
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * Live connectivity for one Scolia board. It owns its subscription and its clock, so
 * heartbeats re-render only this indicator, never the page around it.
 */
export function ScoliaBoardConnection({ boardId, compact = false, className, onStatusChange }: {
  boardId: string;
  compact?: boolean;
  className?: string;
  /** Receives every status row, e.g. to follow the board phase without a second subscription. */
  onStatusChange?: (status: ScoliaBoardPublicStatus | null) => void;
}) {
  const [status, setStatus] = useState<ScoliaBoardPublicStatus | null | undefined>(undefined);
  const [channel, setChannel] = useState<RealtimeChannelStatus | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const online = useOnline();
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);

  const apply = useCallback((next: ScoliaBoardPublicStatus | null) => {
    setStatus(next);
    setNow(Date.now());
    onStatusChangeRef.current?.(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase.from('scolia_board_public_status').select('*').eq('board_id', boardId).maybeSingle();
      if (error) return; // Keep the last known state; the channel or next reconcile will correct it.
      apply(data ? publicStatusFromRow(data) : null);
    } catch (error) {
      // A status badge must never take the page down; the next reconcile tries again.
      console.warn('Could not load Scolia board status', error);
    }
  }, [apply, boardId]);

  useEffect(() => { void load(); }, [load]);
  useScoliaBoardRealtime({
    onUpsert: apply,
    onRemove: () => apply(null),
    onReconcile: () => void load(),
    onChannelStatus: setChannel,
  }, true, boardId);

  const health = status === undefined
    ? { tone: 'degraded' as const, label: 'Checking board…', detail: null, since: null }
    : describeScoliaConnection(status, { now, live: isChannelLive(channel), online });
  useClock(health.tone, setNow);

  return <ScoliaConnectionPill health={health} now={now} compact={compact} className={className} />;
}

/** A dead worker sends nothing, so staleness needs a clock; tick fast only while showing elapsed time. */
function useClock(tone: ScoliaConnectionTone, setNow: (now: number) => void) {
  const tickMs = tone === 'ready' ? 5_000 : 1_000;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [setNow, tickMs]);
}

/** Health pill for a board whose status the page already tracks (e.g. a list of boards). */
export function ScoliaBoardHealth({ board, live = true, className }: {
  board: Parameters<typeof describeScoliaConnection>[0];
  live?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const online = useOnline();
  const health = describeScoliaConnection(board, { now, live, online });
  useClock(health.tone, setNow);
  return <ScoliaConnectionPill health={health} now={now} compact className={className} />;
}

/** This viewer's own live-update channel, e.g. the match or game data subscription. */
export function LiveUpdatesPill({ state, liveState, since, className }: {
  /** Legacy connection status ('connected' | 'connecting' | 'error' | …), used when `liveState` is absent. */
  state?: string;
  liveState?: LiveConnectionState;
  /** When `liveState` began (epoch ms), shown while degraded. */
  since?: number;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const resolved: LiveConnectionState = liveState ?? (
    state === 'connected' ? 'live' : state === 'connecting' ? 'reconnecting' : 'offline'
  );
  const sinceIso = since ? new Date(since).toISOString() : null;
  const health: ScoliaConnectionHealth = resolved === 'live'
    ? { tone: 'ready', label: 'Live', detail: null, since: null }
    : resolved === 'connecting'
      ? { tone: 'degraded', label: 'Connecting live updates…', detail: null, since: null }
      : resolved === 'reconnecting'
        ? { tone: 'degraded', label: 'Live updates paused', detail: 'Reconnecting…', since: sinceIso }
        : { tone: 'down', label: 'Live updates offline', detail: 'Scores may be out of date', since: sinceIso };
  useClock(health.tone, setNow);
  return <ScoliaConnectionPill health={health} now={now} compact className={className} />;
}
