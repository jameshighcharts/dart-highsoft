import type { PressureDartEvent, PressureReplayState } from '@/utils/pressureReplay';
import type { FinishRule } from '@/utils/x01';

export type CommentaryStoryArcKind =
  | 'comeback'
  | 'collapse'
  | 'underdog_rising'
  | 'seesaw_match'
  | 'miss_punished'
  | 'checkout_duel'
  | 'pressure_resilience'
  | 'rematch_revenge'
  | 'dominance';

export type CommentaryStoryArc = {
  kind: CommentaryStoryArcKind;
  phase: 'developing' | 'established' | 'payoff';
  treatment: 'analysis' | 'light_sass' | 'narrative_callback' | 'match_closing';
  strength: number;
  subjectPlayerId: string | null;
  counterpartPlayerId: string | null;
  evidence: Record<string, string | number | boolean>;
};

type ArcCandidate = CommentaryStoryArc & { score: number; order: number };

const KIND_ORDER: CommentaryStoryArcKind[] = [
  'miss_punished',
  'rematch_revenge',
  'underdog_rising',
  'comeback',
  'collapse',
  'seesaw_match',
  'checkout_duel',
  'pressure_resilience',
  'dominance',
];

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function probability(state: PressureReplayState, playerId: string) {
  return state.projections.find((projection) => projection.id === playerId)?.matchWinProbability ?? 0;
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

function isOneDartDoubleLeave(score: number, finishRule: FinishRule) {
  return finishRule === 'double_out'
    && (score === 50 || (score >= 2 && score <= 40 && score % 2 === 0));
}

function candidate(input: Omit<ArcCandidate, 'order'>): ArcCandidate {
  return { ...input, order: KIND_ORDER.indexOf(input.kind) };
}

/** Ranks the strongest factual broadcast stories from competing Pressure arcs. */
export function rankCommentaryStoryArcs(input: {
  events: readonly PressureDartEvent[];
  finishRule: FinishRule;
  rematch?: {
    previousWinnerId: string | null;
    revengePlayerIds: string[];
  } | null;
}): CommentaryStoryArc[] {
  if (input.events.length === 0) return [];
  const first = input.events[0];
  const latest = input.events.at(-1)!;
  const playerIds = first.before.projections.map((projection) => projection.id);
  const candidates: ArcCandidate[] = [];
  const initial = new Map(playerIds.map((id) => [id, probability(first.before, id)]));
  const minima = new Map(initial);
  const maxima = new Map(initial);
  const checkoutConversions = new Map<string, number>();
  const highPressure = new Map<string, { chances: number; conversions: number }>();
  const lastDoubleMiss = new Map<string, { sequence: number; score: number }>();
  let favoriteChanges = 0;
  let previousFavorite = favoriteId(first.before);
  let punishment: { winner: string; missedBy: string; gap: number; score: number } | null = null;

  for (const event of input.events) {
    for (const playerId of playerIds) {
      const after = probability(event.after, playerId);
      minima.set(playerId, Math.min(minima.get(playerId) ?? after, after));
      maxima.set(playerId, Math.max(maxima.get(playerId) ?? after, after));
    }
    const nextFavorite = favoriteId(event.after);
    if (previousFavorite && nextFavorite && previousFavorite !== nextFavorite) favoriteChanges += 1;
    previousFavorite = nextFavorite;

    const scoreBefore = event.before.scores[event.playerId] ?? 0;
    if (isOneDartDoubleLeave(scoreBefore, input.finishRule) && !event.checkedOut) {
      lastDoubleMiss.set(event.playerId, { sequence: event.sequence, score: scoreBefore });
    }
    if (event.checkout.checkoutProbabilityBefore > 0 && event.leverage.pressureIndex >= 0.65) {
      const history = highPressure.get(event.playerId) ?? { chances: 0, conversions: 0 };
      history.chances += 1;
      if (event.checkedOut) history.conversions += 1;
      highPressure.set(event.playerId, history);
    }
    if (event.checkedOut) {
      checkoutConversions.set(event.playerId, (checkoutConversions.get(event.playerId) ?? 0) + 1);
      for (const [missedBy, miss] of lastDoubleMiss) {
        const gap = event.sequence - miss.sequence;
        if (missedBy !== event.playerId && gap > 0 && gap <= 6) {
          punishment = { winner: event.playerId, missedBy, gap, score: miss.score };
        }
      }
    }
  }

  const current = new Map(playerIds.map((id) => [id, probability(latest.after, id)]));
  const lockedWinner = playerIds.find((id) => current.get(id) === 1) ?? null;
  for (const playerId of playerIds) {
    const currentProbability = current.get(playerId) ?? 0;
    const initialProbability = initial.get(playerId) ?? 0;
    const rise = currentProbability - (minima.get(playerId) ?? currentProbability);
    const fall = (maxima.get(playerId) ?? currentProbability) - currentProbability;
    if (initialProbability <= 0.3 && currentProbability >= 0.4 && currentProbability - initialProbability >= 0.15) {
      candidates.push(candidate({
        kind: 'underdog_rising', score: 0.76 + clamp(currentProbability - initialProbability) * 0.12,
        phase: lockedWinner === playerId ? 'payoff' : currentProbability >= 0.6 ? 'established' : 'developing',
        treatment: lockedWinner === playerId ? 'match_closing' : 'narrative_callback',
        strength: clamp((currentProbability - initialProbability) / 0.5),
        subjectPlayerId: playerId, counterpartPlayerId: previousFavorite === playerId ? null : previousFavorite,
        evidence: { initialProbability, currentProbability },
      }));
    } else if (rise >= 0.18 && currentProbability >= 0.3) {
      candidates.push(candidate({
        kind: 'comeback', score: 0.72 + clamp(rise) * 0.15,
        phase: lockedWinner === playerId ? 'payoff' : rise >= 0.3 ? 'established' : 'developing',
        treatment: lockedWinner === playerId ? 'match_closing' : 'narrative_callback',
        strength: clamp(rise / 0.4), subjectPlayerId: playerId,
        counterpartPlayerId: previousFavorite === playerId ? null : previousFavorite,
        evidence: { lowProbability: minima.get(playerId) ?? 0, currentProbability, recovered: rise },
      }));
    }
    if (fall >= 0.2 && (maxima.get(playerId) ?? 0) >= 0.55) {
      candidates.push(candidate({
        kind: 'collapse', score: 0.7 + clamp(fall) * 0.14,
        phase: currentProbability <= 0.2 ? 'established' : 'developing', treatment: 'light_sass',
        strength: clamp(fall / 0.45), subjectPlayerId: playerId,
        counterpartPlayerId: previousFavorite === playerId ? null : previousFavorite,
        evidence: { peakProbability: maxima.get(playerId) ?? 0, currentProbability, surrendered: fall },
      }));
    }
    const pressure = highPressure.get(playerId);
    if (pressure && pressure.chances >= 2 && pressure.conversions >= 1) {
      candidates.push(candidate({
        kind: 'pressure_resilience', score: 0.62 + Math.min(0.1, pressure.conversions * 0.04),
        phase: pressure.conversions >= 2 ? 'established' : 'developing', treatment: 'analysis',
        strength: clamp(pressure.conversions / pressure.chances), subjectPlayerId: playerId,
        counterpartPlayerId: null,
        evidence: { pressureCheckoutChances: pressure.chances, pressureCheckouts: pressure.conversions },
      }));
    }
  }

  if (punishment) {
    candidates.push(candidate({
      kind: 'miss_punished', score: 0.92, phase: 'payoff', treatment: 'light_sass', strength: 0.9,
      subjectPlayerId: punishment.winner, counterpartPlayerId: punishment.missedBy,
      evidence: { dartsLater: punishment.gap, missedDoubleScore: punishment.score },
    }));
  }
  if (favoriteChanges >= 3) {
    candidates.push(candidate({
      kind: 'seesaw_match', score: 0.7 + Math.min(0.12, favoriteChanges * 0.02),
      phase: favoriteChanges >= 5 ? 'established' : 'developing', treatment: 'narrative_callback',
      strength: clamp(favoriteChanges / 6), subjectPlayerId: previousFavorite,
      counterpartPlayerId: null, evidence: { favoriteChanges },
    }));
  }
  const checkoutPlayers = [...checkoutConversions.entries()].filter(([, count]) => count > 0);
  const totalCheckouts = checkoutPlayers.reduce((sum, [, count]) => sum + count, 0);
  if (checkoutPlayers.length >= 2 && totalCheckouts >= 3) {
    candidates.push(candidate({
      kind: 'checkout_duel', score: 0.67 + Math.min(0.1, totalCheckouts * 0.02),
      phase: totalCheckouts >= 5 ? 'established' : 'developing', treatment: 'analysis',
      strength: clamp(totalCheckouts / 6), subjectPlayerId: checkoutPlayers[0][0],
      counterpartPlayerId: checkoutPlayers[1][0], evidence: { totalCheckouts },
    }));
  }
  if (input.rematch?.previousWinnerId) {
    for (const revengePlayerId of input.rematch.revengePlayerIds) {
      const currentProbability = current.get(revengePlayerId) ?? 0;
      if (currentProbability >= 0.55 || lockedWinner === revengePlayerId) {
        candidates.push(candidate({
          kind: 'rematch_revenge', score: lockedWinner === revengePlayerId ? 0.96 : 0.8,
          phase: lockedWinner === revengePlayerId ? 'payoff' : currentProbability >= 0.7 ? 'established' : 'developing',
          treatment: lockedWinner === revengePlayerId ? 'match_closing' : 'narrative_callback',
          strength: clamp(currentProbability), subjectPlayerId: revengePlayerId,
          counterpartPlayerId: input.rematch.previousWinnerId,
          evidence: { currentProbability, previousWinnerId: input.rematch.previousWinnerId },
        }));
      }
    }
  }
  const dominant = [...current.entries()].find(([, value]) => value >= 0.82);
  if (dominant && input.events.length >= 9) {
    candidates.push(candidate({
      kind: 'dominance', score: 0.58 + dominant[1] * 0.12,
      phase: lockedWinner === dominant[0] ? 'payoff' : 'established',
      treatment: lockedWinner === dominant[0] ? 'match_closing' : 'analysis',
      strength: dominant[1], subjectPlayerId: dominant[0], counterpartPlayerId: null,
      evidence: { currentProbability: dominant[1] },
    }));
  }

  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  return candidates.map((entry) => ({
    kind: entry.kind,
    phase: entry.phase,
    treatment: entry.treatment,
    strength: entry.strength,
    subjectPlayerId: entry.subjectPlayerId,
    counterpartPlayerId: entry.counterpartPlayerId,
    evidence: entry.evidence,
  }));
}

/** Selects one strongest factual story without listener-local continuity state. */
export function directCommentaryStoryArc(
  input: Parameters<typeof rankCommentaryStoryArcs>[0]
): CommentaryStoryArc | null {
  return rankCommentaryStoryArcs(input)[0] ?? null;
}

export function storyArcInstruction(story: CommentaryStoryArc | null | undefined) {
  if (!story) return '';
  if (story.treatment === 'match_closing') {
    return 'Pay off the selected story after stating the result. Make it feel earned, not melodramatic.';
  }
  if (story.treatment === 'light_sass') {
    return 'Use the selected story for one playful, lightly sassy consequence. Keep the factual target on the darts.';
  }
  if (story.treatment === 'narrative_callback') {
    return 'Connect this moment to the selected evolving story in one crisp callback.';
  }
  return 'Use the selected story as concise analysis; do not force a joke.';
}
