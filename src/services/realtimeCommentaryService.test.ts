import { describe, expect, it, vi } from 'vitest';
import { RealtimeCommentaryService } from './realtimeCommentaryService';
import type { CommentaryPolicy } from '../lib/commentary/commentaryPolicy';

describe('Realtime commentary playback lifecycle', () => {
  it.each(['audio', 'output_audio'])('keeps the listener and policy busy until %s drains, ignoring old stop events', (audioType) => {
    const onPlaying = vi.fn();
    const service = new RealtimeCommentaryService({ onPlaying });
    const internals = service as unknown as {
      handleEvent: (event: string) => void;
      policy: CommentaryPolicy;
    };
    const send = (event: object) => internals.handleEvent(JSON.stringify(event));
    internals.policy.recordAmbientCall(1_000, true);
    send({ type: 'response.created', response: { id: 'line' } });
    send({ type: 'response.done', response: {
      id: 'line', status: 'completed', output: [{ content: [{ type: audioType }] }],
    } });
    expect(onPlaying).toHaveBeenLastCalledWith(true);
    expect(internals.policy.canStartAmbientCall(20_000)).toBe(false);
    send({ type: 'output_audio_buffer.stopped', response_id: 'older-line' });
    expect(onPlaying).toHaveBeenLastCalledWith(true);
    send({ type: 'output_audio_buffer.stopped', response_id: 'line' });
    expect(onPlaying).toHaveBeenLastCalledWith(false);
    expect(internals.policy.canStartAmbientCall(20_000)).toBe(true);
  });
});
