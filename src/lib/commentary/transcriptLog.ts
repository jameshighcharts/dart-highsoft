import type { CommentaryTranscriptEntry } from './types';

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
