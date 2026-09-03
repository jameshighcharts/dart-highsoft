import type { DartIQDartEvent, DartIQReplayState } from '@/lib/dartiq/replay';

export type DartIQSwing = {
  sequence: number;
  legId: string;
  legNumber: number;
  playerId: string;
  dartId: string;
  segment: string;
  scored: number;
  beforeMatchProbability: number;
  afterMatchProbability: number;
  matchWpa: number;
  beforeLegProbability: number;
  afterLegProbability: number;
  legWpa: number;
  legConsequence: number;
  matchConsequence: number;
};

export type DartIQLeadChange = {
  sequence: number;
  legId: string;
  legNumber: number;
  dartId: string;
  previousLeaderId: string;
  newLeaderId: string;
};

export type DartIQLegStory = {
  legId: string;
  legNumber: number;
  playerId: string;
  winnerId: string;
  probability: number;
  sequence: number;
};

export type DartIQCommentaryMoment = {
  kind:
    | 'lead_change'
    | 'surge'
    | 'collapse'
    | 'checkout'
    | 'pressure_bust'
    | 'bogey_error';
  importance: number;
  swing: DartIQSwing;
};

export type DartIQInsightSummary = {
  biggestPositiveSwing: DartIQSwing | null;
  biggestNegativeSwing: DartIQSwing | null;
  turningPoint: DartIQSwing | null;
  leadChanges: DartIQLeadChange[];
  stolenLegs: DartIQLegStory[];
  thrownAwayLegs: DartIQLegStory[];
  commentaryMoments: DartIQCommentaryMoment[];
};

export type DartIQInsightOptions = {
  stolenLegThreshold?: number;
  thrownAwayLegThreshold?: number;
  meaningfulSwingThreshold?: number;
};

export type DartIQTurnSummary = {
  playerId: string;
  turnId: string;
  matchProbabilityBefore: number;
  matchProbabilityAfter: number;
  matchWpa: number;
  legProbabilityBefore: number;
  legProbabilityAfter: number;
  legWpa: number;
  biggestDartMatchWpa: number;
  peakLegConsequence: number;
  peakMatchConsequence: number;
  oneDartFinishAvailable: boolean;
  matchWinAvailableThisVisit: boolean;
  unconvertedMatchFinishChancesInVisit: number;
  changedMatchFavorite: boolean;
  checkedOut: boolean;
  busted: boolean;
  leaveProbabilityChange: number;
  nextVisitCheckoutProbability: number;
  createdBogey: boolean;
};

function projectionFor(state: DartIQReplayState, playerId: string) {
  return state.projections.find((projection) => projection.id === playerId);
}

function leaderId(state: DartIQReplayState) {
  let leader: { id: string; probability: number } | null = null;
  for (const projection of state.projections) {
    if (!leader || projection.matchWinProbability > leader.probability) {
      leader = { id: projection.id, probability: projection.matchWinProbability };
    }
  }
  return leader?.id ?? null;
}

function toSwing(event: DartIQDartEvent): DartIQSwing {
  const before = projectionFor(event.before, event.playerId);
  const after = projectionFor(event.after, event.playerId);
  return {
    sequence: event.sequence,
    legId: event.legId,
    legNumber: event.legNumber,
    playerId: event.playerId,
    dartId: event.dartId,
    segment: event.segment,
    scored: event.scored,
    beforeMatchProbability: before?.matchWinProbability ?? 0,
    afterMatchProbability: after?.matchWinProbability ?? 0,
    matchWpa: event.matchWinProbabilityAdded[event.playerId] ?? 0,
    beforeLegProbability: before?.legWinProbability ?? 0,
    afterLegProbability: (before?.legWinProbability ?? 0) + (event.legWinProbabilityAdded[event.playerId] ?? 0),
    legWpa: event.legWinProbabilityAdded[event.playerId] ?? 0,
    legConsequence: event.consequence?.leg ?? Math.abs(event.legWinProbabilityAdded[event.playerId] ?? 0),
    matchConsequence: event.consequence?.match ?? Math.abs(event.matchWinProbabilityAdded[event.playerId] ?? 0),
  };
}

function completedLegWinner(event: DartIQDartEvent) {
  for (const [playerId, winsAfter] of Object.entries(event.after.legsWon)) {
    if (winsAfter > (event.before.legsWon[playerId] ?? 0)) return playerId;
  }
  return null;
}

export function summarizeDartIQForTurn(
  timeline: DartIQDartEvent[],
  turnId: string,
  playerId: string
): DartIQTurnSummary | null {
  let first: DartIQDartEvent | null = null;
  let last: DartIQDartEvent | null = null;
  let biggestDartMatchWpa = 0;
  let peakLegConsequence = 0;
  let peakMatchConsequence = 0;
  let cumulativeLegWpa = 0;
  let changedMatchFavorite = false;
  let checkedOut = false;
  let busted = false;
  let oneDartFinishAvailable = false;
  let matchWinAvailableThisVisit = false;
  let unconvertedMatchFinishChancesInVisit = 0;

  for (const event of timeline) {
    if (event.turnId !== turnId || event.playerId !== playerId) continue;
    first ??= event;
    last = event;
    const dartWpa = event.matchWinProbabilityAdded[playerId] ?? 0;
    cumulativeLegWpa += event.legWinProbabilityAdded[playerId] ?? 0;
    if (Math.abs(dartWpa) > Math.abs(biggestDartMatchWpa)) biggestDartMatchWpa = dartWpa;
    peakLegConsequence = Math.max(peakLegConsequence, event.consequence?.leg ?? 0);
    peakMatchConsequence = Math.max(peakMatchConsequence, event.consequence?.match ?? 0);
    if (leaderId(event.before) !== leaderId(event.after)) changedMatchFavorite = true;
    checkedOut ||= event.checkedOut;
    busted ||= event.busted;
    oneDartFinishAvailable ||= event.semanticStakes.oneDartFinishAvailable;
    matchWinAvailableThisVisit ||= event.semanticStakes.matchWinAvailableThisVisit;
    unconvertedMatchFinishChancesInVisit = Math.max(
      unconvertedMatchFinishChancesInVisit,
      event.semanticStakes.unconvertedMatchFinishChancesInVisit ?? 0
    );
  }

  if (!first || !last) return null;
  const before = projectionFor(first.before, playerId);
  const after = projectionFor(last.after, playerId);
  if (!before || !after) return null;
  const legProbabilityAfter = before.legWinProbability + cumulativeLegWpa;

  return {
    playerId,
    turnId,
    matchProbabilityBefore: before.matchWinProbability,
    matchProbabilityAfter: after.matchWinProbability,
    matchWpa: after.matchWinProbability - before.matchWinProbability,
    legProbabilityBefore: before.legWinProbability,
    legProbabilityAfter,
    legWpa: legProbabilityAfter - before.legWinProbability,
    biggestDartMatchWpa,
    peakLegConsequence,
    peakMatchConsequence,
    oneDartFinishAvailable,
    matchWinAvailableThisVisit,
    unconvertedMatchFinishChancesInVisit,
    changedMatchFavorite,
    checkedOut,
    busted,
    leaveProbabilityChange: last.checkout.leaveProbabilityChange,
    nextVisitCheckoutProbability: last.checkout.nextVisitCheckoutProbability,
    createdBogey: last.checkout.createdBogey,
  };
}

/**
 * Converts the numeric dart timeline into stable, deterministic match facts.
 * It performs one pass and emits no prose, keeping it safe for UI, commentary,
 * notifications, or future persistence without an LLM in the critical path.
 */
export function analyzeDartIQTimeline(
  timeline: DartIQDartEvent[],
  options: DartIQInsightOptions = {}
): DartIQInsightSummary {
  const stolenThreshold = options.stolenLegThreshold ?? 0.2;
  const thrownAwayThreshold = options.thrownAwayLegThreshold ?? 0.8;
  const meaningfulSwingThreshold = options.meaningfulSwingThreshold ?? 0.08;
  let biggestPositiveSwing: DartIQSwing | null = null;
  let biggestNegativeSwing: DartIQSwing | null = null;
  let turningPoint: DartIQSwing | null = null;
  const leadChanges: DartIQLeadChange[] = [];
  const stolenLegs: DartIQLegStory[] = [];
  const thrownAwayLegs: DartIQLegStory[] = [];
  const commentaryMoments: DartIQCommentaryMoment[] = [];
  const legRanges = new Map<string, Map<string, { min: number; max: number }>>();

  for (const event of timeline) {
    const swing = toSwing(event);
    if (swing.matchWpa > 0 && (!biggestPositiveSwing || swing.matchWpa > biggestPositiveSwing.matchWpa)) {
      biggestPositiveSwing = swing;
    }
    if (swing.matchWpa < 0 && (!biggestNegativeSwing || swing.matchWpa < biggestNegativeSwing.matchWpa)) {
      biggestNegativeSwing = swing;
    }
    if (!turningPoint || Math.abs(swing.matchWpa) > Math.abs(turningPoint.matchWpa)) {
      turningPoint = swing;
    }

    let ranges = legRanges.get(event.legId);
    if (!ranges) {
      ranges = new Map();
      legRanges.set(event.legId, ranges);
    }
    for (const projection of event.before.projections) {
      const afterProbability = projection.legWinProbability
        + (event.legWinProbabilityAdded[projection.id] ?? 0);
      const current = ranges.get(projection.id) ?? { min: 1, max: 0 };
      current.min = Math.min(current.min, projection.legWinProbability, afterProbability);
      current.max = Math.max(current.max, projection.legWinProbability, afterProbability);
      ranges.set(projection.id, current);
    }

    const previousLeaderId = leaderId(event.before);
    const newLeaderId = leaderId(event.after);
    if (previousLeaderId && newLeaderId && previousLeaderId !== newLeaderId) {
      leadChanges.push({
        sequence: event.sequence,
        legId: event.legId,
        legNumber: event.legNumber,
        dartId: event.dartId,
        previousLeaderId,
        newLeaderId,
      });
      commentaryMoments.push({ kind: 'lead_change', importance: Math.abs(swing.matchWpa), swing });
    } else if (swing.matchWpa >= meaningfulSwingThreshold) {
      commentaryMoments.push({ kind: 'surge', importance: swing.matchWpa, swing });
    } else if (swing.matchWpa <= -meaningfulSwingThreshold) {
      commentaryMoments.push({ kind: 'collapse', importance: Math.abs(swing.matchWpa), swing });
    }

    if (event.checkedOut) {
      commentaryMoments.push({ kind: 'checkout', importance: Math.max(swing.matchConsequence, 0.1), swing });
    } else if (event.busted && swing.beforeLegProbability >= 0.35) {
      commentaryMoments.push({ kind: 'pressure_bust', importance: Math.max(swing.matchConsequence, 0.08), swing });
    }
    if (event.checkout.createdBogey) {
      commentaryMoments.push({ kind: 'bogey_error', importance: Math.max(swing.matchConsequence, 0.08), swing });
    }

    const winnerId = completedLegWinner(event);
    if (winnerId) {
      const winnerRange = ranges.get(winnerId);
      if (winnerRange && winnerRange.min < stolenThreshold) {
        stolenLegs.push({
          legId: event.legId,
          legNumber: event.legNumber,
          playerId: winnerId,
          winnerId,
          probability: winnerRange.min,
          sequence: event.sequence,
        });
      }
      for (const [playerId, range] of ranges) {
        if (playerId !== winnerId && range.max > thrownAwayThreshold) {
          thrownAwayLegs.push({
            legId: event.legId,
            legNumber: event.legNumber,
            playerId,
            winnerId,
            probability: range.max,
            sequence: event.sequence,
          });
        }
      }
    }
  }

  commentaryMoments.sort((a, b) => b.importance - a.importance || a.swing.sequence - b.swing.sequence);
  return {
    biggestPositiveSwing,
    biggestNegativeSwing,
    turningPoint,
    leadChanges,
    stolenLegs,
    thrownAwayLegs,
    commentaryMoments,
  };
}
