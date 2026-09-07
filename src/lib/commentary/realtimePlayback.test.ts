import { describe, expect, it } from 'vitest';
import { RealtimePlayback, hasRealtimeAudioOutput } from './realtimePlayback';

describe('Realtime audio output detection', () => {
  it.each(['output_audio', 'audio'])('recognizes %s even after a text item', (type) => {
    expect(hasRealtimeAudioOutput({ output: [
      { content: [{ type: 'output_text' }] }, { content: [{ type }] },
    ] })).toBe(true);
  });

  it('does not wait for audio from silent or text-only responses', () => {
    expect(hasRealtimeAudioOutput()).toBe(false);
    expect(hasRealtimeAudioOutput({ output: [] })).toBe(false);
    expect(hasRealtimeAudioOutput({ output: [{}, { content: [{ type: 'output_text' }] }] })).toBe(false);
  });
});

describe('Realtime playback ownership', () => {
  it('holds speech after generation finishes, including before audio starts', () => {
    const playback = new RealtimePlayback();
    playback.created('first');
    playback.generationFinished('first', true);
    expect(playback.busy).toBe(true);
    expect(playback.stopped('first')).toBe(true);
    expect(playback.busy).toBe(false);
  });

  it('ignores late audio events from an interrupted line', () => {
    const playback = new RealtimePlayback();
    playback.created('first');
    playback.reset();
    playback.created('urgent');
    playback.generationFinished('urgent', true);
    expect(playback.stopped('first')).toBe(false);
    playback.generationFinished('first', false);
    expect(playback.busy).toBe(true);
    expect(playback.stopped('urgent')).toBe(true);
  });

  it('releases silent or failed generations without waiting for nonexistent audio', () => {
    const playback = new RealtimePlayback();
    playback.created('silent');
    playback.generationFinished('silent', false);
    expect(playback.busy).toBe(false);
  });

  it('handles cleared audio arriving before cancellation completes', () => {
    const playback = new RealtimePlayback();
    playback.created('first');
    expect(playback.stopped('first')).toBe(false);
    playback.generationFinished('first', true);
    expect(playback.busy).toBe(false);
  });
});
