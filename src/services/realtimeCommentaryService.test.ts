import type { RealtimeNarrativeWireState } from '../lib/commentary/realtimeWireFormat';
import type { RivalryBeat } from '../lib/commentary/commentaryNarrative';
import type { BroadcastDirection } from '../lib/commentary/broadcastDirector';
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


describe('Realtime rivalry callback delivery', () => {
  it.each(['drained', 'cleared'])('records callback material only when generated audio is %s', (ending) => {
    const service = new RealtimeCommentaryService();
    const internals = service as unknown as {
      handleEvent: (raw: string) => void;
      wireState: RealtimeNarrativeWireState;
      pendingStoryResponses: Map<string, { sourceEventId: string; direction: BroadcastDirection }>;
    };
    const beat: RivalryBeat = {
      rivalry: { key: 'streak', kind: 'streak', subjectId: 'a', counterpartId: 'b', scope: 'direct',
        fieldSize: 2, meetings: 5, subjectWins: 1, counterpartWins: 4, streak: 3 },
      eventId: 'setup', sequence: 3, stage: 'establish', development: 'opening', winnerId: null, callbackExcerpt: null,
    };
    const direction: BroadcastDirection = {
      schemaVersion: 1, sequence: 3, activeStoryArc: null, backgroundStoryArcs: [],
      transition: 'none', callback: null, shouldPromote: false, lifecycleEvents: [], rivalry: beat,
    };
    internals.wireState.rivalry.reset(beat.rivalry);
    internals.wireState.rivalry.dispatched(beat);
    internals.pendingStoryResponses.set('setup-token', { sourceEventId: 'setup', direction });
    const send = (event: object) => internals.handleEvent(JSON.stringify(event));
    send({ type: 'response.created', response: { id: 'line', metadata: { story_token: 'setup-token' } } });
    send({ type: 'response.output_audio_transcript.done', response_id: 'line', transcript: 'Starting to charge rent.' });
    send({ type: 'response.done', response: { id: 'line', status: 'completed', output: [{ content: [{ type: 'output_audio' }] }] } });
    const observe = (sequence: number) => internals.wireState.rivalry.observe({
      eventId: `event-${sequence}`, sequence, turnId: `turn-${sequence}`, playerId: 'a',
      probabilityBefore: 0.3, probabilityAfter: 0.6, matchChance: false, completedVisit: true,
      checkedOut: false, busted: false, protectedMoment: false, legResolved: false,
      fairEndingPending: false, winnerId: null,
    });
    expect(observe(9)?.callbackExcerpt).toBeNull();
    send({ type: 'output_audio_buffer.stopped', response_id: 'older-line' });
    expect(observe(12)?.callbackExcerpt).toBeNull();
    send({ type: ending === 'drained' ? 'output_audio_buffer.stopped' : 'output_audio_buffer.cleared', response_id: 'line' });
    expect(observe(15)?.callbackExcerpt).toBe(ending === 'drained' ? 'Starting to charge rent.' : null);
  });
});
