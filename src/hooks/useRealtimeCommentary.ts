"use client";

import { useEffect, useRef, useState } from 'react';

import type { CommentaryPersonaId } from '@/lib/commentary/types';
import {
  RealtimeCommentaryService,
  type RealtimeCommentaryStatus,
} from '@/services/realtimeCommentaryService';
import type { VoiceOption } from '@/services/ttsService';

const SESSION_ROTATION_MS = 50 * 60_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000] as const;

type UseRealtimeCommentaryOptions = {
  matchId: string;
  enabled: boolean;
  personaId: CommentaryPersonaId;
  voice: VoiceOption;
  onTranscript: (transcript: string) => void;
  onTranscriptComplete: (transcript: string) => void;
  onPlaying: (playing: boolean) => void;
};

export function useRealtimeCommentary({
  matchId,
  enabled,
  personaId,
  voice,
  onTranscript,
  onTranscriptComplete,
  onPlaying,
}: UseRealtimeCommentaryOptions) {
  const [status, setStatus] = useState<RealtimeCommentaryStatus>('idle');
  const callbacksRef = useRef({ onTranscript, onTranscriptComplete, onPlaying });
  callbacksRef.current = { onTranscript, onTranscriptComplete, onPlaying };
  const serviceRef = useRef<RealtimeCommentaryService | null>(null);
  const reconnectAttemptRef = useRef(0);
  const optionsRef = useRef({ matchId, personaId, voice });
  optionsRef.current = { matchId, personaId, voice };

  useEffect(() => {
    const service = new RealtimeCommentaryService({
      onStatus: setStatus,
      onTranscript: (value) => callbacksRef.current.onTranscript(value),
      onTranscriptComplete: (value) => callbacksRef.current.onTranscriptComplete(value),
      onPlaying: (value) => callbacksRef.current.onPlaying(value),
      onError: (error) => console.warn('Realtime commentary unavailable; using fallback:', error.message),
    });
    serviceRef.current = service;

    return () => {
      serviceRef.current = null;
      void service.dispose();
    };
  }, []);

  useEffect(() => {
    const service = serviceRef.current;
    if (!service) return;
    if (enabled) {
      void service.connect({ matchId, personaId, voice }).catch(() => {
        // The request-per-turn commentary and TTS path remains the fallback.
      });
    } else {
      void service.close();
    }

    return () => {
      void service.close();
    };
  }, [enabled, matchId, personaId, voice]);

  useEffect(() => {
    if (!enabled || !serviceRef.current) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reconnect = () => {
      const service = serviceRef.current;
      if (!service) return;
      void service.connect(optionsRef.current).catch(() => {
        // A later failed status schedules the next bounded retry.
      });
    };

    if (status === 'ready') {
      reconnectAttemptRef.current = 0;
      timer = setTimeout(reconnect, SESSION_ROTATION_MS);
    } else if (status === 'failed') {
      const attempt = reconnectAttemptRef.current;
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
      reconnectAttemptRef.current = attempt + 1;
      timer = setTimeout(reconnect, delay);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [enabled, status]);

  return { serviceRef, status };
}
