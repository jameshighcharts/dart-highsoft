'use client';

import { Activity, Crown, Flame, Sparkles, Target, TrendingDown, TrendingUp, Trophy, Zap } from 'lucide-react';
import { useMemo } from 'react';

import { ThrowSegmentBadges } from '@/components/ThrowSegmentBadges';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MatchEloChange } from '@/hooks/useMatchEloChanges';
import type { LegRecord, MatchRecord, Player, TurnRecord, TurnWithThrows } from '@/lib/match/types';
import { getEloTier } from '@/utils/eloRating';

type PlayerMatchStats = {
  player: Player;
  legsWon: number;
  dartsThrown: number;
  totalScored: number;
  threeDartAverage: number;
  bestVisit: number;
  tonPlusVisits: number;
  oneFortyPlusVisits: number;
  maxVisits: number;
};

export type HistoricalMatchStats = {
  players: PlayerMatchStats[];
  allTurns: TurnWithThrows[];
  totalDarts: number;
  bestAverage: number;
  bestVisit: number;
  tonPlusVisits: number;
};

function scoredForTurn(turn: TurnWithThrows) {
  if (turn.busted) return 0;
  if (typeof turn.total_scored === 'number') return turn.total_scored;
  return (turn.throws ?? []).reduce((sum, dart) => sum + dart.scored, 0);
}

export function computeHistoricalMatchStats({
  players,
  legs,
  turns,
  turnsByLeg,
}: {
  players: Player[];
  legs: LegRecord[];
  turns: TurnRecord[];
  turnsByLeg: Record<string, TurnRecord[]>;
}): HistoricalMatchStats {
  const turnsById = new Map<string, TurnWithThrows>();
  for (const turn of Object.values(turnsByLeg).flat() as TurnWithThrows[]) turnsById.set(turn.id, turn);
  for (const turn of turns as TurnWithThrows[]) turnsById.set(turn.id, turn);
  const allTurns = [...turnsById.values()];

  const playerStats = players.map((player) => {
    const playerTurns = allTurns.filter((turn) => turn.player_id === player.id);
    const visitScores = playerTurns.map(scoredForTurn);
    const dartsThrown = playerTurns.reduce((sum, turn) => sum + (turn.throws?.length ?? 0), 0);
    const totalScored = visitScores.reduce((sum, score) => sum + score, 0);

    return {
      player,
      legsWon: legs.filter((leg) => leg.winner_player_id === player.id).length,
      dartsThrown,
      totalScored,
      threeDartAverage: dartsThrown > 0 ? (totalScored / dartsThrown) * 3 : 0,
      bestVisit: visitScores.length > 0 ? Math.max(...visitScores) : 0,
      tonPlusVisits: visitScores.filter((score) => score >= 100).length,
      oneFortyPlusVisits: visitScores.filter((score) => score >= 140).length,
      maxVisits: visitScores.filter((score) => score === 180).length,
    };
  });

  return {
    players: playerStats,
    allTurns,
    totalDarts: playerStats.reduce((sum, player) => sum + player.dartsThrown, 0),
    bestAverage: playerStats.reduce((best, player) => Math.max(best, player.threeDartAverage), 0),
    bestVisit: playerStats.reduce((best, player) => Math.max(best, player.bestVisit), 0),
    tonPlusVisits: playerStats.reduce((sum, player) => sum + player.tonPlusVisits, 0),
  };
}

function formatFinish(finish: string) {
  return finish
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

export function HistoricalMatchOverview({
  match,
  players,
  legs,
  turns,
  turnsByLeg,
  matchWinnerId,
  eloChanges,
  eloChangesLoading,
}: {
  match: MatchRecord;
  players: Player[];
  legs: LegRecord[];
  turns: TurnRecord[];
  turnsByLeg: Record<string, TurnRecord[]>;
  matchWinnerId: string | null;
  eloChanges: MatchEloChange[];
  eloChangesLoading: boolean;
}) {
  const stats = useMemo(
    () => computeHistoricalMatchStats({ players, legs, turns, turnsByLeg }),
    [legs, players, turns, turnsByLeg]
  );
  const winner = players.find((player) => player.id === matchWinnerId);
  const eloByPlayer = useMemo(
    () => new Map(eloChanges.map((change) => [change.player_id, change])),
    [eloChanges]
  );
  const sortedPlayers = [...stats.players].sort((a, b) => {
    if (a.player.id === matchWinnerId) return -1;
    if (b.player.id === matchWinnerId) return 1;
    return b.legsWon - a.legsWon || b.threeDartAverage - a.threeDartAverage;
  });
  const topVisits = [...stats.allTurns]
    .filter((turn) => !turn.busted)
    .sort((a, b) => scoredForTurn(b) - scoredForTurn(a))
    .slice(0, 5);
  const scoreline = sortedPlayers.map((player) => player.legsWon).join(' – ');
  const winnerEloChange = matchWinnerId ? eloByPlayer.get(matchWinnerId) : undefined;
  const isUpsetWin = winnerEloChange
    ? eloChanges.some((change) => change.rating_before > winnerEloChange.rating_before)
    : false;
  const biggestEloSwing = eloChanges.reduce((biggest, change) => Math.max(biggest, Math.abs(change.rating_change)), 0);
  const headlineStats = [
    { label: 'Darts thrown', value: stats.totalDarts, icon: Target, tone: 'text-cyan-500' },
    { label: 'Best average', value: stats.bestAverage.toFixed(1), icon: Activity, tone: 'text-violet-500' },
    { label: 'Best visit', value: stats.bestVisit, icon: Flame, tone: 'text-orange-500' },
    { label: '100+ visits', value: stats.tonPlusVisits, icon: Trophy, tone: 'text-amber-500' },
    ...(eloChanges.length > 0
      ? [{ label: 'Biggest Elo swing', value: biggestEloSwing, icon: Zap, tone: 'text-emerald-500' }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <section className="relative isolate overflow-hidden rounded-3xl border border-cyan-400/20 bg-slate-950 px-6 py-8 text-white shadow-2xl shadow-cyan-950/20 sm:px-10 sm:py-10">
        <div className="absolute -left-24 top-1/2 -z-10 h-72 w-72 -translate-y-1/2 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -right-20 -top-24 -z-10 h-80 w-80 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_70%_20%,rgba(34,211,238,0.13),transparent_34%),linear-gradient(120deg,rgba(15,23,42,0.25),rgba(2,6,23,0.95))]" />

        <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-5 flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-cyan-300">
              <Sparkles className="h-4 w-4" />
              Match complete
              <span className="text-white/25">/</span>
              <span className="text-white/55">{match.start_score} X01 · {formatFinish(match.finish)}</span>
              <span className="text-white/25">/</span>
              <span className={eloChanges.length > 0 ? 'text-emerald-300' : 'text-white/40'}>
                {eloChangesLoading
                  ? 'Loading Elo'
                  : eloChanges.length > 0
                    ? `${players.length > 2 ? 'Multiplayer' : 'Head-to-head'} Elo rated`
                    : 'Unrated match'}
              </span>
            </div>
            {winner ? (
              <>
                <div className="flex items-center gap-3 text-amber-300">
                  <Crown className="h-8 w-8 fill-current" />
                  <span className="text-sm font-black uppercase tracking-[0.28em]">Champion</span>
                  {winnerEloChange ? (
                    <span className="whitespace-nowrap rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 font-mono text-xs tracking-normal text-emerald-200">
                      {winnerEloChange.rating_change >= 0 ? '+' : ''}{winnerEloChange.rating_change} Elo
                    </span>
                  ) : null}
                  {isUpsetWin ? (
                    <span className="whitespace-nowrap rounded-full border border-fuchsia-300/30 bg-fuchsia-300/10 px-3 py-1 text-[10px] tracking-[0.18em] text-fuchsia-200">
                      Upset win
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-2 bg-gradient-to-r from-white via-cyan-100 to-amber-200 bg-clip-text text-5xl font-black tracking-[-0.055em] text-transparent sm:text-7xl">
                  {winner.display_name}
                </h2>
              </>
            ) : (
              <h2 className="text-4xl font-black tracking-tight sm:text-6xl">Match ended early</h2>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {sortedPlayers.map((player) => (
                <Badge
                  key={player.player.id}
                  className={player.player.id === matchWinnerId
                    ? 'border-amber-300/30 bg-amber-300/15 px-3 py-1 text-amber-100'
                    : 'border-white/10 bg-white/5 px-3 py-1 text-white/70'}
                  variant="outline"
                >
                  {player.player.display_name} · {player.legsWon} leg{player.legsWon === 1 ? '' : 's'}
                </Badge>
              ))}
            </div>
          </div>

          <div className="relative mx-auto flex h-44 w-44 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] shadow-[0_0_70px_rgba(34,211,238,0.16)] backdrop-blur sm:h-52 sm:w-52">
            <div className="absolute inset-3 rounded-full border border-dashed border-cyan-300/20" />
            <div className="text-center">
              <div className="font-mono text-5xl font-black tracking-[-0.12em] sm:text-6xl">{scoreline || '—'}</div>
              <div className="mt-2 text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300/70">Final score</div>
            </div>
          </div>
        </div>
      </section>

      <div className={`grid gap-3 sm:grid-cols-2 ${headlineStats.length === 5 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        {headlineStats.map((item) => (
          <Card key={item.label} className="overflow-hidden border-white/10 bg-gradient-to-br from-card to-muted/20 py-0">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                <div className="mt-1 font-mono text-4xl font-black tracking-tight">{item.value}</div>
              </div>
              <div className="rounded-2xl bg-muted/60 p-3">
                <item.icon className={`h-6 w-6 ${item.tone}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Activity className="h-5 w-5 text-cyan-500" />
              Player performance
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {sortedPlayers.map((player, index) => {
              const elo = eloByPlayer.get(player.player.id);
              const tier = elo ? getEloTier(elo.rating_after) : null;
              const EloTrend = elo && elo.rating_change < 0 ? TrendingDown : TrendingUp;
              return (
                <article
                key={player.player.id}
                className={`relative overflow-hidden rounded-2xl border p-5 ${player.player.id === matchWinnerId
                  ? 'border-amber-400/40 bg-gradient-to-br from-amber-500/10 via-card to-cyan-500/5'
                  : 'bg-muted/20'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">
                      {player.player.id === matchWinnerId ? 'Winner' : `Place ${index + 1}`}
                    </div>
                    <h3 className="mt-1 text-2xl font-black tracking-tight">{player.player.display_name}</h3>
                  </div>
                  <div className="font-mono text-4xl font-black text-primary">{player.threeDartAverage.toFixed(1)}</div>
                </div>
                <div className="mt-1 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground">3-dart avg</div>
                <div className="mt-5 grid grid-cols-4 gap-2 border-t pt-4 text-center">
                  {[
                    ['Best', player.bestVisit],
                    ['100+', player.tonPlusVisits],
                    ['140+', player.oneFortyPlusVisits],
                    ['180s', player.maxVisits],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="font-mono text-xl font-black">{value}</div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
                {elo ? (
                  <div className="mt-4 rounded-xl border border-emerald-500/15 bg-slate-950/5 p-3 dark:bg-slate-950/35">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Elo movement</div>
                        <div className="mt-1 flex items-baseline gap-2 font-mono">
                          <span className="text-muted-foreground">{elo.rating_before}</span>
                          <span className="text-muted-foreground/40">→</span>
                          <span className="text-xl font-black">{elo.rating_after}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`flex items-center justify-end gap-1 font-mono text-xl font-black ${elo.rating_change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          <EloTrend className="h-5 w-5" />
                          {elo.rating_change >= 0 ? '+' : ''}{elo.rating_change}
                        </div>
                        {tier ? <div className={`text-xs font-bold ${tier.color}`}>{tier.icon} {tier.name}</div> : null}
                      </div>
                    </div>
                  </div>
                ) : null}
                </article>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Flame className="h-5 w-5 text-orange-500" />
              Hottest visits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topVisits.length > 0 ? topVisits.map((turn, index) => (
              <div key={turn.id} className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-black ${index === 0 ? 'bg-amber-400 text-amber-950' : 'bg-muted text-muted-foreground'}`}>
                    {index + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">
                      {players.find((player) => player.id === turn.player_id)?.display_name ?? 'Player'}
                    </div>
                    <ThrowSegmentBadges throws={turn.throws ?? []} className="mt-1" />
                  </div>
                </div>
                <div className="font-mono text-2xl font-black text-primary">{scoredForTurn(turn)}</div>
              </div>
            )) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No completed visits</div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
