import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeSessionCache } from './realtimeSessionCache';
import type { ActiveRealtimeCommentarySession } from './realtimeTypes';
afterEach(() => vi.useRealTimers());
const session = (epoch=0) => ({id:'s',epoch,last_seen_at:new Date(Date.now()-40_000).toISOString(),created_at:new Date().toISOString()} as ActiveRealtimeCommentarySession);
describe('Realtime listener cache', () => {
  it('reuses active listeners but never extends their heartbeat deadline', async () => {
    vi.useFakeTimers(); const cache=new RealtimeSessionCache(); const fetch=vi.fn().mockResolvedValue([session()]);
    await cache.load('m',fetch); await cache.load('m',fetch); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001); fetch.mockResolvedValue([]);
    expect(await cache.load('m',fetch)).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('discards an in-flight lookup invalidated by a new listener/correction', async () => {
    const cache=new RealtimeSessionCache(); let release!:(rows:ActiveRealtimeCommentarySession[])=>void;
    const fetch=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;})).mockResolvedValue([session(2)]);
    const result=cache.load('m',fetch); cache.invalidate('m'); release([session(1)]);
    expect((await result)[0].epoch).toBe(2); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('refreshes cached empty results when a listener joins and refuses expired cache on read failure', async () => {
    vi.useFakeTimers();const cache=new RealtimeSessionCache(); const fetch=vi.fn().mockResolvedValue([]);
    await cache.load('m',fetch); cache.invalidate('m');fetch.mockResolvedValue([session()]);
    expect(await cache.load('m',fetch)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);fetch.mockRejectedValue(new Error('offline'));
    await expect(cache.load('m',fetch)).rejects.toThrow('offline');
  });
});
