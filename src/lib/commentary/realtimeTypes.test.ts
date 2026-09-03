import { describe, expect, it } from 'vitest';

import {
  createRealtimeCommentaryCorrectionEnvelope,
  isSuccessfulRealtimeResponse,
  isUuid,
  resolveRealtimeVoice,
} from './realtimeTypes';
import type { RealtimeCommentarySnapshot } from './realtimeSnapshot';

describe('resolveRealtimeVoice', () => {
  it('keeps Realtime voices and maps legacy TTS-only voices', () => {
    expect(resolveRealtimeVoice('echo')).toBe('echo');
    expect(resolveRealtimeVoice('marin')).toBe('marin');
    expect(resolveRealtimeVoice('cedar')).toBe('cedar');
    expect(resolveRealtimeVoice('onyx')).toBe('cedar');
    expect(resolveRealtimeVoice('nova')).toBe('coral');
    expect(resolveRealtimeVoice('fable')).toBe('marin');
  });
});

describe('isSuccessfulRealtimeResponse', () => {
  it('commits transcripts only for completed responses', () => {
    expect(isSuccessfulRealtimeResponse('completed')).toBe(true);
    expect(isSuccessfulRealtimeResponse(undefined)).toBe(true);
    expect(isSuccessfulRealtimeResponse('cancelled')).toBe(false);
    expect(isSuccessfulRealtimeResponse('failed')).toBe(false);
    expect(isSuccessfulRealtimeResponse('incomplete')).toBe(false);
  });
});

describe('isUuid', () => {
  it('accepts canonical UUIDs only', () => {
    expect(isUuid('a24b7292-8580-4af5-95a3-951faca51a37')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('createRealtimeCommentaryCorrectionEnvelope', () => {
  it('carries the replacement snapshot and invalidates every earlier epoch', () => {
    const snapshot = { matchId: 'match-1' } as RealtimeCommentarySnapshot;
    expect(createRealtimeCommentaryCorrectionEnvelope({
      correctionId: 'correction-1',
      reason: 'throw_deleted',
      epoch: 3,
      snapshot,
    })).toEqual({
      schemaVersion: 1,
      kind: 'authoritative_correction',
      correctionId: 'correction-1',
      reason: 'throw_deleted',
      epoch: 3,
      invalidatesEpochsBefore: 3,
      snapshot,
    });
  });
});
