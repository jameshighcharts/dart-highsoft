import { isLiveScoringBroadcast, liveMatchTopic } from '@/lib/match/liveScoringBroadcast';
import { useEffect, useState, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { incrementRealtimeMetric, recordRealtimeDeliveryDelay, recordBroadcastStatus } from '@/lib/match/realtimeMetrics';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function useRealtime(matchId: string) {
  const [lastError, setLastError] = useState<{ matchId: string; message: string } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const channelRef = useRef<RealtimeChannel | null>(null);
  const generationRef = useRef(0);
  const connectingRef = useRef(false);
  const removalRef = useRef<Promise<unknown>>(Promise.resolve());
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const supabaseRef = useRef<SupabaseClient | null>(null);

  const disconnect = useCallback(() => {
    generationRef.current += 1;
    connectingRef.current = false;
    const previous = channelRef.current;
    channelRef.current = null;
    if (previous && supabaseRef.current) {
      removalRef.current = supabaseRef.current.removeChannel(previous).catch(error => {
        console.warn('Could not remove old match channel', error);
      });
    }
    setConnectionStatus('disconnected');
  }, []);

  const connect = useCallback(async () => {
    if (channelRef.current || connectingRef.current) return;
    connectingRef.current = true;
    const generation = ++generationRef.current;
    const current = () => generationRef.current === generation;

    try {
      setConnectionStatus('connecting');
      // Supabase retains a topic until removal completes. Joining too early can
      // return the same closing channel rather than a fresh subscription.
      await removalRef.current;
      if (!current()) return;
      const supabase = await getSupabaseClient();
      if (!current()) return;
      supabaseRef.current = supabase;
      
      const newChannel = supabase
        .channel(`dart_match_${matchId}`, {
          config: {
            presence: {
              key: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            },
          },
        })
        .on('broadcast', { event: 'rematch-created' }, (payload) => {
          if (!current()) return;
          window.dispatchEvent(new CustomEvent('supabase-rematch-created', { detail: payload?.payload }));
        })
        .on('system', {}, (payload) => {
          if (!current()) return;
          // Realtime can report postgres subscription errors via system events even when
          // channel status is "SUBSCRIBED". Surface this as an error so spectator mode
          // can fall back to polling instead of appearing connected but stale.
          const extension = payload && typeof payload === 'object' && 'extension' in payload ? payload.extension : null;
          const status = payload && typeof payload === 'object' && 'status' in payload ? payload.status : null;
          const message = payload && typeof payload === 'object' && 'message' in payload ? payload.message : null;
          const text = typeof message === 'string' ? message : '';
          const normalizedText = text.toLowerCase();
          const isEmptyObjectPayload = payload && typeof payload === 'object' && Object.keys(payload).length === 0;
          const isWildcardInspectorError = normalizedText.includes('table: *') || normalizedText.includes('table:*');
          const hasSubscriptionFailureText = normalizedText.includes('unable to subscribe to changes');
          if (extension === 'postgres_changes' && hasSubscriptionFailureText) {
            // Ignore known noisy payloads (for example wildcard inspector probes) that
            // can appear transiently while the actual app subscriptions are healthy.
            if (isEmptyObjectPayload || isWildcardInspectorError) {
              if (process.env.NODE_ENV !== 'production') {
                console.warn('Realtime postgres_changes warning ignored:', payload);
              }
              return;
            }
            // Keep the channel as connected here. In practice these system payloads can be
            // noisy/transient while websocket updates still flow. For explicit subscription
            // failures, mark connection as error so spectators can enable polling fallback.
            console.warn('Realtime postgres_changes subscription warning:', payload);
            if (status === 'error') {
              incrementRealtimeMetric(matchId, 'channelErrorTransitions');
              setLastError({ matchId, message: text || 'Database subscription failed.' });
              setConnectionStatus('error');
            }
          }
        })
        // Add database change listeners directly here
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'throws',
            filter: `match_id=eq.${matchId}`,
          },
          (payload) => {
            if (!current()) return;
            incrementRealtimeMetric(matchId, 'throwsEvents');
            recordRealtimeDeliveryDelay(matchId, payload);
            window.dispatchEvent(new CustomEvent('supabase-throws-change', { detail: payload }));
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'turns',
            filter: `match_id=eq.${matchId}`,
          },
          (payload) => {
            if (!current()) return;
            incrementRealtimeMetric(matchId, 'turnsEvents');
            recordRealtimeDeliveryDelay(matchId, payload);
            window.dispatchEvent(new CustomEvent('supabase-turns-change', { detail: payload }));
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'legs',
            filter: `match_id=eq.${matchId}`,
          },
          (payload) => {
            if (!current()) return;
            incrementRealtimeMetric(matchId, 'legsEvents');
            recordRealtimeDeliveryDelay(matchId, payload);
            window.dispatchEvent(new CustomEvent('supabase-legs-change', { detail: payload }));
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'matches',
            filter: `id=eq.${matchId}`,
          },
          (payload) => {
            if (!current()) return;
            incrementRealtimeMetric(matchId, 'matchesEvents');
            recordRealtimeDeliveryDelay(matchId, payload);
            window.dispatchEvent(new CustomEvent('supabase-matches-change', { detail: payload }));
          }
        );

      for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
        newChannel.on('postgres_changes', {
          event, schema: 'public', table: 'match_players',
          // Supabase cannot filter DELETE events; retain client filtering for those only.
          ...(event === 'DELETE' ? {} : { filter: `match_id=eq.${matchId}` }),
        }, payload => {
          if (!current()) return;
          const record = payload.eventType === 'DELETE' ? payload.old : payload.new;
          if (record && 'match_id' in record && record.match_id === matchId) {
            incrementRealtimeMetric(matchId, 'matchPlayersEvents');
            recordRealtimeDeliveryDelay(matchId, payload);
            window.dispatchEvent(new CustomEvent('supabase-match-players-change', { detail: payload }));
          }
        });
      }

      channelRef.current = newChannel;
      connectingRef.current = false;
      // Subscribe to the channel
      newChannel.subscribe((status, error) => {
        if (!current()) return;
        if (status === 'SUBSCRIBED') {
          incrementRealtimeMetric(matchId, 'channelConnectedTransitions');
          setConnectionStatus('connected');
          setRecoveryVersion(value => value + 1);
        } else if (status === 'CHANNEL_ERROR') {
          setLastError(previous => ({ matchId, message: error?.message
            || (previous?.matchId === matchId ? previous.message : 'Database channel failed; the server supplied no error details.') }));
          incrementRealtimeMetric(matchId, 'channelErrorTransitions');
          setConnectionStatus('error');
        } else if (status === 'TIMED_OUT') {
          setLastError({ matchId, message: error?.message || 'Database subscription timed out.' });
          incrementRealtimeMetric(matchId, 'channelErrorTransitions');
          setConnectionStatus('error');
        } else if (status === 'CLOSED') {
          setLastError(previous => previous?.matchId === matchId ? previous
            : { matchId, message: 'Database channel closed unexpectedly; no reason was supplied.' });
          incrementRealtimeMetric(matchId, 'channelClosedTransitions');
          setConnectionStatus('disconnected');
        }
      });
    } catch (error) {
      if (!current()) return;
      connectingRef.current = false;
      console.error('💥 Failed to connect to realtime:', error);
      setLastError({ matchId, message: error instanceof Error ? error.message : 'Could not initialize the database connection.' });
      setConnectionStatus('error');
    }
  }, [matchId]);

  // Update presence (indicate this user is viewing the match)
  const updatePresence = useCallback(async (isSpectator = false) => {
    const channel = channelRef.current;
    if (channel && connectionStatus === 'connected') {
      await channel.track({
        user_id: Math.random().toString(36).substr(2, 9), // Generate a temp user ID
        is_spectator: isSpectator,
        timestamp: new Date().toISOString(),
      });
    }
  }, [connectionStatus]);

  const broadcastRematch = useCallback(
    async (newMatchId: string) => {
      const channel = channelRef.current;
      if (channel && connectionStatus === 'connected') {
        await channel.send({
          type: 'broadcast',
          event: 'rematch-created',
          payload: { newMatchId },
        });
      }
    },
    [connectionStatus]
  );

  const [broadcastAttempt, setBroadcastAttempt] = useState(0);
  const broadcastFailures = useRef(0);
  const broadcastRemoval = useRef<Promise<unknown>>(Promise.resolve());

  // Separate private channel: clients may receive committed scores, never publish them.
  useEffect(() => {
    let disposed = false;
    let broadcastChannel: RealtimeChannel | null = null;
    let client: SupabaseClient | null = null;
    let lastStatus: string | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const retryBroadcast = () => {
      if (disposed || document.hidden || !navigator.onLine) return;
      setBroadcastAttempt(value => value + 1);
    };
    const scheduleRetry = () => {
      clearTimeout(retry);
      retry = setTimeout(retryBroadcast, Math.min(60_000, 5_000 * 2 ** broadcastFailures.current++));
    };
    const wake = () => { if (lastStatus !== 'SUBSCRIBED') retryBroadcast(); };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    scheduleRetry();
    recordBroadcastStatus(matchId, 'connecting');
    void broadcastRemoval.current.then(() => getSupabaseClient()).then(supabase => {
      if (disposed) return;
      client = supabase;
      broadcastChannel = supabase.channel(liveMatchTopic(matchId), { config: { private: true } })
        .on('broadcast', { event: 'scoring-commit' }, event => {
          if (!disposed && isLiveScoringBroadcast(event.payload, matchId)) {
            incrementRealtimeMetric(matchId, 'scoringCommitBroadcasts');
            window.dispatchEvent(new CustomEvent('supabase-scoring-commit', { detail: event.payload }));
          }
        });
      broadcastChannel.subscribe((status, error) => {
        if (disposed) return;
        recordBroadcastStatus(matchId, status === 'SUBSCRIBED' ? 'connected'
          : status === 'CLOSED' ? 'disconnected' : 'error');
        if (status !== 'SUBSCRIBED' && status !== lastStatus) {
          console.warn('Live score broadcast unavailable; database realtime remains active', status, error);
        }
        if (status === 'SUBSCRIBED') {
          clearTimeout(retry);
          broadcastFailures.current = 0;
        } else scheduleRetry();
        lastStatus = status;
      });
    }).catch(error => {
      if (disposed) return;
      recordBroadcastStatus(matchId, 'error');
      console.warn('Live score broadcast unavailable; database realtime remains active', error);
      scheduleRetry();
    });
    return () => {
      disposed = true;
      clearTimeout(retry);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      recordBroadcastStatus(matchId, 'disconnected');
      if (broadcastChannel && client) {
        broadcastRemoval.current = client.removeChannel(broadcastChannel).catch(error => {
          console.warn('Could not remove old score channel', error);
        });
      }
    };
  }, [matchId, broadcastAttempt]);

  // Stable ownership: state changes never tear down a healthy subscription.
  useEffect(() => {
    void connect();
    return disconnect;
  }, [connect, disconnect]);

  const retryAttempt = useRef(0);
  const [retryVersion, setRetryVersion] = useState(0);
  useEffect(() => {
    if (connectionStatus === 'connected') {
      retryAttempt.current = 0;
      return;
    }
    // Give the SDK time to rejoin first, then replace a stuck/closed channel.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recover = () => {
      if (document.hidden || !navigator.onLine) return;
      retryAttempt.current += 1;
      disconnect();
      void connect();
      setRetryVersion(value => value + 1);
    };
    const schedule = () => {
      if (document.hidden || !navigator.onLine) return;
      clearTimeout(timer);
      timer = setTimeout(recover, Math.min(30_000, (connectionStatus === 'connecting' ? 10_000 : 3_000) * 2 ** retryAttempt.current));
    };
    const wake = () => {
      if (!document.hidden && navigator.onLine) recover();
    };
    schedule();
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [connectionStatus, connect, disconnect, retryVersion]);

  return {
    connectionError: lastError?.matchId === matchId ? lastError.message : null,
    connectionStatus,
    recoveryVersion,
    connect,
    disconnect,
    updatePresence,
    broadcastRematch,
    isConnected: connectionStatus === 'connected',
  };
}
