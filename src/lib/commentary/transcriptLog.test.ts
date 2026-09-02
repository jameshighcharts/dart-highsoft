import { describe, expect, it } from 'vitest';
import {
  MAX_COMMENTARY_TRANSCRIPTS,
  appendCommentaryTranscript,
} from './transcriptLog';
import type { CommentaryTranscriptEntry } from './types';

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
