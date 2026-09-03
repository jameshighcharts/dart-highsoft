import { ArrowLeft, Crosshair, Trophy, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScoliaMatchHeatmaps } from '@/components/match/ScoliaMatchHeatmaps';
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

function completedVisit(event: DartIQDartEvent) {
  return event.dartIndex >= 3 || event.busted || event.checkedOut;
}

function MatchPulse({
  timeline,
  playerIds,
  names,
  selectedDartId,
}: {
  timeline: DartIQDartEvent[];
  playerIds: string[];
  names: ReadonlyMap<string, string>;
  selectedDartId?: string;
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
            <a href={`?dart=${encodeURIComponent(event.dartId)}#match-pulse`} key={event.dartId}>
              <circle
                cx={x(index + 1)}
                cy={y(probability)}
                fill={SERIES_COLORS[playerIndex % SERIES_COLORS.length]}
                r={event.dartId === selectedDartId ? '7' : '4'}
                stroke={event.dartId === selectedDartId ? '#67e8f9' : 'white'}
                strokeWidth={event.dartId === selectedDartId ? '3' : '1.5'}
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

export default async function DartIQReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dart?: string }>;
}) {
  const { id } = await params;
  const requestedDartId = (await searchParams).dart;
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
  const selectedDartId = timeline.some((event) => event.dartId === requestedDartId)
    ? requestedDartId
    : undefined;
  const selectedDartIndex = selectedDartId
    ? timeline.findIndex((event) => event.dartId === selectedDartId)
    : -1;
  const selectedDart = selectedDartIndex >= 0 ? timeline[selectedDartIndex] : undefined;
  const previousDart = selectedDartIndex > 0 ? timeline[selectedDartIndex - 1] : undefined;
  const nextDart = selectedDartIndex >= 0 && selectedDartIndex < timeline.length - 1
    ? timeline[selectedDartIndex + 1]
    : undefined;
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
  const turningPoint = insights.turningPoint;
  const storySummary = [
    winnerName ? `${winnerName} won the match.` : 'The match is still in progress.',
    turningPoint
      ? `The biggest turn came in leg ${turningPoint.legNumber}, when ${names.get(turningPoint.playerId) ?? 'a player'} hit ${turningPoint.segment} and moved their match chance from ${percent(turningPoint.beforeMatchProbability)} to ${percent(turningPoint.afterMatchProbability)}.`
      : null,
    insights.stolenLegs.length > 0
      ? `${insights.stolenLegs.length} ${insights.stolenLegs.length === 1 ? 'leg was' : 'legs were'} won from a 20% chance or lower.`
      : null,
    insights.thrownAwayLegs.length > 0
      ? `${insights.thrownAwayLegs.length} ${insights.thrownAwayLegs.length === 1 ? 'leg was' : 'legs were'} lost after reaching at least 80%.`
      : null,
    `${insights.leadChanges.length} ${insights.leadChanges.length === 1 ? 'lead change' : 'lead changes'} across ${timeline.length} darts.`,
  ].filter(Boolean).join(' ');
  const playerSummaries = playerIds.map((playerId) => {
    const playerEvents = timeline.filter((event) => event.playerId === playerId);
    const completedVisits = playerEvents.filter(completedVisit);
    const initial = timeline[0]?.before.projections.find((player) => player.id === playerId);
    const latest = timeline.at(-1)?.after.projections.find((player) => player.id === playerId)
      ?? initial;
    let biggestGain = 0;
    let biggestLoss = 0;
    for (const event of playerEvents) {
      const wpa = event.matchWinProbabilityAdded[playerId] ?? 0;
      biggestGain = Math.max(biggestGain, wpa);
      biggestLoss = Math.min(biggestLoss, wpa);
    }
    return {
      playerId,
      name: names.get(playerId) ?? 'Player',
      average: latest?.threeDartAverage ?? 0,
      baselineAverage: latest?.baselineThreeDartAverage ?? 0,
      profileSource: latest?.profileSource ?? 'fallback',
      historicalDarts: latest?.historicalDarts ?? 0,
      matchWpaOnThrow: playerEvents.reduce(
        (total, event) => total + (event.matchWinProbabilityAdded[playerId] ?? 0),
        0
      ),
      biggestGain,
      biggestLoss,
      highVisits: completedVisits.filter((event) => event.turnScoreAfter >= 100).length,
      oneEighties: completedVisits.filter((event) => event.turnScoreAfter === 180).length,
      checkouts: playerEvents.filter((event) => event.checkedOut).length,
      checkoutVisits: new Set(
        playerEvents
          .filter((event) => event.checkout.checkoutProbabilityBefore > 0)
          .map((event) => event.turnId)
      ).size,
      busts: playerEvents.filter((event) => event.busted).length,
      bogeys: playerEvents.filter((event) => event.checkout.createdBogey).length,
      stolenLegs: insights.stolenLegs.filter((story) => story.playerId === playerId).length,
      thrownAwayLegs: insights.thrownAwayLegs.filter((story) => story.playerId === playerId).length,
    };
  });

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

      <Card className="border-violet-500/25 bg-gradient-to-br from-violet-500/10 via-background to-cyan-500/10">
        <CardHeader><CardTitle>The match in one paragraph</CardTitle></CardHeader>
        <CardContent>
          <p className="max-w-4xl text-base leading-7">{storySummary}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Every claim is generated from the frozen DartIQ replay—no AI embellishment.
          </p>
        </CardContent>
      </Card>

      <Card id="match-pulse" className="scroll-mt-4">
        <CardHeader><CardTitle>Match Pulse</CardTitle></CardHeader>
        <CardContent>
          {timeline.length > 0 ? (
            <div className="space-y-4">
              <MatchPulse
                timeline={timeline}
                playerIds={playerIds}
                names={names}
                selectedDartId={selectedDartId}
              />
              {selectedDart ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                      Dart {selectedDartIndex + 1} of {timeline.length}
                    </div>
                    <div className="font-semibold">
                      {names.get(selectedDart.playerId) ?? 'Player'} · {selectedDart.segment} for {selectedDart.scored}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Match {points(selectedDart.matchWinProbabilityAdded[selectedDart.playerId] ?? 0)} · Leg {points(selectedDart.legWinProbabilityAdded[selectedDart.playerId] ?? 0)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild disabled={!previousDart} size="sm" variant="outline">
                      {previousDart
                        ? <Link href={`?dart=${encodeURIComponent(previousDart.dartId)}#match-pulse`}>Previous</Link>
                        : <span>Previous</span>}
                    </Button>
                    <Button asChild disabled={!nextDart} size="sm" variant="outline">
                      {nextDart
                        ? <Link href={`?dart=${encodeURIComponent(nextDart.dartId)}#match-pulse`}>Next</Link>
                        : <span>Next</span>}
                    </Button>
                    <Button asChild size="sm" variant="ghost">
                      <Link href="?#match-pulse">Clear</Link>
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="py-12 text-center text-muted-foreground">No darts recorded.</p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Player breakdown</h2>
          <p className="text-sm text-muted-foreground">
            Match performance against the evidence frozen before the first dart.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {playerSummaries.map((summary, index) => (
            <Card key={summary.playerId}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
                      />
                      {summary.name}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {summary.profileSource} baseline · {summary.historicalDarts} historical darts
                    </p>
                  </div>
                  <Badge variant={summary.average >= summary.baselineAverage ? 'default' : 'secondary'}>
                    {summary.average >= summary.baselineAverage ? '+' : ''}
                    {(summary.average - summary.baselineAverage).toFixed(1)} avg
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-muted/60 p-3">
                    <div className="text-xl font-semibold">{summary.average.toFixed(1)}</div>
                    <div className="text-xs text-muted-foreground">match avg</div>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <div className="text-xl font-semibold">{summary.baselineAverage.toFixed(1)}</div>
                    <div className="text-xs text-muted-foreground">baseline</div>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <div className="text-xl font-semibold">{points(summary.matchWpaOnThrow)}</div>
                    <div className="text-xs text-muted-foreground">WPA on throw</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-4">
                  <div><span className="text-muted-foreground">100+ visits</span><div className="font-semibold">{summary.highVisits}</div></div>
                  <div><span className="text-muted-foreground">180s</span><div className="font-semibold">{summary.oneEighties}</div></div>
                  <div><span className="text-muted-foreground">Checkout visits</span><div className="font-semibold">{summary.checkouts}/{summary.checkoutVisits}</div></div>
                  <div><span className="text-muted-foreground">Busts</span><div className="font-semibold">{summary.busts}</div></div>
                  <div><span className="text-muted-foreground">Biggest gain</span><div className="font-semibold text-emerald-600">{points(summary.biggestGain)}</div></div>
                  <div><span className="text-muted-foreground">Biggest loss</span><div className="font-semibold text-rose-600">{points(summary.biggestLoss)}</div></div>
                  <div><span className="text-muted-foreground">Stolen legs</span><div className="font-semibold">{summary.stolenLegs}</div></div>
                  <div><span className="text-muted-foreground">Bogey leaves</span><div className="font-semibold">{summary.bogeys}</div></div>
                </div>
                {summary.thrownAwayLegs > 0 ? (
                  <p className="text-sm text-rose-600">
                    {summary.thrownAwayLegs} {summary.thrownAwayLegs === 1 ? 'leg was' : 'legs were'} lost after reaching at least an 80% chance.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <ScoliaMatchHeatmaps
        players={data.players}
        turns={[]}
        turnsByLeg={data.turnsByLeg as Record<string, TurnWithThrows[]>}
        highlightedDartId={selectedDartId}
      />

      <Card>
        <CardHeader><CardTitle>Biggest darts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rankedDarts.map(({ event, matchWpa, legWpa }, index) => {
            const before = event.before.scores[event.playerId] ?? 0;
            const after = event.busted ? before : Math.max(0, before - event.scored);
            return (
              <article
                className={`scroll-mt-4 rounded-lg border p-3 transition-colors target:border-primary target:bg-primary/5 ${selectedDartId === event.dartId ? 'border-cyan-400 bg-cyan-400/5 ring-1 ring-cyan-400/30' : ''}`}
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
                <div className="mt-3">
                  <Link
                    className="text-xs font-medium text-cyan-600 hover:underline dark:text-cyan-300"
                    href={`?dart=${encodeURIComponent(event.dartId)}#dart-${event.dartId}`}
                  >
                    {selectedDartId === event.dartId ? 'Selected across the report' : 'Select this dart across the report'}
                  </Link>
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
