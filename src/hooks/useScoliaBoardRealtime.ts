'use client';

import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/supabaseClient';
import { ResilientChannel } from '@/lib/scolia/resilientChannel';
import type { ScoliaBoardPublicStatus } from '@/lib/scolia/types';

type StatusRow = {
  board_id: string;
  name: string;
  is_home_sbc: boolean;
  worker_connection_status: ScoliaBoardPublicStatus['workerConnectionStatus'];
  worker_connection_changed_at?: string | null;
  board_status: string | null;
  board_phase: string | null;
  board_phase_changed_at?: string | null;
  error_type: string | null;
  last_event_at: string | null;
  worker_heartbeat_at: string | null;
};

type Handlers = {
  onUpsert: (status: ScoliaBoardPublicStatus) => void;
  onRemove: (boardId: string) => void;
  onOccupancyChange?: () => void;
  /** Called after every (re)subscribe and when the tab wakes or comes back online. */
  onReconcile: () => void;
  /** This client's own channel state; anything but SUBSCRIBED means updates are paused. */
  onChannelStatus?: (status: RealtimeChannelStatus) => void;
};

export type RealtimeChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

export function publicStatusFromRow(row: StatusRow): ScoliaBoardPublicStatus {
  return {
    boardId: row.board_id,
    name: row.name,
    isHomeSbc: row.is_home_sbc,
    workerConnectionStatus: row.worker_connection_status,
    workerConnectionChangedAt: row.worker_connection_changed_at ?? null,
    boardStatus: row.board_status,
    boardPhase: row.board_phase,
    boardPhaseChangedAt: row.board_phase_changed_at ?? null,
    errorType: row.error_type,
    lastEventAt: row.last_event_at,
    workerHeartbeatAt: row.worker_heartbeat_at,
  };
}

/**
 * Live board status. Pass `boardId` when only one board matters: the subscription is then
 * filtered server-side, so other boards' heartbeats never reach this client.
 */
export function useScoliaBoardRealtime(handlers: Handlers, enabled = true, boardId?: string | null) {
  const handlersRef = useRef(handlers);
  const watchesOccupancy = handlers.onOccupancyChange !== undefined;

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let resilient: ResilientChannel | null = null;

    const upsert = (payload: { new: unknown }) => {
      const row = payload.new as StatusRow;
      if (boardId && row.board_id !== boardId) return;
      handlersRef.current.onUpsert(publicStatusFromRow(row));
    };
    const remove = (payload: { old: unknown }) => {
      const removedId = (payload.old as Partial<StatusRow>).board_id;
      if (!removedId || (boardId && removedId !== boardId)) return;
      handlersRef.current.onRemove(removedId);
    };
    const configure = (base: RealtimeChannel) => {
      const table = { schema: 'public', table: 'scolia_board_public_status' } as const;
      let channel = base;
      if (boardId) {
        const filter = `board_id=eq.${boardId}`;
        channel = channel
          .on('postgres_changes', { event: 'INSERT', ...table, filter }, upsert)
          .on('postgres_changes', { event: 'UPDATE', ...table, filter }, upsert)
          // Delete events cannot be filtered server-side; they are rare (a board leaving the account).
          .on('postgres_changes', { event: 'DELETE', ...table }, remove);
      } else {
        channel = channel.on('postgres_changes', { event: '*', ...table }, (payload) => {
          if (payload.eventType === 'DELETE') remove(payload);
          else upsert(payload);
        });
      }
      if (watchesOccupancy) {
        channel = channel
          .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
            handlersRef.current.onOccupancyChange?.();
          })
          .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions' }, () => {
            handlersRef.current.onOccupancyChange?.();
          });
      }
      return channel;
    };

    // A sleeping laptop or dropped network can miss changes without the channel noticing yet.
    const wake = () => {
      if (document.visibilityState === 'visible') handlersRef.current.onReconcile();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);

    void (async () => {
      const supabase = await getSupabaseClient();
      if (cancelled) return;
      // Rebuilt from scratch if realtime-js gives up on it, so it never silently stays dead.
      resilient = new ResilientChannel(supabase, `scolia-board-status-${crypto.randomUUID()}`, configure, (status) => {
        handlersRef.current.onChannelStatus?.(status);
        if (status === 'SUBSCRIBED') handlersRef.current.onReconcile();
      });
      resilient.start();
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      void resilient?.stop();
    };
  }, [enabled, watchesOccupancy, boardId]);
}
