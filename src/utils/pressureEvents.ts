import type { PressureDartLeverage } from '@/utils/pressureEngine';
import type { PressureCheckoutAssessment } from '@/utils/pressureCheckout';
import type { PressureDartEvent, PressureReplayState } from '@/utils/pressureReplay';

export type PressureEventPriority = 'silent' | 'ordinary' | 'notable' | 'marquee' | 'terminal';

export type PressureEventSignal =
  | 'match_win'
  | 'leg_win'
  | 'checkout'
  | 'fair_ending_checkout'
  | 'fair_ending_round_complete'
  | 'tiebreak_started'
  | 'tiebreak_lead_change'
  | 'tiebreak_tied'
  | 'one_eighty'
  | 'nikita_special'
  | 'story_arc'
  | 'bust'
  | 'favorite_change'
  | 'large_swing'
  | 'high_pressure'
  | 'great_setup'
  | 'bogey_created';

export type PressureDartPacket = {
  schemaVersion: 2;
  engineVersion: PressureDartEvent['engineVersion'];
  type: 'dart';
  eventId: string;
  matchId: string;
  legId: string;
  legNumber: number;
  turnId: string;
  dartId: string;
  sequence: number;
  playerId: string;
  dartIndex: number;
  segment: string;
  scored: number;
  turnScoreAfter: number;
  scoreBefore: number;
  scoreAfter: number;
  busted: boolean;
  checkedOut: boolean;
  fairEnding?: {
    enabled: true;
    phase: 'normal' | 'completing_round' | 'tiebreak' | 'resolved';
    checkedOutPlayerIds: string[];
    tiebreakRound: number;
    tiebreakPlayerIds: string[];
    tiebreakScores: Record<string, number>;
    winnerId: string | null;
    approximationMode: 'standard' | 'fair-ending-weighted';
  };
  legProbabilityBefore: number;
  legProbabilityAfter: number;
  matchProbabilityBefore: number;
  matchProbabilityAfter: number;
  legWpa: number;
  matchWpa: number;
  leverage: PressureDartLeverage;
  checkout: PressureCheckoutAssessment;
  signals: PressureEventSignal[];
  priority: PressureEventPriority;
  shouldSpeak: boolean;
};

function probability(state: PressureReplayState, playerId: string, kind: 'leg' | 'match') {
  const projection = state.projections.find((entry) => entry.id === playerId);
  return kind === 'leg'
    ? projection?.legWinProbability ?? 0
    : projection?.matchWinProbability ?? 0;
}

function favoriteId(state: PressureReplayState) {
  let favorite: { id: string; probability: number } | null = null;
  for (const projection of state.projections) {
    if (!favorite || projection.matchWinProbability > favorite.probability) {
      favorite = { id: projection.id, probability: projection.matchWinProbability };
    }
  }
  return favorite?.id ?? null;
}

function lockedMatchWinnerId(event: PressureDartEvent) {
  const winner = event.after.projections.find((projection) => projection.matchWinProbability === 1);
  if (!winner) return null;
  return event.after.projections.every((projection) =>
    projection.matchWinProbability === (projection.id === winner.id ? 1 : 0)
  ) ? winner.id : null;
}

function tiebreakLeaderId(event: PressureDartEvent, kind: 'before' | 'after') {
  const state = kind === 'before' ? event.fairEndingBefore : event.fairEndingAfter;
  if (!state || state.phase !== 'tiebreak' || state.tiebreakPlayerIds.length === 0) return null;
  let leaderId: string | null = null;
  let leaderScore = Number.NEGATIVE_INFINITY;
  let tied = false;
  for (const playerId of state.tiebreakPlayerIds) {
    const score = state.tiebreakScores[playerId] ?? 0;
    if (score > leaderScore) {
      leaderId = playerId;
      leaderScore = score;
      tied = false;
    } else if (score === leaderScore) {
      tied = true;
    }
  }
  return tied ? null : leaderId;
}

/**
 * Converts the rich replay event into a compact, provider-neutral packet for
 * live UI, telemetry, highlights, and future Realtime commentary transport.
 */
export function createPressureDartPacket(event: PressureDartEvent): PressureDartPacket {
  const scoreBefore = event.before.scores[event.playerId] ?? 0;
  const crossedLegBoundary = event.after.legId !== event.before.legId;
  const scoreAfter = crossedLegBoundary
    ? event.busted
      ? scoreBefore
      : Math.max(0, scoreBefore - event.scored)
    : event.after.scores[event.playerId] ?? 0;
  const legProbabilityBefore = probability(event.before, event.playerId, 'leg');
  const matchProbabilityBefore = probability(event.before, event.playerId, 'match');
  const legWpa = event.legWinProbabilityAdded[event.playerId] ?? 0;
  const matchWpa = event.matchWinProbabilityAdded[event.playerId] ?? 0;
  const matchWinnerId = lockedMatchWinnerId(event);
  const matchWin = matchWinnerId !== null;
  const fairBefore = event.fairEndingBefore;
  const fairAfter = event.fairEndingAfter;
  const fairLegResolved = fairAfter?.phase === 'resolved' && fairBefore?.phase !== 'resolved';
  const favoriteChanged = favoriteId(event.before) !== favoriteId(event.after);
  const signals: PressureEventSignal[] = [];

  if (matchWin) signals.push('match_win');
  if (fairLegResolved || (!fairAfter && event.checkedOut)) signals.push('leg_win');
  if (event.checkedOut) signals.push('checkout');
  if (event.checkedOut && fairAfter && fairAfter.phase !== 'resolved') {
    signals.push('fair_ending_checkout');
  }
  if (fairBefore?.phase === 'completing_round' && fairAfter?.phase !== 'completing_round') {
    signals.push('fair_ending_round_complete');
  }
  if (fairAfter?.phase === 'tiebreak' && fairBefore?.phase !== 'tiebreak') {
    signals.push('tiebreak_started');
  }
  if (
    fairBefore?.phase === 'tiebreak'
    && fairAfter?.phase === 'tiebreak'
    && fairAfter.tiebreakRound > fairBefore.tiebreakRound
  ) {
    signals.push('tiebreak_tied');
  }
  const leaderBefore = tiebreakLeaderId(event, 'before');
  const leaderAfter = tiebreakLeaderId(event, 'after');
  if (fairAfter?.phase === 'tiebreak' && leaderAfter && leaderAfter !== leaderBefore) {
    signals.push('tiebreak_lead_change');
  }
  if (event.dartIndex === 3 && event.turnScoreAfter === 180) signals.push('one_eighty');
  if (event.busted) signals.push('bust');
  if (favoriteChanged) signals.push('favorite_change');
  if (Math.abs(matchWpa) >= 0.08) signals.push('large_swing');
  if (event.leverage.pressureIndex >= 0.65) signals.push('high_pressure');
  if (event.checkout.createdBogey) signals.push('bogey_created');
  if (
    event.dartIndex === 3
    && !event.checkedOut
    && (event.checkout.setupGrade === 'optimal' || event.checkout.setupGrade === 'good')
    && event.checkout.nextVisitCheckoutProbability > 0
  ) {
    signals.push('great_setup');
  }

  let priority: PressureEventPriority = 'silent';
  if (matchWin) priority = 'terminal';
  else if (
    event.checkedOut
    || event.busted
    || fairLegResolved
    || signals.includes('one_eighty')
    || signals.includes('tiebreak_tied')
  ) priority = 'marquee';
  else if (
    favoriteChanged
    || signals.includes('large_swing')
    || signals.includes('high_pressure')
    || signals.includes('great_setup')
    || signals.includes('bogey_created')
  ) {
    priority = 'notable';
  } else if (event.dartIndex >= 3) priority = 'ordinary';

  return {
    schemaVersion: 2,
    engineVersion: event.engineVersion,
    type: 'dart',
    eventId: event.eventId,
    matchId: event.matchId,
    legId: event.legId,
    legNumber: event.legNumber,
    turnId: event.turnId,
    dartId: event.dartId,
    sequence: event.sequence,
    playerId: event.playerId,
    dartIndex: event.dartIndex,
    segment: event.segment,
    scored: event.scored,
    turnScoreAfter: event.turnScoreAfter,
    scoreBefore,
    scoreAfter,
    busted: event.busted,
    checkedOut: event.checkedOut,
    ...(fairAfter ? {
      fairEnding: {
        enabled: true as const,
        phase: fairAfter.phase,
        checkedOutPlayerIds: fairAfter.checkedOutPlayerIds,
        tiebreakRound: fairAfter.tiebreakRound,
        tiebreakPlayerIds: fairAfter.tiebreakPlayerIds,
        tiebreakScores: fairAfter.tiebreakScores,
        winnerId: fairAfter.winnerId,
        approximationMode: fairAfter.approximationMode,
      },
    } : {}),
    legProbabilityBefore,
    legProbabilityAfter: legProbabilityBefore + legWpa,
    matchProbabilityBefore,
    matchProbabilityAfter: matchProbabilityBefore + matchWpa,
    legWpa,
    matchWpa,
    leverage: event.leverage,
    checkout: event.checkout,
    signals,
    priority,
    shouldSpeak: priority !== 'silent',
  };
}
