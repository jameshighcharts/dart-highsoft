import type { PressureDartLeverage } from '@/utils/pressureEngine';
import type { PressureCheckoutAssessment } from '@/utils/pressureCheckout';
import type { PressureDartEvent, PressureReplayState } from '@/utils/pressureReplay';

export type PressureEventPriority = 'silent' | 'ordinary' | 'notable' | 'marquee' | 'terminal';

export type PressureEventSignal =
  | 'match_win'
  | 'checkout'
  | 'one_eighty'
  | 'bust'
  | 'favorite_change'
  | 'large_swing'
  | 'high_pressure'
  | 'great_setup'
  | 'bogey_created';

export type PressureDartPacket = {
  schemaVersion: 1;
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

function isLockedMatchWinner(event: PressureDartEvent) {
  if (!event.checkedOut) return false;
  return event.after.projections.every((projection) =>
    projection.matchWinProbability === (projection.id === event.playerId ? 1 : 0)
  );
}

/**
 * Converts the rich replay event into a compact, provider-neutral packet for
 * live UI, telemetry, highlights, and future Realtime commentary transport.
 */
export function createPressureDartPacket(event: PressureDartEvent): PressureDartPacket {
  const legProbabilityBefore = probability(event.before, event.playerId, 'leg');
  const matchProbabilityBefore = probability(event.before, event.playerId, 'match');
  const legWpa = event.legWinProbabilityAdded[event.playerId] ?? 0;
  const matchWpa = event.matchWinProbabilityAdded[event.playerId] ?? 0;
  const matchWin = isLockedMatchWinner(event);
  const favoriteChanged = favoriteId(event.before) !== favoriteId(event.after);
  const signals: PressureEventSignal[] = [];

  if (matchWin) signals.push('match_win');
  if (event.checkedOut) signals.push('checkout');
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
  else if (event.checkedOut || event.busted || signals.includes('one_eighty')) priority = 'marquee';
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
    schemaVersion: 1,
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
    scoreBefore: event.before.scores[event.playerId] ?? 0,
    scoreAfter: event.after.scores[event.playerId] ?? 0,
    busted: event.busted,
    checkedOut: event.checkedOut,
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
