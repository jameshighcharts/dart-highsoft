"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { resolvePersona } from '@/lib/commentary/personas';
import type {
  CommentaryPersona,
  CommentaryPersonaId,
  CommentaryTranscriptEntry,
} from '@/lib/commentary/types';
import type { RealtimeCommentaryService, RealtimeCommentaryStatus } from '@/services/realtimeCommentaryService';
import { getTTSService, type VoiceOption } from '@/services/ttsService';
import { useRealtimeCommentary } from '@/hooks/useRealtimeCommentary';
import { resolveRealtimeVoice } from '@/lib/commentary/realtimeTypes';

type UseCommentaryResult = {
  commentaryEnabled: boolean;
  audioEnabled: boolean;
  voice: VoiceOption;
  personaId: CommentaryPersonaId;
  currentCommentary: string | null;
  commentaryTranscriptLog: CommentaryTranscriptEntry[];
  commentaryLoading: boolean;
  commentaryPlaying: boolean;
  activePersona: CommentaryPersona;
  ttsServiceRef: MutableRefObject<ReturnType<typeof getTTSService>>;
  realtimeCommentaryRef: MutableRefObject<RealtimeCommentaryService | null>;
  realtimeCommentaryReady: boolean;
  realtimeCommentaryStatus: RealtimeCommentaryStatus;
  toggleQuickCommentary: () => void;
  setCurrentCommentary: (value: string | null) => void;
  recordCompletedCommentary: (value: string) => void;
  clearCommentaryTranscriptLog: () => void;
  setCommentaryLoading: (value: boolean) => void;
  setCommentaryPlaying: (value: boolean) => void;
  setAudioEnabled: (value: boolean) => void;
  setVoice: (value: VoiceOption) => void;
  setPersonaId: (value: CommentaryPersonaId) => void;
  handleCommentaryEnabledChange: (enabled: boolean) => void;
  handleAudioEnabledChange: (enabled: boolean) => void;
  handlePersonaChange: (nextPersona: CommentaryPersonaId) => void;
  skipCommentary: () => void;
};

export function useCommentary(matchId: string, autoStart = false): UseCommentaryResult {
  const [commentaryEnabled, setCommentaryEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [voice, setVoice] = useState<VoiceOption>('cedar');
  const [personaId, setPersonaId] = useState<CommentaryPersonaId>('chad');
  const [currentCommentary, setCurrentCommentary] = useState<string | null>(null);
  const [commentaryTranscriptLog, setCommentaryTranscriptLog] = useState<CommentaryTranscriptEntry[]>([]);
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [commentaryPlaying, setCommentaryPlaying] = useState(false);
  const ttsServiceRef = useRef(getTTSService());
  const activePersona = useMemo(() => resolvePersona(personaId), [personaId]);
  const recordCompletedCommentary = useCallback((value: string) => {
    setCommentaryTranscriptLog((current) => appendCommentaryTranscript(current, value));
  }, []);
  const clearCommentaryTranscriptLog = useCallback(() => {
    setCommentaryTranscriptLog([]);
  }, []);
  const { serviceRef: realtimeCommentaryRef, status: realtimeCommentaryStatus } =
    useRealtimeCommentary({
      matchId,
      enabled: commentaryEnabled && audioEnabled,
      personaId,
      voice,
      onTranscript: setCurrentCommentary,
      onTranscriptComplete: recordCompletedCommentary,
      onPlaying: setCommentaryPlaying,
    });

  const handleCommentaryEnabledChange = useCallback(
    (enabled: boolean) => {
      setCommentaryEnabled(enabled);
      if (enabled && audioEnabled) {
        void realtimeCommentaryRef.current?.unlock();
        void ttsServiceRef.current.unlock();
      }
    },
    [audioEnabled, realtimeCommentaryRef]
  );

  const handleAudioEnabledChange = useCallback(
    (enabled: boolean) => {
      setAudioEnabled(enabled);
      if (enabled && commentaryEnabled) {
        void realtimeCommentaryRef.current?.unlock();
        void ttsServiceRef.current.unlock();
      }
    },
    [commentaryEnabled, realtimeCommentaryRef]
  );

  const handlePersonaChange = useCallback((nextPersona: CommentaryPersonaId) => {
    setPersonaId(nextPersona);
  }, []);

  const toggleQuickCommentary = useCallback(() => {
    if (commentaryEnabled && audioEnabled) {
      realtimeCommentaryRef.current?.skip();
      ttsServiceRef.current.clearQueue();
      setCommentaryPlaying(false);
      setAudioEnabled(false);
      setCommentaryEnabled(false);
      return;
    }
    // Unlock during the gesture; separate toggle handlers see pre-click state.
    void realtimeCommentaryRef.current?.unlock();
    void ttsServiceRef.current.unlock();
    setVoice('verse');
    setAudioEnabled(true);
    setCommentaryEnabled(true);
  }, [commentaryEnabled, audioEnabled, realtimeCommentaryRef]);

  const skipCommentary = useCallback(() => {
    realtimeCommentaryRef.current?.skip();
    ttsServiceRef.current.skipCurrent();
    setCommentaryPlaying(false);
  }, [realtimeCommentaryRef]);

  // Load commentary preferences; new matches remain disabled unless opted in.
  useEffect(() => {
    setCommentaryTranscriptLog([]);
  }, [matchId]);

  const preferencesLoadedRef = useRef(false);
  useEffect(() => {
    if (preferencesLoadedRef.current) return;
    preferencesLoadedRef.current = true;
    try {
      // Ignore legacy enable flags; auto-start is an explicit match preference.
      localStorage.setItem('commentary-enabled', 'false');
      localStorage.setItem('chad-enabled', 'false');
      localStorage.setItem('commentary-audio-enabled', 'false');
      localStorage.setItem('chad-audio-enabled', 'false');
      ttsServiceRef.current.updateSettings({ enabled: false });

      const savedPersona = localStorage.getItem('commentary-persona');
      if (savedPersona) {
        setPersonaId(resolvePersona(savedPersona).id as CommentaryPersonaId);
      }

      const ttsSettings = ttsServiceRef.current.getSettings();
      setVoice(resolveRealtimeVoice(ttsSettings.voice));
    } catch (error) {
      console.error('Failed to load commentary settings:', error);
    }
  }, []);

  // Apply the new-match preference once, so manual toggles remain authoritative.
  const autoStartedMatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoStart || autoStartedMatchRef.current === matchId) return;
    autoStartedMatchRef.current = matchId;
    if (!commentaryEnabled || !audioEnabled) toggleQuickCommentary();
  }, [autoStart, matchId, commentaryEnabled, audioEnabled, toggleQuickCommentary]);

  // Save commentary enabled state
  useEffect(() => {
    try {
      localStorage.setItem('commentary-enabled', commentaryEnabled.toString());
      // legacy key support
      localStorage.setItem('chad-enabled', commentaryEnabled.toString());
    } catch (error) {
      console.error('Failed to save commentary enabled:', error);
    }
  }, [commentaryEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem('commentary-audio-enabled', audioEnabled.toString());
      // legacy key support
      localStorage.setItem('chad-audio-enabled', audioEnabled.toString());
      ttsServiceRef.current.updateSettings({ enabled: audioEnabled });
    } catch (error) {
      console.error('Failed to save audio enabled:', error);
    }
  }, [audioEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem('commentary-persona', personaId);
    } catch (error) {
      console.error('Failed to save commentary persona:', error);
    }
  }, [personaId]);

  useEffect(() => {
    if (!audioEnabled) {
      return;
    }

    const unlockOnFirstInteraction = () => {
      void realtimeCommentaryRef.current?.unlock();
      void ttsServiceRef.current.unlock();
    };

    window.addEventListener('pointerdown', unlockOnFirstInteraction, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockOnFirstInteraction);
    };
  }, [audioEnabled, realtimeCommentaryRef]);

  useEffect(() => {
    try {
      // Update TTSService with new voice (TTSService handles localStorage)
      ttsServiceRef.current.updateSettings({ voice });
    } catch (error) {
      console.error('Failed to save voice:', error);
    }
  }, [voice]);

  return {
    commentaryEnabled,
    audioEnabled,
    voice,
    personaId,
    currentCommentary,
    commentaryTranscriptLog,
    commentaryLoading,
    commentaryPlaying,
    activePersona,
    ttsServiceRef,
    realtimeCommentaryRef,
    realtimeCommentaryReady: realtimeCommentaryStatus === 'ready',
    realtimeCommentaryStatus,
    toggleQuickCommentary,
    setCurrentCommentary,
    recordCompletedCommentary,
    clearCommentaryTranscriptLog,
    setCommentaryLoading,
    setCommentaryPlaying,
    setAudioEnabled,
    setVoice,
    setPersonaId,
    handleCommentaryEnabledChange,
    handleAudioEnabledChange,
    handlePersonaChange,
    skipCommentary,
  };
}

export const MAX_COMMENTARY_TRANSCRIPTS = 50;

type TranscriptEntryFactory = {
  id?: () => string;
  now?: () => string;
};

export function appendCommentaryTranscript(
  current: CommentaryTranscriptEntry[],
  value: string,
  factory: TranscriptEntryFactory = {}
): CommentaryTranscriptEntry[] {
  const text = value.trim();
  if (!text || current.at(-1)?.text === text) return current;

  const entry: CommentaryTranscriptEntry = {
    id: factory.id?.() ?? crypto.randomUUID(),
    text,
    completedAt: factory.now?.() ?? new Date().toISOString(),
  };

  return [...current, entry].slice(-MAX_COMMENTARY_TRANSCRIPTS);
}
