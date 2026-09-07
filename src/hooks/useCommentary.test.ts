import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommentary } from './useCommentary';

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
