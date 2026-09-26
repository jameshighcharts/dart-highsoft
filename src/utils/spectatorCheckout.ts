import type { TurnRecord } from '@/lib/match/types';
import { computeCheckoutSuggestions } from '@/utils/checkoutSuggestions';
import { getSpectatorScore } from '@/utils/matchStats';
import { computeSetupSuggestions } from '@/utils/setupSuggestions';
import type { FinishRule } from '@/utils/x01';

export type SpectatorCheckout =
  | { kind: 'checkout'; playerId: string; score: number; dartsLeft: number; routes: string[][] }
  | { kind: 'setup'; playerId: string; score: number; dartsLeft: number; path: string[]; target: number }
  | { kind: 'none'; playerId: string; score: number; dartsLeft: number };

/** The finish (or setup) the player on throw should aim for with the darts left in this visit. */
export function getSpectatorCheckout({
  turns,
  currentLegId,
  startScore,
  turnThrowCounts,
  finishRule,
  playerId,
}: {
  turns: TurnRecord[];
  currentLegId?: string;
  startScore: number;
  turnThrowCounts: Record<string, number>;
  finishRule: FinishRule;
  playerId: string;
}): SpectatorCheckout | null {
  const score = getSpectatorScore(turns, currentLegId, startScore, turnThrowCounts, playerId);
  const playerTurns = turns.filter(
    (turn) => turn.player_id === playerId && turn.leg_id === currentLegId && turn.tiebreak_round == null
  );
  const lastTurn = playerTurns.at(-1);
  const throwCount = lastTurn ? turnThrowCounts[lastTurn.id] || 0 : 0;
  // A new visit starts after a bust or a full three-dart visit.
  const isNewTurnStarting = !lastTurn || lastTurn.busted || throwCount === 3;
  const dartsLeft = isNewTurnStarting ? 3 : Math.max(0, 3 - throwCount);
  if (score <= 0 || dartsLeft <= 0) return null;

  const routes = score <= 170 ? computeCheckoutSuggestions(score, dartsLeft, finishRule) : [];
  if (routes.length > 0) return { kind: 'checkout', playerId, score, dartsLeft, routes };

  const setup = computeSetupSuggestions(score, dartsLeft, finishRule);
  if (setup) return { kind: 'setup', playerId, score, dartsLeft, ...setup };

  return score <= 170 ? { kind: 'none', playerId, score, dartsLeft } : null;
}

export type SegmentKind = 'single' | 'double' | 'triple' | 'bull' | 'outer-bull';

/** Splits a route label like `T20`, `D16`, `S5`, `DB` into display parts. */
export function describeSegment(label: string): { kind: SegmentKind; prefix: string; value: string } {
  if (label === 'DB') return { kind: 'bull', prefix: '', value: 'BULL' };
  if (label === 'SB') return { kind: 'outer-bull', prefix: '', value: '25' };
  const match = label.match(/^([SDT])(\d+)$/);
  if (!match) return { kind: 'single', prefix: '', value: label };
  const kind = match[1] === 'T' ? 'triple' : match[1] === 'D' ? 'double' : 'single';
  return { kind, prefix: kind === 'single' ? '' : match[1], value: match[2] };
}
