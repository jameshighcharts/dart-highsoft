import type { DartIQHistoricalFact } from '../dartiq/evidence.ts';
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

export type CommentaryRivalry = {
  key: string;
  kind: 'streak' | 'breakthrough' | 'tied_record' | 'revenge';
  subjectId: string;
  counterpartId: string;
  scope: 'direct' | 'shared';
  fieldSize: number;
  meetings: number;
  subjectWins: number;
  counterpartWins: number;
  streak: number;
};

export type RivalryBeat = {
  rivalry: CommentaryRivalry;
  eventId: string;
  sequence: number;
  stage: 'establish' | 'anticipate' | 'threaten' | 'twist' | 'resolve';
  development: 'opening' | 'match_dart' | 'gain' | 'chance_unconverted' | 'bust' | 'rival_response' | 'subject_won' | 'rival_won' | 'other_won';
  winnerId: string | null;
  callbackExcerpt: string | null;
  setupExcerpt?: string | null;
  actorId?: string;
  matchDart?: { score: number; target: string | null };
};

/** Frozen evidence only. Mixed-field aggregates must never become a duel record. */
export function selectCommentaryRivalry(input: {
  playerIds: readonly string[];
  historicalFacts: readonly DartIQHistoricalFact[];
  rematch?: CommentaryRematchContext | null;
}): CommentaryRivalry | null {
  const players = new Set(input.playerIds);
  const candidates: Array<{ rivalry: CommentaryRivalry; weight: number }> = [];
  for (const fact of input.historicalFacts) {
    if (fact.kind !== 'matchup_history' || fact.confidenceTier === 'thin'
      || !fact.counterpartPlayerId || fact.subjectPlayerId === fact.counterpartPlayerId
      || !players.has(fact.subjectPlayerId) || !players.has(fact.counterpartPlayerId)) continue;
    const number = (key: string) => {
      const value = fact.evidence[key];
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : -1;
    };
    const meetings = number('sharedMatches');
    const subjectWins = number('subjectWins');
    const counterpartWins = number('counterpartWins');
    const others = number('otherWinnerMatches');
    const direct = number('twoPlayerMatches');
    if (meetings < 3 || fact.support < meetings || subjectWins < 0 || counterpartWins < 0
      || others < 0 || direct < 0 || direct > meetings
      || subjectWins + counterpartWins + others !== meetings) continue;
    const scope = direct === meetings && others === 0 ? 'direct' : 'shared';
    const latest = fact.evidence.latestWinnerPlayerId;
    const streak = number('currentWinnerStreak');
    let subjectId = fact.subjectPlayerId;
    let counterpartId = fact.counterpartPlayerId;
    let kind: CommentaryRivalry['kind'];
    if (scope === 'direct' && (subjectWins === 0 || counterpartWins === 0)) {
      kind = 'breakthrough';
      if (counterpartWins === 0) [subjectId, counterpartId] = [counterpartId, subjectId];
    } else if (streak >= 2 && streak <= meetings
      && (latest === subjectId || latest === counterpartId)
      && streak <= (latest === subjectId ? subjectWins : counterpartWins)) {
      kind = 'streak';
      if (latest === subjectId) [subjectId, counterpartId] = [counterpartId, subjectId];
    } else if (scope === 'direct' && players.size === 2 && subjectWins === counterpartWins) {
      kind = 'tied_record';
      [subjectId, counterpartId] = [subjectId, counterpartId].sort();
    } else continue;
    const rivalry: CommentaryRivalry = {
      key: `${kind}:${[subjectId, counterpartId].sort().join(':')}`,
      kind, subjectId, counterpartId, scope, fieldSize: players.size, meetings,
      subjectWins: subjectId === fact.subjectPlayerId ? subjectWins : counterpartWins,
      counterpartWins: subjectId === fact.subjectPlayerId ? counterpartWins : subjectWins,
      streak: Math.max(0, streak),
    };
    candidates.push({ rivalry, weight: (kind === 'breakthrough' ? 30 : kind === 'streak' ? 20 : 10)
      + Math.min(9, Math.max(0, streak)) + Math.min(9, meetings) / 10 });
  }
  const previousWinner = input.rematch?.previousWinnerId;
  if (previousWinner && players.has(previousWinner)) {
    for (const subjectId of input.rematch?.revengePlayerIds ?? []) {
      if (!players.has(subjectId) || subjectId === previousWinner) continue;
      candidates.push({ weight: 15, rivalry: {
        key: `revenge:${subjectId}:${previousWinner}`, kind: 'revenge', subjectId,
        counterpartId: previousWinner, scope: players.size === 2 ? 'direct' : 'shared',
        fieldSize: players.size, meetings: 1, subjectWins: 0, counterpartWins: 1, streak: 1,
      } });
    }
  }
  return candidates.sort((a, b) => b.weight - a.weight || a.rivalry.key.localeCompare(b.rivalry.key))[0]?.rivalry ?? null;
}
