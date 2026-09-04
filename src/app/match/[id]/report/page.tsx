import { ArrowLeft, Crosshair, Trophy, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DartIQReportExplorer,
  type DartIQReportEvent,
} from '@/components/match/DartIQReportExplorer';
import { analyzeDartIQTimeline } from '@/lib/dartiq/insights';
import { createBehavioralOutcomeModel } from '@/lib/dartiq/model/outcomes';
import { reconstructDartIQTimeline, type DartIQDartEvent } from '@/lib/dartiq/replay';
import { loadMatchData } from '@/lib/match/loadMatchData';
import type { TurnWithThrows } from '@/lib/match/types';
import { loadFrozenDartIQEvidence } from '@/lib/server/dartiqEvidence';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

const SERIES_COLORS = ['#22c55e', '#38bdf8', '#f59e0b', '#f43f5e', '#a78bfa', '#14b8a6'];

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function points(value: number) {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? '+' : ''}${rounded}pp`;
}

function completedVisit(event: DartIQDartEvent) {
  return event.dartIndex >= 3 || event.busted || event.checkedOut;
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
  const reportTimeline: DartIQReportEvent[] = timeline.map((event) => ({
    dartId: event.dartId,
    legNumber: event.legNumber,
    playerId: event.playerId,
    dartIndex: event.dartIndex,
    segment: event.segment,
    scored: event.scored,
    busted: event.busted,
    checkedOut: event.checkedOut,
    scoreBefore: event.before.scores[event.playerId] ?? 0,
    matchWpa: event.matchWinProbabilityAdded[event.playerId] ?? 0,
    legWpa: event.legWinProbabilityAdded[event.playerId] ?? 0,
    matchConsequence: event.consequence.match,
    matchProbabilitiesAfter: Object.fromEntries(event.after.projections.map((player) => [
      player.id,
      player.matchWinProbability,
    ])),
  }));
  const initialProbabilities = Object.fromEntries(
    timeline[0]?.before.projections.map((player) => [player.id, player.matchWinProbability]) ?? []
  );
  const selectedDartId = timeline.some((event) => event.dartId === requestedDartId)
    ? requestedDartId
    : timeline.at(-1)?.dartId;
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

      <DartIQReportExplorer
        initialSelectedDartId={selectedDartId}
        initialProbabilities={initialProbabilities}
        names={Object.fromEntries(names)}
        players={data.players}
        playerIds={playerIds}
        timeline={reportTimeline}
        turnsByLeg={data.turnsByLeg as Record<string, TurnWithThrows[]>}
      >
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
      </DartIQReportExplorer>
    </main>
  );
}
