import type { CommentaryPersonaId } from '@/lib/commentary/types';
import type { VoiceOption } from '@/services/ttsService';
import type { RealtimeCommentarySnapshot } from './realtimeSnapshot';
import type { CommentaryPolicyDecision, CommentaryPolicyEvent } from './commentaryPolicy';

export const REALTIME_COMMENTARY_MODEL =
  process.env.OPENAI_REALTIME_COMMENTARY_MODEL?.trim() || 'gpt-realtime-2.1';

export type RealtimeCommentarySessionRequest = {
  matchId: string;
  clientInstanceId: string;
  offerSdp: string;
  personaId: CommentaryPersonaId;
  voice: VoiceOption;
};

export type RealtimeCommentarySessionResponse = {
  answerSdp: string;
  sessionId: string;
  epoch: number;
  snapshot: RealtimeCommentarySnapshot;
  snapshotSource: 'browser' | 'worker';
};

export type RealtimeCommentarySessionControl = {
  matchId: string;
  sessionId: string;
};

export type RealtimeCommentaryPolicyDecisionRequest = RealtimeCommentarySessionControl & {
  action: 'policy_decision';
  sourceEventId: string;
  turnId?: string;
  epoch: number;
  policyVersion: string;
  priority: CommentaryPolicyEvent['priority'];
  signals: CommentaryPolicyEvent['signals'];
  shouldSpeak: CommentaryPolicyDecision['shouldSpeak'];
  guaranteed: CommentaryPolicyDecision['guaranteed'];
  interrupt: CommentaryPolicyDecision['interrupt'];
  reason: CommentaryPolicyDecision['reason'];
  evaluatedAt: string;
};

export type RealtimeCommentaryCorrectionReason = 'throw_updated' | 'throw_deleted';

export type RealtimeCommentaryCorrectionRequest = RealtimeCommentarySessionControl & {
  correctionId: string;
  reason: RealtimeCommentaryCorrectionReason;
};

export type RealtimeCommentaryCorrectionResponse = {
  epoch: number;
  snapshot: RealtimeCommentarySnapshot;
};

export type RealtimeCommentaryCorrectionEnvelope = {
  schemaVersion: 1;
  kind: 'authoritative_correction';
  correctionId: string;
  reason: RealtimeCommentaryCorrectionReason;
  epoch: number;
  invalidatesEpochsBefore: number;
  snapshot: RealtimeCommentarySnapshot;
};

export function createRealtimeCommentaryCorrectionEnvelope(input: {
  correctionId: string;
  reason: RealtimeCommentaryCorrectionReason;
  epoch: number;
  snapshot: RealtimeCommentarySnapshot;
}): RealtimeCommentaryCorrectionEnvelope {
  return {
    schemaVersion: 1,
    kind: 'authoritative_correction',
    correctionId: input.correctionId,
    reason: input.reason,
    epoch: input.epoch,
    invalidatesEpochsBefore: input.epoch,
    snapshot: input.snapshot,
  };
}

export type ActiveRealtimeCommentarySession = {
  id: string;
  match_id: string;
  openai_call_id: string;
  persona_id: CommentaryPersonaId;
  voice: string;
  epoch: number;
  last_correction_id: string | null;
  last_correction_reason: RealtimeCommentaryCorrectionReason | null;
};

export const REALTIME_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'marin',
  'cedar',
  'sage',
  'shimmer',
  'verse',
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

const REALTIME_VOICE_SET = new Set<string>(REALTIME_VOICES);

/** Keep saved legacy TTS choices working while Realtime uses its voice set. */
export function resolveRealtimeVoice(voice: string): RealtimeVoice {
  if (REALTIME_VOICE_SET.has(voice)) return voice as RealtimeVoice;
  if (voice === 'onyx') return 'cedar';
  if (voice === 'nova') return 'coral';
  if (voice === 'fable') return 'marin';
  return 'marin';
}

/** Old events and tests may omit status; the provider sends `completed` on success. */
export function isSuccessfulRealtimeResponse(status?: string): boolean {
  return status === undefined || status === 'completed';
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
