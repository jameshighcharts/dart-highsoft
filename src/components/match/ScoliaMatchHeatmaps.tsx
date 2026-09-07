'use client';

import { useMemo } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Player, ThrowRecord, TurnRecord, TurnWithThrows } from '@/lib/match/types';

const SIZE = 400;
const CENTER = SIZE / 2;
const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const DENSITY_SIGMA_MM = 22;
const MIN_DENSITY_CEILING = 4;

type Impact = ThrowRecord;
type HeatImpact = { impact: Impact; intensity: number };
type PlayerHeatData = { player: Player; impacts: HeatImpact[] };

function point(radius: number, angle: number) {
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

function sectorPath(inner: number, outer: number, start: number, end: number) {
  const a = point(inner, start);
  const b = point(outer, start);
  const c = point(outer, end);
  const d = point(inner, end);
  return `M ${a.x} ${a.y} L ${b.x} ${b.y} A ${outer} ${outer} 0 0 1 ${c.x} ${c.y} L ${d.x} ${d.y} A ${inner} ${inner} 0 0 0 ${a.x} ${a.y} Z`;
}

const WEDGES = NUMBERS.flatMap((_, index) => {
  const start = ((index * 18 - 99) * Math.PI) / 180;
  const end = (((index + 1) * 18 - 99) * Math.PI) / 180;
  const single = index % 2 === 0 ? '#17191d' : '#b9b3a3';
  const ring = index % 2 === 0 ? '#8f2530' : '#176b38';
  return [
    { d: sectorPath(15.9, 99, start, end), fill: single },
    { d: sectorPath(99, 107, start, end), fill: ring },
    { d: sectorPath(107, 162, start, end), fill: single },
    { d: sectorPath(162, 170, start, end), fill: ring },
  ];
});

function hasImpact(dart: ThrowRecord): dart is ThrowRecord & { impact_x_mm: number; impact_y_mm: number } {
  return typeof dart.impact_x_mm === 'number' && Number.isFinite(dart.impact_x_mm)
    && typeof dart.impact_y_mm === 'number' && Number.isFinite(dart.impact_y_mm);
}

function localDensity(impact: Impact, impacts: Impact[]) {
  let density = 0;
  const denominator = 2 * DENSITY_SIGMA_MM * DENSITY_SIGMA_MM;
  for (const other of impacts) {
    const dx = (impact.impact_x_mm ?? 0) - (other.impact_x_mm ?? 0);
    const dy = (impact.impact_y_mm ?? 0) - (other.impact_y_mm ?? 0);
    density += Math.exp(-(dx * dx + dy * dy) / denominator);
  }
  return density;
}

function heatColor(intensity: number) {
  if (intensity >= 0.82) return '#fff7ed';
  if (intensity >= 0.58) return '#fb7185';
  if (intensity >= 0.34) return '#fbbf24';
  return '#22d3ee';
}

function throwVerdict(impacts: HeatImpact[]) {
  if (impacts.length === 0) return { emoji: '🫥', label: 'Waiting to cause trouble' };

  const average = impacts.reduce((total, { impact }) => total + impact.scored, 0) / impacts.length;
  const multiplierRate = impacts.filter(({ impact }) => (
    impact.segment.startsWith('D') || impact.segment.startsWith('T')
  )).length / impacts.length;
  const hottestCluster = Math.max(...impacts.map(({ intensity }) => intensity));
  const centerX = impacts.reduce((total, { impact }) => total + (impact.impact_x_mm ?? 0), 0) / impacts.length;
  const centerY = impacts.reduce((total, { impact }) => total + (impact.impact_y_mm ?? 0), 0) / impacts.length;
  const spread = impacts.reduce((total, { impact }) => (
    total + Math.hypot((impact.impact_x_mm ?? 0) - centerX, (impact.impact_y_mm ?? 0) - centerY)
  ), 0) / impacts.length;

  if (average >= 45) return { emoji: '💀', label: 'Board murderer' };
  if (impacts.length >= 6 && hottestCluster >= 0.82) return { emoji: '🎯', label: 'Locked in' };
  if (multiplierRate >= 0.5) return { emoji: '🧨', label: 'Multiplier merchant' };
  if (average >= 30) return { emoji: '🔥', label: 'Cooking' };
  if (average < 12) return { emoji: '🧱', label: 'Bricklayer' };
  if (spread >= 100) return { emoji: '🌪️', label: 'Chaos merchant' };
  return { emoji: '😈', label: 'Certified menace' };
}

function PlayerHeatmap({
  data,
  highlightedDartId,
}: {
  data: PlayerHeatData;
  highlightedDartId?: string;
}) {
  const blurId = `heat-blur-${data.player.id}`;
  const coreBlurId = `heat-core-${data.player.id}`;
  const clipId = `heat-clip-${data.player.id}`;
  const verdict = throwVerdict(data.impacts);

  return (
    <article className="relative overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-[inset_0_0_80px_rgba(0,0,0,0.75)]">
      <div className="pointer-events-none absolute inset-x-[15%] top-[18%] h-1/2 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="flex items-end justify-between gap-4 px-5 pt-5">
        <h3 className="flex items-center gap-2 text-2xl font-black uppercase italic tracking-[-0.04em] text-white">
          <span>{data.player.display_name}</span>
          <span
            role="img"
            aria-label={verdict.label}
            title={verdict.label}
            className="inline-block not-italic drop-shadow-[0_0_12px_rgba(251,191,36,0.65)]"
          >
            {verdict.emoji}
          </span>
        </h3>
        <div className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-cyan-300/70">
          {data.impacts.length} {data.impacts.length === 1 ? 'impact' : 'impacts'}
        </div>
      </div>
      <svg viewBox="0 0 400 400" className="mx-auto block aspect-square w-full max-w-[520px]" role="img" aria-label={`${data.player.display_name} match impact heatmap`}>
        <defs>
          <filter id={blurId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id={coreBlurId} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <clipPath id={clipId}>
            <circle cx={CENTER} cy={CENTER} r="188" />
          </clipPath>
        </defs>
        <circle cx={CENTER} cy={CENTER} r="188" fill="#08090b" />
        <circle cx={CENTER} cy={CENTER} r="174" fill="#111318" stroke="#020203" strokeWidth="7" />
        {WEDGES.map((wedge, index) => (
          <path key={index} d={wedge.d} fill={wedge.fill} stroke="#090a0c" strokeWidth="0.8" />
        ))}
        <circle cx={CENTER} cy={CENTER} r="15.9" fill="#176b38" />
        <circle cx={CENTER} cy={CENTER} r="6.35" fill="#8f2530" />
        <g clipPath={`url(#${clipId})`} className="mix-blend-screen">
          {data.impacts.map(({ impact, intensity }) => (
            <circle
              key={`halo-${impact.id}`}
              cx={CENTER + (impact.impact_x_mm ?? 0)}
              cy={CENTER - (impact.impact_y_mm ?? 0)}
              r={25 + intensity * 13}
              fill={intensity >= 0.58 ? '#fb7185' : '#22d3ee'}
              opacity={0.24 + intensity * 0.38}
              filter={`url(#${blurId})`}
            />
          ))}
          {data.impacts.map(({ impact, intensity }) => (
            <circle
              key={`core-${impact.id}`}
              cx={CENTER + (impact.impact_x_mm ?? 0)}
              cy={CENTER - (impact.impact_y_mm ?? 0)}
              r={12 + intensity * 10}
              fill={heatColor(intensity)}
              opacity={0.38 + intensity * 0.52}
              filter={`url(#${coreBlurId})`}
            />
          ))}
        </g>
        {data.impacts.map(({ impact, intensity }) => (
          <g key={`point-${impact.id}`}>
            {impact.id === highlightedDartId ? (
              <circle
                cx={CENTER + (impact.impact_x_mm ?? 0)}
                cy={CENTER - (impact.impact_y_mm ?? 0)}
                fill="none"
                r="9"
                stroke="#67e8f9"
                strokeWidth="3"
              />
            ) : null}
            <circle
              cx={CENTER + (impact.impact_x_mm ?? 0)}
              cy={CENTER - (impact.impact_y_mm ?? 0)}
              r={impact.id === highlightedDartId ? 3.5 : 1.35 + intensity * 0.8}
              fill={impact.id === highlightedDartId || intensity >= 0.82 ? '#fff7ed' : 'white'}
              opacity={impact.id === highlightedDartId ? 1 : 0.58 + intensity * 0.35}
            >
              <title>{impact.segment}{impact.id === highlightedDartId ? ' · selected dart' : ''}</title>
            </circle>
          </g>
        ))}
        {NUMBERS.map((number, index) => {
          const position = point(181, ((index * 18 - 90) * Math.PI) / 180);
          return (
            <text key={number} x={position.x} y={position.y} fill="white" fillOpacity="0.72" fontSize="12" fontWeight="800" textAnchor="middle" dominantBaseline="middle">
              {number}
            </text>
          );
        })}
      </svg>
    </article>
  );
}

export function ScoliaMatchHeatmaps({
  players,
  turns,
  turnsByLeg,
  highlightedDartId,
}: {
  players: Player[];
  turns: TurnRecord[];
  turnsByLeg: Record<string, TurnRecord[]>;
  highlightedDartId?: string;
}) {
  const playerData = useMemo(() => {
    const currentTurnIds = new Set(turns.map((turn) => turn.id));
    const matchTurns = Object.values(turnsByLeg).flat().filter((turn) => !currentTurnIds.has(turn.id));
    const uniqueTurns = [...matchTurns, ...turns] as TurnWithThrows[];
    const impactsByPlayer = new Map(players.map((player) => [player.id, [] as Impact[]]));

    for (const turn of uniqueTurns) {
      const playerImpacts = impactsByPlayer.get(turn.player_id);
      if (!playerImpacts) continue;
      for (const dart of turn.throws ?? []) {
        if (hasImpact(dart)) playerImpacts.push(dart);
      }
    }

    return players.map((player) => ({ player, impacts: impactsByPlayer.get(player.id) ?? [] }));
  }, [players, turns, turnsByLeg]);

  const heatData = useMemo(() => {
    let maximum = MIN_DENSITY_CEILING;
    for (const data of playerData) {
      for (const impact of data.impacts) maximum = Math.max(maximum, localDensity(impact, data.impacts));
    }
    return playerData.map((data) => ({
      player: data.player,
      impacts: data.impacts.map((impact) => ({
        impact,
        intensity: Math.min(1, localDensity(impact, data.impacts) / maximum),
      })),
    }));
  }, [playerData]);

  if (!playerData.some((data) => data.impacts.length > 0)) return null;

  return (
    <Card className="w-full overflow-hidden border-white/10 bg-gradient-to-br from-card via-card to-cyan-950/20">
      <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle className="text-2xl">Match heat</CardTitle>
          <CardDescription>Every tracked Scolia impact across all legs.</CardDescription>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.22em] text-muted-foreground">
          <span>Low</span>
          <span className="h-1.5 w-28 rounded-full bg-gradient-to-r from-cyan-400 via-amber-400 to-rose-400 shadow-[0_0_14px_rgba(34,211,238,0.35)]" />
          <span>Hot</span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {heatData.map((data) => (
          <PlayerHeatmap
            key={data.player.id}
            data={data}
            highlightedDartId={highlightedDartId}
          />
        ))}
      </CardContent>
    </Card>
  );
}
