import { ArrowLeft, Crosshair, Trophy, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { analyzeDartIQTimeline } from '@/lib/dartiq/insights';
import { createBehavioralOutcomeModel } from '@/lib/dartiq/model/outcomes';
import { reconstructDartIQTimeline, type DartIQDartEvent } from '@/lib/dartiq/replay';
import { loadMatchData } from '@/lib/match/loadMatchData';
import type { TurnWithThrows } from '@/lib/match/types';
import { loadFrozenDartIQEvidence } from '@/lib/server/dartiqEvidence';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

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

function playerProbability(event: DartIQDartEvent, playerId: string) {
  return event.after.projections.find((player) => player.id === playerId)?.matchWinProbability ?? 0;
}

function MatchPulse({
  timeline,
  playerIds,
  names,
}: {
  timeline: DartIQDartEvent[];
  playerIds: string[];
  names: ReadonlyMap<string, string>;
}) {
  const plotWidth = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
  const plotHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
  const x = (index: number) => CHART_LEFT + (index / Math.max(1, timeline.length)) * plotWidth;
  const y = (probability: number) => CHART_TOP + (1 - probability) * plotHeight;
  const boundaries = timeline.flatMap((event, index) => (
    index > 0 && event.legNumber !== timeline[index - 1]?.legNumber ? [index] : []
  ));

  return (
    <div className="overflow-x-auto">
      <svg
        aria-label="Match win probability after every dart"
        className="min-w-[720px] w-full"
        role="img"
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
          const initial = timeline[0]?.before.projections.find((player) => player.id === playerId)
            ?.matchWinProbability ?? 0;
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
          return (
            <a href={`#dart-${event.dartId}`} key={event.dartId}>
              <circle
                cx={x(index + 1)}
                cy={y(probability)}
                fill={SERIES_COLORS[playerIndex % SERIES_COLORS.length]}
                r="4"
                stroke="white"
                strokeWidth="1.5"
              >
                <title>{`${names.get(event.playerId) ?? 'Player'} ${event.segment}: ${percent(probability)}`}</title>
              </circle>
            </a>
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
            {names.get(playerId) ?? 'Player'}
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function DartIQReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseServerClient();
  const [data, evidence] = await Promise.all([
    loadMatchData(supabase, id, { includeTurnsByLegThrows: true }),
    loadFrozenDartIQEvidence(supabase, id),
  ]);
  if (!data.match) notFound();

  const names = new Map(data.players.map((player) => [player.id, player.display_name]));
  const playerIds = data.players.map((player) => player.id);
  const personalOutcomes = new Map<string, NonNullable<typeof evidence>['populationOutcomes']>();
  for (const outcome of evidence?.playerOutcomes ?? []) {
    const observations = personalOutcomes.get(outcome.playerId) ?? [];
    observations.push(outcome);
    personalOutcomes.set(outcome.playerId, observations);
  }
  const playerProfiles = Object.fromEntries(
    (evidence?.playerProfiles ?? []).map((profile) => [profile.playerId, profile])
  );
  const outcomeModels = Object.fromEntries(playerIds.map((playerId) => [
    playerId,
    createBehavioralOutcomeModel({
      personal: personalOutcomes.get(playerId),
      population: evidence?.populationOutcomes,
    }),
  ]));
  const timeline = reconstructDartIQTimeline({
    playerIds,
    legs: data.legs,
    turnsByLeg: data.turnsByLeg as Record<string, TurnWithThrows[]>,
    startScore: Number(data.match.start_score),
    finishRule: data.match.finish,
    legsToWin: data.match.legs_to_win,
    playerProfiles,
    populationProfile: evidence?.populationProfile,
    outcomeModels,
    fairEnding: Boolean(data.match.fair_ending),
  });
  const insights = analyzeDartIQTimeline(timeline);
  const rankedDarts = timeline
    .map((event) => ({
      event,
      matchWpa: event.matchWinProbabilityAdded[event.playerId] ?? 0,
      legWpa: event.legWinProbabilityAdded[event.playerId] ?? 0,
    }))
    .sort((a, b) => (
      b.event.consequence.match - a.event.consequence.match
      || b.event.consequence.leg - a.event.consequence.leg
    ))
    .slice(0, 12);
  const winnerName = data.match.winner_player_id
    ? names.get(data.match.winner_player_id) ?? 'Winner'
    : null;

  return (
    <main className="container mx-auto space-y-6 p-4 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary">DartIQ</Badge>
            <span className="text-sm text-muted-foreground">{timeline.length} darts analysed</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Match Report</h1>
          <p className="mt-1 text-muted-foreground">
            {data.players.map((player) => player.display_name).join(' · ')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/games"><ArrowLeft className="mr-2 h-4 w-4" />Games</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/match/${id}?spectator=true&history=true`}>Match stats</Link>
          </Button>
        </div>
      </div>

      {!evidence ? (
        <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/10">
          <CardContent className="py-4 text-sm">
            This match predates frozen DartIQ evidence. The report uses conservative fallback inputs
            and is labelled as uncalibrated.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-5">
            <Trophy className="h-7 w-7 text-amber-500" />
            <div><div className="text-sm text-muted-foreground">Winner</div><div className="font-semibold">{winnerName ?? 'In progress'}</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-5">
            <Crosshair className="h-7 w-7 text-sky-500" />
            <div><div className="text-sm text-muted-foreground">Lead changes</div><div className="text-xl font-semibold">{insights.leadChanges.length}</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-5">
            <TrendingUp className="h-7 w-7 text-emerald-500" />
            <div><div className="text-sm text-muted-foreground">Stolen legs</div><div className="text-xl font-semibold">{insights.stolenLegs.length}</div></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-5">
            <TrendingDown className="h-7 w-7 text-rose-500" />
            <div><div className="text-sm text-muted-foreground">Thrown away</div><div className="text-xl font-semibold">{insights.thrownAwayLegs.length}</div></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Match Pulse</CardTitle></CardHeader>
        <CardContent>
          {timeline.length > 0 ? (
            <MatchPulse timeline={timeline} playerIds={playerIds} names={names} />
          ) : (
            <p className="py-12 text-center text-muted-foreground">No darts recorded.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Biggest darts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rankedDarts.map(({ event, matchWpa, legWpa }, index) => {
            const before = event.before.scores[event.playerId] ?? 0;
            const after = event.busted ? before : Math.max(0, before - event.scored);
            return (
              <article
                className="scroll-mt-4 rounded-lg border p-3 transition-colors target:border-primary target:bg-primary/5"
                id={`dart-${event.dartId}`}
                key={event.dartId}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      <span className="mr-2 text-muted-foreground">#{index + 1}</span>
                      {names.get(event.playerId) ?? 'Player'} · {event.segment} for {event.scored}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Leg {event.legNumber}, dart {event.dartIndex} · {before} → {after}
                      {event.busted ? ' · bust' : ''}{event.checkedOut ? ' · checkout' : ''}
                    </div>
                  </div>
                  <div className="flex gap-2 text-sm">
                    <Badge variant={matchWpa >= 0 ? 'default' : 'destructive'}>Match {points(matchWpa)}</Badge>
                    <Badge variant="outline">Leg {points(legWpa)}</Badge>
                    <Badge variant="secondary">Impact {points(event.consequence.match)}</Badge>
                  </div>
                </div>
              </article>
            );
          })}
          {rankedDarts.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No ranked darts yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
