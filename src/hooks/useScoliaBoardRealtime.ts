'use client';

import { useEffect, useRef } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseClient } from '@/lib/supabaseClient';
import type { ScoliaBoardPublicStatus } from '@/lib/scolia/types';

type StatusRow = {
  board_id: string;
  name: string;
  is_home_sbc: boolean;
  worker_connection_status: ScoliaBoardPublicStatus['workerConnectionStatus'];
  board_status: string | null;
  board_phase: string | null;
  error_type: string | null;
  last_event_at: string | null;
  worker_heartbeat_at: string | null;
};

type Handlers = {
  onUpsert: (status: ScoliaBoardPublicStatus) => void;
  onRemove: (boardId: string) => void;
  onMatchChange: () => void;
  onReconcile: () => void;
};

function publicStatusFromRow(row: StatusRow): ScoliaBoardPublicStatus {
  return {
    boardId: row.board_id,
    name: row.name,
    isHomeSbc: row.is_home_sbc,
    workerConnectionStatus: row.worker_connection_status,
    boardStatus: row.board_status,
    boardPhase: row.board_phase,
    errorType: row.error_type,
    lastEventAt: row.last_event_at,
    workerHeartbeatAt: row.worker_heartbeat_at,
  };
}

export function useScoliaBoardRealtime(handlers: Handlers, enabled = true) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let supabase: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;

    void (async () => {
      supabase = await getSupabaseClient();
      if (cancelled) return;

      channel = supabase
        .channel(`scolia-board-status-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'scolia_board_public_status' }, (payload) => {
          if (payload.eventType === 'DELETE') {
            const boardId = (payload.old as Partial<StatusRow>).board_id;
            if (boardId) handlersRef.current.onRemove(boardId);
            return;
          }
          handlersRef.current.onUpsert(publicStatusFromRow(payload.new as StatusRow));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
          handlersRef.current.onMatchChange();
        })
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED') return;
          handlersRef.current.onReconcile();
        });

    })();

    return () => {
      cancelled = true;
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [enabled]);
}
