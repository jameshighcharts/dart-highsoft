"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Player, TurnWithThrows } from '@/lib/match/types';
import { ScoliaMatchHeatmaps } from './ScoliaMatchHeatmaps';

export type DartIQReportEvent = {
  dartId: string;
  legNumber: number;
  playerId: string;
  dartIndex: number;
  segment: string;
  scored: number;
  busted: boolean;
  checkedOut: boolean;
  scoreBefore: number;
  matchWpa: number;
  legWpa: number;
  matchConsequence: number;
  matchProbabilitiesAfter: Record<string, number>;
};

const SERIES_COLORS = ['#22c55e', '#38bdf8', '#f59e0b', '#f43f5e', '#a78bfa', '#14b8a6'];
const CHART_WIDTH = 1_000;
const CHART_HEIGHT = 340;
const CHART_LEFT = 48;
const CHART_RIGHT = 18;
const CHART_TOP = 20;
const CHART_BOTTOM = 34;

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function points(value: number) {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? '+' : ''}${rounded}pp`;
}

function playerProbability(event: DartIQReportEvent, playerId: string) {
  return event.matchProbabilitiesAfter[playerId] ?? 0;
}

function MatchPulse({
  timeline,
  playerIds,
  names,
  initialProbabilities,
  selectedDartId,
  onSelect,
}: {
  timeline: DartIQReportEvent[];
  playerIds: string[];
  names: Record<string, string>;
  initialProbabilities: Record<string, number>;
  selectedDartId?: string;
  onSelect: (dartId: string) => void;
}) {
  const plotWidth = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
  const plotHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
  const x = (index: number) => CHART_LEFT + (index / Math.max(1, timeline.length)) * plotWidth;
  const y = (probability: number) => CHART_TOP + (1 - probability) * plotHeight;
  const boundaries = timeline.flatMap((event, index) => (
    index > 0 && event.legNumber !== timeline[index - 1]?.legNumber ? [index] : []
  ));
  const selectOnKeyboard = (event: KeyboardEvent<SVGGElement>, dartId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect(dartId);
  };

  return (
    <div className="overflow-x-auto">
      <svg
        aria-label="Match win probability after every dart"
        className="min-w-[720px] w-full"
        role="group"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        <title>Match Pulse — win probability after every dart</title>
        {[0, 0.25, 0.5, 0.75, 1].map((probability) => (
          <g key={probability}>
            <line
              stroke="currentColor"
              strokeOpacity="0.12"
              x1={CHART_LEFT}
              x2={CHART_WIDTH - CHART_RIGHT}
              y1={y(probability)}
              y2={y(probability)}
            />
            <text
              className="fill-muted-foreground text-[12px]"
              textAnchor="end"
              x={CHART_LEFT - 8}
              y={y(probability) + 4}
            >
              {Math.round(probability * 100)}%
            </text>
          </g>
        ))}
        {boundaries.map((index) => (
          <g key={index}>
            <line
              stroke="currentColor"
              strokeDasharray="4 5"
              strokeOpacity="0.28"
              x1={x(index)}
              x2={x(index)}
              y1={CHART_TOP}
              y2={CHART_HEIGHT - CHART_BOTTOM}
            />
            <text
              className="fill-muted-foreground text-[11px]"
              textAnchor="middle"
              x={x(index)}
              y={CHART_HEIGHT - 10}
            >
              Leg {timeline[index]?.legNumber}
            </text>
          </g>
        ))}
        {playerIds.map((playerId, playerIndex) => {
          const color = SERIES_COLORS[playerIndex % SERIES_COLORS.length];
          const initial = initialProbabilities[playerId] ?? 0;
          const series = [
            `${x(0)},${y(initial)}`,
            ...timeline.map((event, index) => `${x(index + 1)},${y(playerProbability(event, playerId))}`),
          ].join(' ');
          return (
            <polyline
              fill="none"
              key={playerId}
              points={series}
              stroke={color}
              strokeLinejoin="round"
              strokeWidth="3"
            />
          );
        })}
        {timeline.map((event, index) => {
          const playerIndex = Math.max(0, playerIds.indexOf(event.playerId));
          const probability = playerProbability(event, event.playerId);
          const selected = event.dartId === selectedDartId;
          return (
            <g
              aria-label={`Select dart ${index + 1}: ${names[event.playerId] ?? 'Player'} ${event.segment}`}
              className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-cyan-300"
              key={event.dartId}
              onClick={() => onSelect(event.dartId)}
              onKeyDown={(keyboardEvent) => selectOnKeyboard(keyboardEvent, event.dartId)}
              role="button"
              tabIndex={0}
            >
              <circle
                cx={x(index + 1)}
                cy={y(probability)}
                fill={SERIES_COLORS[playerIndex % SERIES_COLORS.length]}
                r={selected ? '7' : '4'}
                stroke={selected ? '#67e8f9' : 'white'}
                strokeWidth={selected ? '3' : '1.5'}
              >
                <title>{`${names[event.playerId] ?? 'Player'} ${event.segment}: ${percent(probability)}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap justify-center gap-4 pt-2 text-sm">
        {playerIds.map((playerId, index) => (
          <span className="flex items-center gap-2" key={playerId}>
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
            />
            {names[playerId] ?? 'Player'}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DartIQReportExplorer({
  timeline,
  playerIds,
  names,
  initialProbabilities,
  initialSelectedDartId,
  players,
  turnsByLeg,
  children,
}: {
  timeline: DartIQReportEvent[];
  playerIds: string[];
  names: Record<string, string>;
  initialProbabilities: Record<string, number>;
  initialSelectedDartId?: string;
  players: Player[];
  turnsByLeg: Record<string, TurnWithThrows[]>;
  children?: ReactNode;
}) {
  const initialIndex = Math.max(0, timeline.findIndex((event) => event.dartId === initialSelectedDartId));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const selectedDart = timeline[selectedIndex];
  const selectedDartId = selectedDart?.dartId;
  const rankedDarts = useMemo(() => timeline
    .map((event) => ({
      event,
      matchWpa: event.matchWpa,
      legWpa: event.legWpa,
    }))
    .sort((a, b) => (
      b.event.matchConsequence - a.event.matchConsequence
      || Math.abs(b.legWpa) - Math.abs(a.legWpa)
    ))
    .slice(0, 12), [timeline]);

  const selectIndex = (index: number) => {
    if (timeline[index]) setSelectedIndex(index);
  };
  const selectDart = (dartId: string) => {
    const index = timeline.findIndex((event) => event.dartId === dartId);
    if (index >= 0) setSelectedIndex(index);
  };

  return (
    <>
      <Card id="match-pulse" className="scroll-mt-4">
        <CardHeader><CardTitle>Match Pulse</CardTitle></CardHeader>
        <CardContent>
          {timeline.length > 0 ? (
            <div className="space-y-4">
              <MatchPulse
                timeline={timeline}
                playerIds={playerIds}
                names={names}
                initialProbabilities={initialProbabilities}
                selectedDartId={selectedDartId}
                onSelect={selectDart}
              />
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Scrub every dart</span>
                  <span aria-live="polite">
                    {selectedIndex + 1}/{timeline.length} · {names[selectedDart?.playerId] ?? 'Player'} {selectedDart?.segment}
                  </span>
                </div>
                <input
                  aria-label="Selected dart in match"
                  className="h-2 w-full cursor-ew-resize accent-cyan-500"
                  max={timeline.length - 1}
                  min={0}
                  onChange={(event) => selectIndex(Number(event.currentTarget.value))}
                  step={1}
                  type="range"
                  value={selectedIndex}
                />
                <div className="flex justify-end gap-2">
                  <Button disabled={selectedIndex <= 0} onClick={() => selectIndex(selectedIndex - 1)} size="sm" type="button" variant="outline">Previous</Button>
                  <Button disabled={selectedIndex >= timeline.length - 1} onClick={() => selectIndex(selectedIndex + 1)} size="sm" type="button" variant="outline">Next</Button>
                  <Button disabled={selectedIndex >= timeline.length - 1} onClick={() => selectIndex(timeline.length - 1)} size="sm" type="button" variant="ghost">Latest</Button>
                </div>
              </div>
              {selectedDart ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">Dart {selectedIndex + 1} of {timeline.length}</div>
                    <div className="font-semibold">{names[selectedDart.playerId] ?? 'Player'} · {selectedDart.segment} for {selectedDart.scored}</div>
                    <div className="text-sm text-muted-foreground">Match {points(selectedDart.matchWpa)} · Leg {points(selectedDart.legWpa)}</div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="py-12 text-center text-muted-foreground">No darts recorded.</p>
          )}
        </CardContent>
      </Card>

      {children}

      <ScoliaMatchHeatmaps
        players={players}
        turns={[]}
        turnsByLeg={turnsByLeg}
        highlightedDartId={selectedDartId}
      />

      <Card>
        <CardHeader><CardTitle>Biggest darts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rankedDarts.map(({ event, matchWpa, legWpa }, index) => {
            const before = event.scoreBefore;
            const after = event.busted ? before : Math.max(0, before - event.scored);
            const selected = selectedDartId === event.dartId;
            return (
              <article
                className={`scroll-mt-4 rounded-lg border p-3 transition-colors ${selected ? 'border-cyan-400 bg-cyan-400/5 ring-1 ring-cyan-400/30' : ''}`}
                id={`dart-${event.dartId}`}
                key={event.dartId}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold"><span className="mr-2 text-muted-foreground">#{index + 1}</span>{names[event.playerId] ?? 'Player'} · {event.segment} for {event.scored}</div>
                    <div className="mt-1 text-sm text-muted-foreground">Leg {event.legNumber}, dart {event.dartIndex} · {before} → {after}{event.busted ? ' · bust' : ''}{event.checkedOut ? ' · checkout' : ''}</div>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <Badge variant={matchWpa >= 0 ? 'default' : 'destructive'}>Match {points(matchWpa)}</Badge>
                    <Badge variant="outline">Leg {points(legWpa)}</Badge>
                    <Badge variant="secondary">Impact {points(event.matchConsequence)}</Badge>
                  </div>
                </div>
                <div className="mt-3">
                  <button
                    className="text-xs font-medium text-cyan-600 hover:underline disabled:cursor-default disabled:no-underline dark:text-cyan-300"
                    disabled={selected}
                    onClick={() => selectDart(event.dartId)}
                    type="button"
                  >
                    {selected ? 'Selected across the report' : 'Select this dart across the report'}
                  </button>
                </div>
              </article>
            );
          })}
          {rankedDarts.length === 0 ? <p className="py-8 text-center text-muted-foreground">No ranked darts yet.</p> : null}
        </CardContent>
      </Card>
    </>
  );
}
