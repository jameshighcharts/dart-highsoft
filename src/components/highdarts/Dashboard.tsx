'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Trophy } from 'lucide-react';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { apiRequest } from '@/lib/apiClient';
import {
  buildStandings,
  fixtureLabel,
  officeName,
  resultStats,
  type FixtureResult,
  type Snapshot,
  type Standing,
} from '@/lib/highdarts/standings';
import { HighdartsRules } from './Rules';

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRV-yUwdC1ht9XjeBuGf2oSQl7lx9U-VEJ09M611vZKLmDDxL9PB2h2d7JU3J7B2g/pubhtml?widget=true&headers=false';
const card = 'rounded-2xl border border-white/10 bg-card p-5 sm:p-6';
function Progress({ played, total }: { played: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Fixtures completed"
      aria-valuenow={played}
      aria-valuemin={0}
      aria-valuemax={total}
      className="h-1.5 overflow-hidden rounded-full bg-white/10"
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-400 transition-all"
        style={{ width: `${total ? (played / total) * 100 : 0}%` }}
      />
    </div>
  );
}
function FixtureCard({
  fixture: f,
  snapshot,
}: {
  fixture: FixtureResult;
  snapshot: Snapshot;
}) {
  const a =
    snapshot.players.find((p) => p.id === f.player_a_id)?.display_name ??
    f.player_a_name;
  const b =
    snapshot.players.find((p) => p.id === f.player_b_id)?.display_name ??
    f.player_b_name;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 py-4 first:border-0">
      <div>
        <p className="mb-1 text-xs text-muted-foreground">{fixtureLabel(f)}</p>
        <p className="text-sm font-semibold">
          {a} <span className="font-normal text-muted-foreground">vs</span> {b}
        </p>
      </div>
      {f.match_id ? (
        <Link
          className="text-sm text-cyan-300 hover:underline"
          href={`/match/${f.match_id}`}
        >
          {f.match?.ended_early
            ? 'Ended early · View match'
            : 'Match in progress'}{' '}
          <ArrowUpRight className="inline size-3" />
        </Link>
      ) : f.player_a_id && f.player_b_id ? (
        <Button asChild size="sm" variant="outline">
          <Link href={`/new?highdarts=${f.id}`}>Start this match</Link>
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">
          Awaiting player links
        </span>
      )}
    </div>
  );
}
function RankBadge({ row }: { row: Standing }) {
  if (row.tiedForFourth)
    return <span className="text-xs text-amber-300">Tied for 4th</span>;
  if (row.tiedForBye)
    return <span className="text-xs text-amber-300">Tied for bye</span>;
  if (!row.qualification) return null;
  const bye = row.qualification === 'bye';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${bye ? 'bg-amber-300/15 text-amber-200' : 'bg-cyan-300/10 text-cyan-200'}`}
        >
          {bye
            ? 'Bye'
            : row.qualification === 'bye-candidate'
              ? 'Bye?'
              : 'Play-off'}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {row.rank === 2
          ? 'The 2nd-place player with the best average across all offices gets the fourth bye.'
          : bye
            ? 'Office winners advance directly to the quarterfinal.'
            : 'Top four advance to the finals stage.'}
      </TooltipContent>
    </Tooltip>
  );
}
export function HighdartsDashboard({
  initial,
  isAdmin,
}: {
  initial: Snapshot | null;
  isAdmin: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [error, setError] = useState(
    initial ? '' : 'Highdarts is not available yet.',
  );
  const [myId, setMyId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false,
      inFlight = false;
    async function refresh() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const data = await apiRequest<Snapshot>('/api/highdarts', {
          method: 'GET',
        });
        if (!cancelled) {
          setSnapshot(data);
          setError('');
        }
      } catch {
        if (!cancelled)
          setError(
            'Results could not refresh. Showing the last available snapshot.',
          );
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    void apiRequest<{ player: { id: string } | null }>('/api/me', {
      method: 'GET',
    })
      .then((me) => {
        if (!cancelled) setMyId(me.player?.id ?? null);
      })
      .catch(() => {});
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const data = snapshot ? buildStandings(snapshot) : null;
  const yourFixtures =
    data?.offices
      .flatMap((o) => o.upcoming)
      .filter(
        (f) => myId && (f.player_a_id === myId || f.player_b_id === myId),
      ) ?? [];
  return (
    <TooltipProvider>
      <main className="mx-auto max-w-6xl space-y-7 px-4 py-6 pb-24 sm:px-6 sm:py-10">
        <header className="relative overflow-hidden rounded-3xl border border-violet-300/20 bg-gradient-to-br from-violet-400/15 via-card to-cyan-300/5 p-5 sm:p-8">
          <div className="flex items-center gap-4">
            <Image
              src="/game-icons/bengt.png"
              width={96}
              height={96}
              alt="Bengt"
              className="size-20 object-contain sm:size-24"
              priority
            />
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">
                The office championship
              </p>
              <h1 className="text-2xl font-black tracking-tight sm:text-4xl">
                Highdarts 2026
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Three offices. Twelve places in the finals.
              </p>
            </div>
            <div className="hidden sm:block">
              <HighdartsRules />
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 text-sm">
            <p>
              {data ? (
                <>
                  <strong>{data.played}</strong> / {data.total} group fixtures
                  completed
                </>
              ) : (
                'Tournament progress'
              )}
            </p>
            <div className="sm:hidden">
              <HighdartsRules />
            </div>
          </div>
          <div className="mt-3">
            <Progress played={data?.played ?? 0} total={data?.total ?? 76} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {data?.offices.map((o) => (
              <span
                key={o.office}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs"
              >
                {officeName(o.office)}{' '}
                <span className="ml-2 text-cyan-200">
                  {o.played}/{o.total}
                </span>
              </span>
            ))}
          </div>
        </header>
        {error && (
          <p
            role="status"
            className="rounded-xl border border-amber-300/20 p-4 text-sm text-amber-200"
          >
            {error}
          </p>
        )}
        {isAdmin && Boolean(data?.unresolved) && (
          <Link
            href="/admin"
            className="block text-xs text-muted-foreground hover:text-foreground"
          >
            {data?.unresolved} players not linked yet · Manage player links
          </Link>
        )}
        <Tabs defaultValue="progress">
          <TabsList className="mb-5 grid h-12 w-full grid-cols-3 sm:max-w-lg">
            <TabsTrigger value="progress">How&apos;s it going</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="sheet">Sheet</TabsTrigger>
          </TabsList>
          <TabsContent value="progress" className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {data?.offices.map((o) => (
                <section key={o.office} className={card}>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-bold">{officeName(o.office)}</h2>
                    <span className="text-sm text-muted-foreground">
                      {o.played} / {o.total}
                    </span>
                  </div>
                  <Progress played={o.played} total={o.total} />
                  <p className="mt-3 text-xs text-muted-foreground">
                    {o.total - o.played} fixtures remaining
                  </p>
                </section>
              ))}
            </div>
            {snapshot && yourFixtures.length > 0 && (
              <section className={`${card} border-cyan-300/20`}>
                <h2 className="mb-2 text-lg font-bold text-cyan-200">
                  Your matches
                </h2>
                {yourFixtures.map((f) => (
                  <FixtureCard key={f.id} fixture={f} snapshot={snapshot} />
                ))}
              </section>
            )}
            <section className={card}>
              <h2 className="mb-4 text-lg font-bold">Recent results</h2>
              {!data?.recent.length && (
                <p className="py-5 text-sm text-muted-foreground">
                  The first result is still to come. Pick a fixture below to get
                  things going.
                </p>
              )}
              {data?.recent.map((f) => {
                const a = resultStats(f, f.player_a_id),
                  b = resultStats(f, f.player_b_id);
                const aName =
                  snapshot?.players.find((p) => p.id === f.player_a_id)
                    ?.display_name ?? f.player_a_name;
                const bName =
                  snapshot?.players.find((p) => p.id === f.player_b_id)
                    ?.display_name ?? f.player_b_name;
                return (
                  <Link
                    href={`/match/${f.match_id}/report`}
                    key={f.id}
                    className="block border-t border-white/5 py-4 first:border-0 hover:text-cyan-200"
                  >
                    <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                      <span>{fixtureLabel(f)}</span>
                      <span>{f.match?.completed_at?.slice(0, 10)}</span>
                    </div>
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={
                          f.match?.winner_player_id === f.player_a_id
                            ? 'font-bold'
                            : ''
                        }
                      >
                        {aName}
                      </span>
                      <strong className="rounded-lg bg-white/5 px-3 py-1 text-lg tabular-nums">
                        {a.legs}–{b.legs}
                      </strong>
                      <span
                        className={
                          f.match?.winner_player_id === f.player_b_id
                            ? 'font-bold'
                            : ''
                        }
                      >
                        {bName}
                      </span>
                      <ArrowUpRight className="ml-auto size-4" />
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {f.match?.ended_early
                        ? 'Ended early · Excluded from standings'
                        : `Avg ${a.average.toFixed(2)} / ${b.average.toFixed(2)}`}
                    </p>
                  </Link>
                );
              })}
            </section>
            <section>
              <h2 className="mb-4 text-lg font-bold">Upcoming</h2>
              <div className="grid items-start gap-4 lg:grid-cols-3">
                {data?.offices.map((o) => (
                  <div className={card} key={o.office}>
                    <h3 className="mb-2 font-bold">{officeName(o.office)}</h3>
                    {snapshot &&
                      o.upcoming.map((f) => (
                        <FixtureCard
                          key={f.id}
                          fixture={f}
                          snapshot={snapshot}
                        />
                      ))}
                    {!o.upcoming.length && (
                      <p className="text-sm text-muted-foreground">
                        All fixtures complete.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </TabsContent>
          <TabsContent value="leaderboard" className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Current projections. Wins, then three-dart average. Cutoff ties
              need a play-off; leg difference does not settle them.
            </p>
            {data?.offices.map((o) => (
              <section key={o.office} className={`${card} !px-0`}>
                <h2 className="mb-4 px-5 text-xl font-bold">
                  {officeName(o.office)}
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full whitespace-nowrap text-left text-sm">
                    <caption className="sr-only">
                      {officeName(o.office)} standings
                    </caption>
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        {[
                          '#',
                          'Player',
                          'P',
                          'W',
                          'L',
                          'Legs +/−',
                          'Avg',
                          'Left',
                        ].map((h) => (
                          <th key={h} className="px-3 py-3 first:pl-5">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {o.table.map((row) => (
                        <tr
                          key={row.key}
                          className={`border-t border-white/5 ${row.player.id === myId ? 'bg-cyan-300/5' : ''}`}
                        >
                          <td className="py-3 pl-5 text-muted-foreground">
                            {row.rank}
                          </td>
                          <th className="p-3 font-medium">
                            <div className="flex items-center gap-3">
                              <PlayerAvatar player={row.player} />
                              <div>
                                <span className="block">
                                  {row.player.display_name}
                                </span>
                                <RankBadge row={row} />
                              </div>
                            </div>
                          </th>
                          <td className="p-3 tabular-nums">{row.played}</td>
                          <td className="p-3 font-bold tabular-nums text-cyan-200">
                            {row.wins}
                          </td>
                          <td className="p-3 tabular-nums">{row.losses}</td>
                          <td className="p-3 tabular-nums">
                            {row.legsFor} / {row.legsAgainst}{' '}
                            <span className="text-muted-foreground">
                              ({row.legDiff > 0 ? '+' : ''}
                              {row.legDiff})
                            </span>
                          </td>
                          <td className="p-3 font-semibold tabular-nums">
                            {row.average.toFixed(2)}
                          </td>
                          <td className="p-3 tabular-nums text-muted-foreground">
                            {row.remaining}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            <section
              className={`${card} bg-gradient-to-br from-violet-300/10 to-card`}
            >
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
                <Trophy className="size-5 text-amber-200" />
                Road to the finals
              </h2>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-amber-200">
                    Projected byes · {data?.byes.length ?? 0}/4
                  </h3>
                  <p className="text-sm leading-7">
                    {data?.byes.map((r) => r.player.display_name).join(' · ') ||
                      'Awaiting results'}
                  </p>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-cyan-200">
                    Projected play-off · {data?.playoff.length ?? 0}/8
                  </h3>
                  <p className="text-sm leading-7">
                    {data?.playoff
                      .map((r) => r.player.display_name)
                      .join(' · ') || 'Awaiting results'}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Tied places remain undecided. These projections update as
                results arrive.
              </p>
            </section>
          </TabsContent>
          <TabsContent value="sheet">
            <section className={card}>
              <a
                href={SHEET_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200"
              >
                Open in Google Sheets <ArrowUpRight className="size-4" />
              </a>
              <p className="my-3 text-sm text-muted-foreground">
                Sign into your Highsoft Google account in this browser to view
                the sheet. App results and standings come from matches played
                here.
              </p>
              <iframe
                src={SHEET_URL}
                title="Highdarts 2026 Google Sheet"
                loading="lazy"
                className="min-h-[70vh] w-full rounded-xl border bg-white"
              />
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </TooltipProvider>
  );
}
