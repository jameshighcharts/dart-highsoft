import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommentary, MAX_COMMENTARY_TRANSCRIPTS, appendCommentaryTranscript } from './useCommentary';
import type { CommentaryTranscriptEntry } from '@/lib/commentary/types';

const mocks = vi.hoisted(() => ({
  realtime: { unlock: vi.fn(), skip: vi.fn() },
  tts: {
    unlock: vi.fn(), clearQueue: vi.fn(), updateSettings: vi.fn(),
    getSettings: () => ({ voice: 'cedar' }),
  },
  useRealtime: vi.fn(),
}));
vi.mock('@/services/ttsService', () => ({ getTTSService: () => mocks.tts }));
vi.mock('@/hooks/useRealtimeCommentary', () => ({ useRealtimeCommentary: mocks.useRealtime }));

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe('one-tap commentary', () => {
  it('unlocks both outputs in the gesture and connects with Verse from both toggles off', () => {
    mocks.useRealtime.mockReturnValue({ serviceRef: { current: mocks.realtime }, status: 'idle' });
    const { result } = renderHook(() => useCommentary('match'));
    act(() => {
      result.current.toggleQuickCommentary();
      expect(mocks.realtime.unlock).toHaveBeenCalledOnce();
      expect(mocks.tts.unlock).toHaveBeenCalledOnce();
    });
    expect(result.current.commentaryEnabled).toBe(true);
    expect(result.current.audioEnabled).toBe(true);
    expect(mocks.useRealtime).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, voice: 'verse' }));
    expect(result.current.realtimeCommentaryReady).toBe(false);
  });

  it('exposes actual readiness and stops both outputs on the second tap', () => {
    mocks.useRealtime.mockReturnValue({ serviceRef: { current: mocks.realtime }, status: 'ready' });
    const { result } = renderHook(() => useCommentary('match'));
    act(() => result.current.toggleQuickCommentary());
    expect(result.current.realtimeCommentaryStatus).toBe('ready');
    act(() => result.current.toggleQuickCommentary());
    expect(mocks.realtime.skip).toHaveBeenCalledOnce();
    expect(mocks.tts.clearQueue).toHaveBeenCalledOnce();
    expect(result.current.commentaryEnabled).toBe(false);
    expect(result.current.audioEnabled).toBe(false);
    expect(mocks.useRealtime).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
});

const entry = (index: number): CommentaryTranscriptEntry => ({
  id: `call-${index}`,
  text: `Call ${index}`,
  completedAt: `2026-09-02T12:00:${String(index).padStart(2, '0')}Z`,
});

describe('appendCommentaryTranscript', () => {
  it('trims and appends completed commentary', () => {
    expect(appendCommentaryTranscript([], '  Nå snakke me!  ', {
      id: () => 'new-call',
      now: () => '2026-09-02T12:00:00Z',
    })).toEqual([{
      id: 'new-call',
      text: 'Nå snakke me!',
      completedAt: '2026-09-02T12:00:00Z',
    }]);
  });

  it('ignores blank and immediately repeated calls', () => {
    const current = [entry(1)];
    expect(appendCommentaryTranscript(current, '   ')).toBe(current);
    expect(appendCommentaryTranscript(current, 'Call 1')).toBe(current);
  });

  it('keeps only the latest completed calls', () => {
    const current = Array.from({ length: MAX_COMMENTARY_TRANSCRIPTS }, (_, index) => entry(index));
    const next = appendCommentaryTranscript(current, 'Newest', {
      id: () => 'newest',
      now: () => '2026-09-02T13:00:00Z',
    });

    expect(next).toHaveLength(MAX_COMMENTARY_TRANSCRIPTS);
    expect(next[0]?.id).toBe('call-1');
    expect(next.at(-1)?.text).toBe('Newest');
  });
});
