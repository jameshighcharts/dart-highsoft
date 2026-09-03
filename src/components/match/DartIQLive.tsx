"use client";

import { Activity, Crosshair } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { Player } from '@/lib/match/types';
import type { DartIQTrackerSnapshot } from '@/lib/dartiq/tracker';

type Props = {
  orderPlayers: Player[];
  legsToWin: number;
  matchWinnerId: string | null;
  snapshot: DartIQTrackerSnapshot;
  hasPersonalProfiles: boolean;
};

function formatProbability(value: number) {
  if (value > 0 && value < 0.005) return '<1%';
  if (value > 0.995 && value < 1) return '>99%';
  return `${Math.round(value * 100)}%`;
}

export function DartIQLive({
  orderPlayers,
  legsToWin,
  matchWinnerId,
  snapshot,
  hasPersonalProfiles,
}: Props) {
  const currentPlayerId = snapshot.state.currentPlayerId;
  const projection = {
    players: snapshot.state.projections,
    favoritePlayerId: snapshot.state.projections.reduce<string | null>((favoriteId, player) => {
      if (!favoriteId) return player.id;
      const favorite = snapshot.state.projections.find((entry) => entry.id === favoriteId);
      return !favorite || player.matchWinProbability > favorite.matchWinProbability
        ? player.id
        : favoriteId;
    }, null),
  };
  const currentCheckoutProbability = snapshot.currentCheckoutProbability;

  const projectionById = new Map(projection.players.map((player) => [player.id, player]));
  const favorite = orderPlayers.find((player) => player.id === projection.favoritePlayerId);
  const favoriteProjection = favorite ? projectionById.get(favorite.id) : undefined;
  const highField = orderPlayers.length > 4;
  const circularField = orderPlayers.length > 8;
  const playerGridClass = orderPlayers.length <= 2
    ? 'md:grid-cols-2'
    : orderPlayers.length === 3
      ? 'sm:grid-cols-2 xl:grid-cols-3'
      : orderPlayers.length === 4
        ? 'sm:grid-cols-2 xl:grid-cols-4'
        : orderPlayers.length === 5
          ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
          : orderPlayers.length === 6
            ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'
            : orderPlayers.length === 7
              ? 'sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7'
              : 'sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8';
  const railRef = useRef<HTMLDivElement | null>(null);
  const hasCenteredRailRef = useRef(false);

  useEffect(() => {
    if (!circularField || !currentPlayerId) return;
    const rail = railRef.current;
    if (!rail) return;

    const frame = window.requestAnimationFrame(() => {
      const candidates = Array.from(rail.querySelectorAll<HTMLElement>('[data-dartiq-player]'))
        .filter((element) => element.dataset.dartiqPlayer === currentPlayerId);
      const preferred = hasCenteredRailRef.current
        ? candidates.reduce<HTMLElement | null>((nearest, candidate) => {
            const target = candidate.offsetLeft - rail.clientWidth / 2 + candidate.clientWidth / 2;
            if (!nearest) return candidate;
            const nearestTarget = nearest.offsetLeft - rail.clientWidth / 2 + nearest.clientWidth / 2;
            return Math.abs(target - rail.scrollLeft) < Math.abs(nearestTarget - rail.scrollLeft)
              ? candidate
              : nearest;
          }, null)
        : candidates.find((candidate) => candidate.dataset.dartiqCycle === '1') ?? null;

      if (!preferred) return;
      const left = preferred.offsetLeft - rail.clientWidth / 2 + preferred.clientWidth / 2;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      rail.scrollTo({ left, behavior: hasCenteredRailRef.current && !reducedMotion ? 'smooth' : 'auto' });
      hasCenteredRailRef.current = true;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [circularField, currentPlayerId]);

  function handleCircularScroll() {
    const rail = railRef.current;
    if (!rail || !circularField) return;
    const cycleWidth = rail.scrollWidth / 3;
    if (rail.scrollLeft < cycleWidth * 0.25) {
      rail.scrollLeft += cycleWidth;
    } else if (rail.scrollLeft > cycleWidth * 1.75) {
      rail.scrollLeft -= cycleWidth;
    }
  }

  const displayCycles = circularField ? [0, 1, 2] : [0];

  return (
    <Card className="relative gap-3 overflow-hidden border-violet-500/30 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_35%),radial-gradient(circle_at_top_right,rgba(217,70,239,0.14),transparent_38%)] py-4 shadow-xl shadow-violet-950/10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />
      <CardHeader className="px-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-400/10">
              <Activity className="size-5 text-cyan-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-black tracking-tight sm:text-lg">Live win probability</div>
                <Badge className="border border-violet-300/30 bg-violet-500/15 text-[10px] text-violet-200">
                  DartIQ · Beta
                </Badge>
                {hasPersonalProfiles ? (
                  <Badge className="border border-emerald-300/25 bg-emerald-500/10 text-[10px] text-emerald-200">
                    Personalized
                  </Badge>
                ) : null}
              </div>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Recalculated after every dart · score · form · throw order · match position
              </p>
            </div>
          </div>

          {favorite && favoriteProjection ? (
            <div className="flex shrink-0 items-center gap-4 text-right">
              {currentPlayerId ? (
                <div className="hidden border-r border-white/10 pr-4 sm:block">
                  <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">On-throw checkout</div>
                  <div className="text-sm font-bold tabular-nums">
                    <span className="text-amber-300">{formatProbability(currentCheckoutProbability)}</span>
                  </div>
                </div>
              ) : null}
              <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Favorite</div>
              <div className="max-w-36 truncate text-sm font-bold">
                {favorite.display_name}{' '}
                <span className="font-mono text-cyan-300">{formatProbability(favoriteProjection.matchWinProbability)}</span>
              </div>
              </div>
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4 sm:px-5">
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10"
          role="img"
          aria-label={projection.players
            .map((player) => {
              const name = orderPlayers.find((entry) => entry.id === player.id)?.display_name ?? 'Player';
              return `${name} ${formatProbability(player.matchWinProbability)}`;
            })
            .join(', ')}
        >
          {projection.players.map((player, index) => (
            <div
              key={player.id}
              className="bg-[hsl(var(--player-hue)_85%_65%)] transition-[width] duration-700 ease-out"
              style={{
                width: `${(player.matchWinProbability * 100).toFixed(2)}%`,
                '--player-hue': Math.round((190 + index * 137.508) % 360),
              } as CSSProperties}
            />
          ))}
        </div>

        <div
          ref={railRef}
          onScroll={handleCircularScroll}
          className={circularField
            ? 'flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            : `grid gap-2 ${playerGridClass}`}
        >
          {displayCycles.flatMap((cycle) => orderPlayers.map((player, index) => {
            const stats = projectionById.get(player.id);
            if (!stats) return null;
            const colorStyle = {
              '--player-hue': Math.round((190 + index * 137.508) % 360),
            } as CSSProperties;
            const isCurrent = player.id === currentPlayerId && !matchWinnerId;
            const isFavorite = player.id === projection.favoritePlayerId;

            return (
              <div
                key={`${cycle}-${player.id}`}
                data-dartiq-player={player.id}
                data-dartiq-cycle={cycle}
                aria-hidden={circularField && cycle !== 1 ? true : undefined}
                className={`rounded-lg border py-2.5 shadow-lg shadow-black/20 ${circularField ? 'min-w-[180px] basis-[calc((100%_-_3.5rem)/8)] shrink-0 px-2.5' : highField ? 'px-2.5' : 'px-3'} ${
                  isCurrent ? 'border-cyan-300/50 bg-cyan-300/[0.07]' : 'border-white/10 bg-black/15'
                }`}
                style={colorStyle}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full bg-[hsl(var(--player-hue)_85%_65%)]" />
                    <span className={`truncate font-bold ${highField ? 'text-sm' : ''}`}>{player.display_name}</span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {isCurrent ? (
                      <Badge variant="outline" className="border-cyan-300/40 text-[10px] text-cyan-200">
                        <Crosshair aria-hidden="true" /> On throw
                      </Badge>
                    ) : null}
                    {isFavorite && !highField ? (
                      <Badge variant="outline" className="hidden border-white/15 text-[10px] sm:inline-flex">
                        Favorite
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className={`mt-2 flex items-end justify-between ${highField ? 'gap-1' : 'gap-3'}`}>
                  <div className={`flex items-baseline ${highField ? 'gap-1' : 'gap-2'}`}>
                    <div
                      className={`font-mono font-black tabular-nums text-[hsl(var(--player-hue)_85%_65%)] ${highField ? 'text-2xl' : 'text-3xl'}`}
                    >
                      {formatProbability(stats.matchWinProbability)}
                    </div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Match</div>
                  </div>
                  <div className={`text-right leading-4 text-muted-foreground ${highField ? 'text-[10px]' : 'text-[11px]'}`}>
                    <div><span className="font-semibold text-foreground">{stats.scoreRemaining}</span>{highField ? '' : ' left'} · {stats.legsWon}/{legsToWin}</div>
                    <div>
                      Leg <span className="font-mono font-semibold text-foreground">{formatProbability(stats.legWinProbability)}</span>
                      {' · '}~{Math.max(0, Math.ceil(stats.expectedDartsRemaining))} darts
                    </div>
                  </div>
                </div>
              </div>
            );
          }))}
        </div>
      </CardContent>
    </Card>
  );
}
