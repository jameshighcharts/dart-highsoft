import type { DartIQDartEvent } from '@/lib/dartiq/replay';
import { hasCheckoutRoute } from '@/lib/dartiq/checkout';
import { isMaterialDartIQConsequence } from '@/lib/dartiq/events';
import type { FinishRule } from '@/utils/x01';
import {
  rankCommentaryStoryArcs,
  type CommentaryStoryArc,
} from './storyArcDirector.ts';
import type { BroadcastDirection } from './broadcastDirector.ts';

export type CommentaryRematchContext = {
  previousMatchId: string;
  previousWinnerId: string | null;
  revengePlayerIds: string[];
};

export type CommentaryPlayerNarrative = {
  playerId: string;
  completedVisits: number;
  currentThreeDartAverage: number;
  baselineThreeDartAverage: number;
  baselineDelta: number;
  baselinePerformance: 'outperforming' | 'near_baseline' | 'underperforming';
  tendencies: string[];
  checkoutPressure: {
    opportunities: number;
    conversions: number;
    highPressureOpportunities: number;
    highPressureConversions: number;
    recentUnconvertedOneDartFinishes: Array<{
      sequence: number;
      legNumber: number;
      scoreBefore: number;
      hitSegment: string;
    }>;
  };
};

export type CommentaryNarrativeMemory = {
  schemaVersion: 1;
  sequence: number;
  biggestSwing: null | {
    sequence: number;
    playerId: string;
    matchWpa: number;
    legNumber: number;
    segment: string;
  };
  rematch: CommentaryRematchContext | null;
  activeStoryArc: CommentaryStoryArc | null;
  storyArcCandidates: CommentaryStoryArc[];
  broadcastDirection?: BroadcastDirection;
  players: CommentaryPlayerNarrative[];
};

type MutablePlayerMemory = {
  completedTurnIds: Set<string>;
  highVisits: number;
  lowVisits: number;
  busts: number;
  bogeys: number;
  positiveImpactDarts: number;
  negativeImpactDarts: number;
  opportunityTurnIds: Set<string>;
  conversionTurnIds: Set<string>;
  highPressureOpportunityTurnIds: Set<string>;
  highPressureConversionTurnIds: Set<string>;
  unconvertedOneDartFinishes: CommentaryPlayerNarrative['checkoutPressure']['recentUnconvertedOneDartFinishes'];
  currentAverage: number;
  baselineAverage: number;
  currentDartsThrown: number;
};

function emptyPlayer(): MutablePlayerMemory {
  return {
    completedTurnIds: new Set(),
    highVisits: 0,
    lowVisits: 0,
    busts: 0,
    bogeys: 0,
    positiveImpactDarts: 0,
    negativeImpactDarts: 0,
    opportunityTurnIds: new Set(),
    conversionTurnIds: new Set(),
    highPressureOpportunityTurnIds: new Set(),
    highPressureConversionTurnIds: new Set(),
    unconvertedOneDartFinishes: [],
    currentAverage: 0,
    baselineAverage: 0,
    currentDartsThrown: 0,
  };
}

function isOneDartDoubleLeave(score: number, finishRule: FinishRule) {
  return finishRule === 'double_out'
    && (score === 50 || (score >= 2 && score <= 40 && score % 2 === 0));
}

/** Builds bounded, factual story state from the deterministic DartIQ timeline. */
export function buildCommentaryNarrativeMemory(input: {
  events: readonly DartIQDartEvent[];
  finishRule: FinishRule;
  rematch?: CommentaryRematchContext | null;
}): CommentaryNarrativeMemory {
  const players = new Map<string, MutablePlayerMemory>();
  let biggestSwing: CommentaryNarrativeMemory['biggestSwing'] = null;

  for (const event of input.events) {
    const memory = players.get(event.playerId) ?? emptyPlayer();
    players.set(event.playerId, memory);
    const scoreBefore = event.before.scores[event.playerId] ?? 0;
    const matchWpa = event.matchWinProbabilityAdded[event.playerId] ?? 0;

    if (!biggestSwing || Math.abs(matchWpa) > Math.abs(biggestSwing.matchWpa)) {
      biggestSwing = {
        sequence: event.sequence,
        playerId: event.playerId,
        matchWpa,
        legNumber: event.legNumber,
        segment: event.segment,
      };
    }

    const checkoutOpportunity = event.checkout.checkoutProbabilityBefore > 0;
    const opponentThreat = Object.entries(event.before.scores).some(
      ([playerId, score]) => playerId !== event.playerId
        && hasCheckoutRoute(score, 3, input.finishRule)
    );
    const highOpportunity = checkoutOpportunity
      && (event.semanticStakes?.matchWinAvailableThisVisit || opponentThreat);
    if (checkoutOpportunity) {
      memory.opportunityTurnIds.add(event.turnId);
      if (highOpportunity) {
        memory.highPressureOpportunityTurnIds.add(event.turnId);
      }
    }
    if (event.checkedOut) {
      memory.conversionTurnIds.add(event.turnId);
      if (memory.highPressureOpportunityTurnIds.has(event.turnId)) {
        memory.highPressureConversionTurnIds.add(event.turnId);
      }
    }
    if (isOneDartDoubleLeave(scoreBefore, input.finishRule) && !event.checkedOut) {
      memory.unconvertedOneDartFinishes.push({
        sequence: event.sequence,
        legNumber: event.legNumber,
        scoreBefore,
        hitSegment: event.segment,
      });
      memory.unconvertedOneDartFinishes = memory.unconvertedOneDartFinishes.slice(-3);
    }

    if (isMaterialDartIQConsequence(event.consequence, event.before.projections.length)) {
      if (matchWpa >= 0.02) memory.positiveImpactDarts += 1;
      if (matchWpa <= -0.02) memory.negativeImpactDarts += 1;
    }
    if (event.checkout.createdBogey) memory.bogeys += 1;

    const visitCompleted = event.dartIndex >= 3 || event.busted || event.checkedOut;
    if (visitCompleted && !memory.completedTurnIds.has(event.turnId)) {
      memory.completedTurnIds.add(event.turnId);
      if (event.turnScoreAfter >= 100) memory.highVisits += 1;
      if (event.turnScoreAfter <= 30) memory.lowVisits += 1;
      if (event.busted) memory.busts += 1;
    }

    for (const projection of event.after.projections) {
      const projected = players.get(projection.id) ?? emptyPlayer();
      players.set(projection.id, projected);
      projected.currentAverage = projection.threeDartAverage;
      projected.baselineAverage = projection.baselineThreeDartAverage;
      projected.currentDartsThrown = projection.dartsThrown;
    }
  }

  const storyArcCandidates = rankCommentaryStoryArcs({
    events: input.events,
    finishRule: input.finishRule,
    rematch: input.rematch,
  }).slice(0, 3);

  return {
    schemaVersion: 1,
    sequence: input.events.at(-1)?.sequence ?? 0,
    biggestSwing,
    rematch: input.rematch ?? null,
    activeStoryArc: storyArcCandidates[0] ?? null,
    storyArcCandidates,
    players: [...players.entries()].map(([playerId, memory]) => {
      const baselineDelta = memory.currentAverage - memory.baselineAverage;
      const tendencies: string[] = [];
      if (memory.highVisits >= 2) tendencies.push('repeated 100-plus scoring');
      if (memory.lowVisits >= 3) tendencies.push('recurring low-scoring visits');
      if (memory.busts >= 2) tendencies.push('repeat bust trouble');
      if (memory.bogeys >= 2) tendencies.push('repeated bogey creation');
      if (memory.positiveImpactDarts >= 2) tendencies.push('repeated gains in win probability');
      if (memory.negativeImpactDarts >= 2) tendencies.push('repeated losses in win probability');
      return {
        playerId,
        completedVisits: memory.completedTurnIds.size,
        currentThreeDartAverage: memory.currentAverage,
        baselineThreeDartAverage: memory.baselineAverage,
        baselineDelta,
        baselinePerformance: memory.currentDartsThrown < 6
          ? 'near_baseline' as const
          : baselineDelta >= 7
            ? 'outperforming' as const
            : baselineDelta <= -7
              ? 'underperforming' as const
              : 'near_baseline' as const,
        tendencies: tendencies.slice(0, 3),
        checkoutPressure: {
          opportunities: memory.opportunityTurnIds.size,
          conversions: memory.conversionTurnIds.size,
          highPressureOpportunities: memory.highPressureOpportunityTurnIds.size,
          highPressureConversions: memory.highPressureConversionTurnIds.size,
          recentUnconvertedOneDartFinishes: memory.unconvertedOneDartFinishes,
        },
      };
    }),
  };
}
