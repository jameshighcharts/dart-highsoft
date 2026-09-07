"use client";

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { ThrowSegmentBadges } from '@/components/ThrowSegmentBadges';
import { computeCheckoutSuggestions } from '@/utils/checkoutSuggestions';
import { computeSetupSuggestions } from '@/utils/setupSuggestions';
import { getLegRoundStats, getSpectatorScore } from '@/utils/matchStats';
import { decorateAvg } from '@/utils/playerStats';
import type { Player, ThrowRecord, TurnRecord, TurnWithThrows } from '@/lib/match/types';
import type { FairEndingState } from '@/utils/fairEnding';
import type { FinishRule } from '@/utils/x01';
import { useEffect, useMemo, useRef } from 'react';

type Props = {
  match: { start_score: string; finish: string; legs_to_win: number };
  orderPlayers: Player[];
  spectatorCurrentPlayer: Player | null;
  turns: TurnRecord[];
  currentLegId?: string;
  startScore: number;
  finishRule: FinishRule;
  turnThrowCounts: Record<string, number>;
  getAvgForPlayer: (playerId: string) => number;
  fairEndingState?: FairEndingState;
  title?: string;
};

export function SpectatorLiveMatchCard({
  match,
  orderPlayers,
  spectatorCurrentPlayer,
  turns,
  currentLegId,
  startScore,
  finishRule,
  turnThrowCounts,
  getAvgForPlayer,
  fairEndingState,
  title = 'Live Match',
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousScores = useRef(new Map<string, { score: number; legId?: string }>());
  const scoreAnimations = useRef(new Map<string, Animation>());
  const currentPlayerId = spectatorCurrentPlayer?.id;
  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (!currentPlayerId) return;
    const el = itemRefs.current[currentPlayerId];
    const container = listRef.current;
    if (el && container) {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom) return;
      const offsetTop = elRect.top - containerRect.top + container.scrollTop;
      const target = offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, target), behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    return;
  }, [currentPlayerId, reducedMotion]);

  // Animate only changed, already-present scores. The canonical value paints immediately;
  // animation never delays scoring, and corrections replace any unfinished impact.
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const activeIds = new Set(orderPlayers.map((player) => player.id));
    for (const [playerId, tile] of Object.entries(itemRefs.current)) {
      if (!tile || !activeIds.has(playerId)) {
        previousScores.current.delete(playerId);
        scoreAnimations.current.get(playerId)?.cancel();
        scoreAnimations.current.delete(playerId);
        continue;
      }
      const score = Number(tile.dataset.score);
      const previous = previousScores.current.get(playerId);
      previousScores.current.set(playerId, { score, legId: currentLegId });
      if (!previous || previous.score === score || previous.legId !== currentLegId) continue;
      scoreAnimations.current.get(playerId)?.cancel();
      const number = tile.querySelector<HTMLElement>('[data-score-number]');
      if (prefersReducedMotion || !number?.animate) continue;
      const checkout = score === 0 && fairEndingState?.phase !== 'tiebreak';
      const animation = number.animate([
        { transform: 'translateY(7px) scale(0.94)', opacity: 0.55, offset: 0 },
        { transform: `translateY(-2px) scale(${checkout ? 1.12 : 1.06})`, opacity: 1, offset: 0.4 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: 1 },
      ], { duration: checkout ? 720 : 460, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      scoreAnimations.current.set(playerId, animation);
    }
  });

  useEffect(() => {
    const animations = scoreAnimations.current;
    return () => {
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
    };
  }, []);

  return (
    <Card className="min-w-0 gap-4 overflow-hidden xl:max-h-[calc(100dvh-3rem)] xl:self-start xl:col-span-2 xl:row-span-2">
      <CardHeader className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
        <CardTitle>{title}</CardTitle>
        <CardDescription className="text-xs">
          {match.start_score} · {match.finish.replace('_', ' ')} · First to {match.legs_to_win}
        </CardDescription>
        <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">{orderPlayers.length} players</span>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Checkout suggestions (hidden during tiebreak) */}
          {(() => {
            const isTiebreak = fairEndingState?.phase === 'tiebreak';
            if (!spectatorCurrentPlayer || isTiebreak) return null;

            const currentScore = getSpectatorScore(
              turns,
              currentLegId,
              startScore,
              turnThrowCounts,
              spectatorCurrentPlayer.id
            );
            const playerTurns = turns.filter((turn) => turn.player_id === spectatorCurrentPlayer.id);
            const lastTurn = playerTurns.length > 0 ? playerTurns[playerTurns.length - 1] : null;
            const throwCount = lastTurn ? turnThrowCounts[lastTurn.id] || 0 : 0;

            // Determine if this is a new turn starting or continuing an incomplete turn
            // New turn if: no turns yet, last turn was busted, or last turn completed (3 throws)
            const isNewTurnStarting = !lastTurn || lastTurn.busted || throwCount === 3;
            const dartsLeft = isNewTurnStarting ? 3 : Math.max(0, 3 - throwCount);

            const paths = computeCheckoutSuggestions(currentScore, dartsLeft, finishRule);

            // Only show checkout suggestions if we're actually in a checkout scenario
            const shouldShowCheckout = currentScore > 0 && currentScore <= 170 && dartsLeft > 0;
            const hasCheckout = shouldShowCheckout && paths.length > 0;
            const setup = !hasCheckout && currentScore > 0 && dartsLeft > 0
              ? computeSetupSuggestions(currentScore, dartsLeft, finishRule)
              : null;

            if (!hasCheckout && !setup && !shouldShowCheckout) return null;

            return (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {hasCheckout ? (
                  paths.map((p, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {p.join(', ')}
                    </Badge>
                  ))
                ) : setup ? (
                  <Badge variant="secondary" className="text-xs">
                    Setup: {setup.path.join(', ')} → {setup.target}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    No checkout available
                  </Badge>
                )}
              </div>
            );
          })()}

          {/* Player scores with inline throw indicators */}
          <div
            ref={listRef}
            role="list"
            aria-label="Live player scores"
            className="grid auto-rows-[minmax(13rem,auto)] content-start grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3 max-h-[70vh] min-h-0 overflow-y-auto overflow-x-hidden p-1 -m-1 xl:max-h-[calc(100dvh-9rem)]"
          >
            {orderPlayers.map((player) => {
              const isTiebreak = fairEndingState?.phase === 'tiebreak';
              const isTiebreakPlayer = isTiebreak && fairEndingState.tiebreakPlayerIds.includes(player.id);
              const score = isTiebreakPlayer
                ? (fairEndingState.tiebreakScores[player.id] ?? 0)
                : getSpectatorScore(turns, currentLegId, startScore, turnThrowCounts, player.id);
              const avg = getAvgForPlayer(player.id);
              const averageDecoration = decorateAvg(avg);
              const isCurrent = spectatorCurrentPlayer?.id === player.id;
              const isCheckedOut = fairEndingState?.checkedOutPlayerIds?.includes(player.id);

              // Get throws to display for this player
              let displayThrows: ThrowRecord[] = [];
              const playerTurns = turns.filter((turn) => turn.player_id === player.id);
              const lastTurn = playerTurns.length > 0 ? playerTurns[playerTurns.length - 1] : null;

              if (lastTurn) {
                const throwCount = turnThrowCounts[lastTurn.id] || 0;
                const isPlayerNewTurnStarting = lastTurn.busted || throwCount === 3;

                if (isCurrent && isPlayerNewTurnStarting) {
                  // Current player starting new turn - don't show any throws yet
                  displayThrows = [];
                } else if (isCurrent && throwCount > 0 && throwCount < 3) {
                  // Current player with incomplete turn - show current throws
                  displayThrows = (lastTurn as TurnWithThrows).throws || [];
                } else if (!isCurrent && (throwCount === 3 || lastTurn.busted)) {
                  // Show last completed turn for non-current players
                  displayThrows = (lastTurn as TurnWithThrows).throws || [];
                }

              }

              return (
                <div
                  key={player.id}
                  ref={(el) => {
                    itemRefs.current[player.id] = el;
                  }}
                  role="listitem"
                  data-score={score}
                  data-finished={Boolean(isCheckedOut || (!isTiebreak && score === 0))}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`scoreboard-tile @container relative flex min-h-[clamp(13rem,22dvh,16rem)] min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border p-4 transition-colors duration-300 motion-reduce:transition-none ${
                    isCurrent
                      ? 'border-lime-300/80 bg-gradient-to-br from-lime-300/20 via-lime-300/5 to-transparent shadow-[inset_0_1px_0_0_rgb(190_242_100/0.25)]'
                      : isCheckedOut
                        ? 'border-emerald-400/40 bg-emerald-400/5'
                        : 'border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.015]'
                  }`}
                >
                  <span className="scoreboard-sweep" aria-hidden="true" />
                  <div className="relative flex min-w-0 items-center gap-2.5">
                    <PlayerAvatar player={player} size="sm" />
                    <span className="min-w-0 break-words text-xl font-bold leading-tight tracking-tight">{player.display_name}</span>
                  </div>

                  <div className="my-auto flex flex-col items-start gap-2">
                    <div>
                      <div data-score-number className={`origin-left text-[clamp(3.5rem,34cqw,7rem)] font-black leading-none tracking-tighter tabular-nums ${isCurrent ? 'text-lime-300' : isCheckedOut ? 'text-emerald-300' : 'text-foreground'}`}>
                        {score}
                      </div>
                      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {isTiebreakPlayer ? `Round ${fairEndingState!.tiebreakRound} score` : 'Remaining'}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pb-0.5">
                      {isCurrent ? (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-lime-300">
                          <span className="scoreboard-turn-dot h-1.5 w-1.5 rounded-full bg-lime-300" />On throw
                        </span>
                      ) : isCheckedOut ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">Checked out</span>
                      ) : null}
                      <ThrowSegmentBadges
                        throws={displayThrows}
                        highlightIncomplete={isCurrent}
                        placeholder="·"
                      />
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-white/10 pt-2.5 text-xs tabular-nums text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span>{averageDecoration.emoji}</span> AVG
                      <span className={`font-semibold ${averageDecoration.cls}`}>{avg.toFixed(1)}</span>
                    </span>
                    {!isTiebreakPlayer && (() => {
                      const { lastRoundScore, bestRoundScore } = getLegRoundStats(turns, currentLegId, player.id);
                      return (
                        <span className="flex gap-3">
                          <span>Last <span className="font-medium text-foreground">{lastRoundScore}</span></span>
                          <span>Best <span className="font-medium text-foreground">{bestRoundScore}</span></span>
                        </span>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
