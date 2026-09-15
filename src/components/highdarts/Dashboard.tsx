'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
  Trophy,
  Flame,
} from 'lucide-react';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  tournamentActivity,
  normalizeName,
  personalFixtures,
  type Office,
  fixtureLabel,
  officeName,
  resultStats,
  type Snapshot,
  type Standing,
} from '@/lib/highdarts/standings';
import { FixtureCard, FixtureCountingNote, GroupCountingChoice, TournamentPlayerName } from './Fixtures';
import { HighdartsCountingRules, HighdartsRules } from './Rules';
import { HighdartsBracket, HighdartsTieControls } from './HighdartsBracket';

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRV-yUwdC1ht9XjeBuGf2oSQl7lx9U-VEJ09M611vZKLmDDxL9PB2h2d7JU3J7B2g/pubhtml?widget=true&headers=false';
const card = 'rounded-2xl border border-white/10 bg-card p-5 sm:p-6';
function Progress({
  played,
  total,
  today = 0,
  label = 'Fixtures completed',
}: {
  played: number;
  total: number;
  today?: number;
  label?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={played}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuetext={`${played} of ${total} played, ${today} today`}
      className="flex h-2.5 overflow-hidden rounded-full bg-white/10"
    >
      <div
        className="h-full bg-cyan-300 transition-all"
        style={{
          width: `${total ? (Math.max(0, played - today) / total) * 100 : 0}%`,
        }}
      />
      <div
        className="h-full bg-lime-300 transition-all"
        style={{ width: `${total ? (today / total) * 100 : 0}%` }}
      />
    </div>
  );
}
const FIXTURES_PER_PAGE = 6;
function RankBadge({ row, complete }: { row: Standing; complete: boolean }) {
  const status = row.needsDiscard ? 'Choose 1 to exclude' : !row.played
    ? 'Not started'
    : row.tiedForFourth || row.tiedForBye
      ? 'Tie-break'
      : row.qualification === 'bye'
        ? 'Bye'
        : row.qualification === 'bye-candidate'
          ? 'Bye?'
          : row.qualification === 'playoff'
            ? 'Play-off'
            : complete
              ? 'Out'
              : 'Group stage';
  const color =
    status === 'Bye'
      ? 'bg-amber-300/15 text-amber-200'
      : status === 'Tie-break'
        ? 'bg-orange-300/15 text-orange-200'
        : status === 'Play-off' || status === 'Bye?'
          ? 'bg-cyan-300/10 text-cyan-200'
          : 'bg-white/5 text-slate-400';
  const explanation = row.needsDiscard ? 'Six fixtures are scheduled. Choose one to exclude before qualification is finalized.' : !row.played
    ? 'No completed tournament matches yet.'
    : row.tiedForFourth
      ? 'Fourth place is tied on wins and average. A tie-break decides who advances.'
      : row.tiedForBye
        ? 'Second-place averages are tied. A tie-break decides the fourth bye.'
        : row.rank === 2 && row.played
          ? 'The second-place player with the best average across all three offices earns the fourth bye.'
          : status === 'Bye'
            ? 'Office winners advance directly to the quarterfinal.'
            : status === 'Play-off'
              ? 'Currently projected to reach the play-off round.'
              : status === 'Out'
                ? 'All group matches played. Currently outside the top four.'
                : status === 'Not started'
                  ? 'No completed tournament matches yet.'
                  : 'Outside the current top four, with group matches still to play.';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={`mt-1 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] font-medium ${color}`}
        >
          {status}
        </span>
      </TooltipTrigger>
      <TooltipContent>{explanation}</TooltipContent>
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
  const [office, setOffice] = useState<Office>('bergen');
  const [search, setSearch] = useState('');
  const [fixturePage, setFixturePage] = useState(0);
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
  const activity = tournamentActivity(snapshot?.fixtures ?? []);
  const byes =
    data?.byes.filter((r) => r.played && !r.tiedForFourth && !r.tiedForBye) ??
    [];
  const playoff =
    data?.playoff.filter(
      (r) => r.played && !r.tiedForFourth && !r.tiedForBye,
    ) ?? [];
  const refreshSnapshot = async () =>
    setSnapshot(
      await apiRequest<Snapshot>('/api/highdarts', { method: 'GET' }),
    );
  const yourFixtures = snapshot && myId
    ? personalFixtures(snapshot, myId).filter((f) => !f.match?.completed_at && !f.match?.ended_early)
    : [];
  const selectedOffice = data?.offices.find((o) => o.office === office);
  const query = normalizeName(search);
  const filteredFixtures =
    selectedOffice?.upcoming.filter((f) =>
      normalizeName(
        [
          f.player_a_name,
          f.player_b_name,
          snapshot?.players.find((p) => p.id === f.player_a_id)?.display_name ??
            '',
          snapshot?.players.find((p) => p.id === f.player_b_id)?.display_name ??
            '',
        ].join(' '),
      ).includes(query),
    ) ?? [];
  const lastPage = Math.max(
    0,
    Math.ceil(filteredFixtures.length / FIXTURES_PER_PAGE) - 1,
  );
  const page = Math.min(fixturePage, lastPage);
  const visibleFixtures = filteredFixtures.slice(
    page * FIXTURES_PER_PAGE,
    (page + 1) * FIXTURES_PER_PAGE,
  );
  return (
    <TooltipProvider>
      <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 pb-24 sm:px-6 sm:py-8">
        <header className="rounded-2xl border border-violet-300/15 bg-gradient-to-r from-violet-400/10 via-card to-card p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              <Image
                src="/game-icons/bengt.png"
                width={64}
                height={64}
                alt="Bengt"
                className="size-12 shrink-0 object-contain sm:size-16"
                priority
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 sm:gap-3">
                  <h1 className="text-xl font-black tracking-tight sm:text-3xl">
                    Highdarts 2026
                  </h1>
                  <HighdartsRules />
                </div>
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                  Three offices. Twelve places in the finals.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-[1fr_auto] items-end gap-4">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Group games played
              </p>
              <p className="flex items-baseline gap-2 tabular-nums">
                <strong className="text-5xl font-black tracking-tight sm:text-6xl">
                  {data?.played ?? 0}
                </strong>
                <span className="text-xl text-slate-500">
                  / {data?.total ?? 76}
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-lime-300/15 bg-lime-300/5 px-4 py-3 text-right">
              <p className="flex items-center justify-end gap-1.5 text-xs text-lime-200">
                <Flame className="size-3.5" />
                Today
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-lime-200">
                {activity.today}
              </p>
              <p className="text-[10px] text-muted-foreground">
                tournament games
              </p>
            </div>
          </div>
          <div className="mb-2 mt-5 flex justify-between text-xs text-muted-foreground">
            <span>
              {Math.round(((data?.played ?? 0) / (data?.total || 76)) * 100)}%
              complete
            </span>
            <span>{(data?.total ?? 76) - (data?.played ?? 0)} to go</span>
          </div>
          <Progress
            played={data?.played ?? 0}
            total={data?.total ?? 76}
            today={activity.groupToday}
          />
          <div className="mt-3 flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-cyan-300" />
              Before today
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-lime-300" />
              {activity.groupToday} group games today
            </span>
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
        <Tabs defaultValue="progress">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <TabsList className="grid h-12 w-full grid-cols-[1.5fr_1fr_1fr_.8fr] sm:w-[540px]">
              <TabsTrigger value="progress">How&apos;s it going</TabsTrigger>
              <TabsTrigger value="leaderboard">Tabell</TabsTrigger>
              <TabsTrigger value="finals">Sluttspill</TabsTrigger>
              <TabsTrigger value="sheet">Sheet</TabsTrigger>
            </TabsList>
            {isAdmin && Boolean(data?.unresolved) && (
              <Link
                href="/admin"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Link {data?.unresolved} players{' '}
                <ArrowUpRight className="inline size-3" />
              </Link>
            )}
          </div>
          <TabsContent value="progress" className="space-y-5">
            <div
              className="grid grid-cols-3 gap-2 sm:gap-4"
              aria-label="Office progress"
            >
              {data?.offices.map((o) => (
                <button
                  key={o.office}
                  onClick={() => {
                    setOffice(o.office);
                    setFixturePage(0);
                  }}
                  className={`rounded-xl border p-3 text-left sm:p-4 ${office === o.office ? 'border-cyan-300/30 bg-cyan-300/5' : 'border-white/10 bg-card'}`}
                >
                  <span className="text-xs font-medium sm:text-sm">
                    {officeName(o.office)}
                  </span>
                  <p className="mb-3 mt-2 tabular-nums">
                    <strong className="text-2xl font-bold">{o.played}</strong>
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      / {o.total}
                    </span>
                  </p>
                  <Progress
                    played={o.played}
                    total={o.total}
                    today={
                      tournamentActivity(
                        snapshot?.fixtures.filter(
                          (f) => f.office === o.office,
                        ) ?? [],
                      ).groupToday
                    }
                    label={`${officeName(o.office)} completed`}
                  />
                </button>
              ))}
            </div>
            {snapshot && yourFixtures.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.03]">
                <h2 className="px-5 pt-4 text-sm font-semibold text-cyan-200">
                  Your matches
                </h2>
                {yourFixtures.map((f) => (
                  <FixtureCard
                    key={f.id}
                    fixture={f}
                    snapshot={snapshot}
                    showOffice
                  />
                ))}
              </section>
            )}
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
              <section
                className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-card"
                aria-label="Upcoming fixtures"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
                  <h2 className="font-semibold">Upcoming</h2>
                  <div className="relative w-full sm:w-60">
                    <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
                    <Input
                      aria-label="Search fixtures"
                      placeholder="Search players"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setFixturePage(0);
                      }}
                      className="h-10 border-white/10 bg-white/[0.02] pl-9"
                    />
                  </div>
                </div>
                <div
                  role="group"
                  aria-label="Fixture office"
                  className="grid grid-cols-3 border-y border-white/5 bg-white/[0.02]"
                >
                  {data?.offices.map((o) => (
                    <button
                      key={o.office}
                      type="button"
                      aria-label={officeName(o.office)}
                      aria-pressed={office === o.office}
                      onClick={() => {
                        setOffice(o.office);
                        setFixturePage(0);
                      }}
                      className={`border-b-2 px-2 py-3 text-sm transition-colors ${office === o.office ? 'border-cyan-300 bg-cyan-300/5 font-semibold text-cyan-200' : 'border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground'}`}
                    >
                      {officeName(o.office)}
                      <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                        {o.played} / {o.total} played
                      </span>
                    </button>
                  ))}
                </div>
                {snapshot &&
                  visibleFixtures.map((f) => (
                    <FixtureCard key={f.id} fixture={f} snapshot={snapshot} />
                  ))}
                {!visibleFixtures.length && (
                  <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                    {query
                      ? 'No fixtures match this search.'
                      : 'No remaining fixtures for this office.'}
                  </p>
                )}
                {filteredFixtures.length > 0 && (
                  <div className="flex items-center justify-between border-t border-white/5 px-4 py-3 sm:px-5">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {page * FIXTURES_PER_PAGE + 1}–
                      {Math.min(
                        (page + 1) * FIXTURES_PER_PAGE,
                        filteredFixtures.length,
                      )}{' '}
                      of {filteredFixtures.length} fixtures
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Previous fixtures"
                        className="size-9"
                        disabled={page === 0}
                        onClick={() => setFixturePage(page - 1)}
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Next fixtures"
                        className="size-9"
                        disabled={page === lastPage}
                        onClick={() => setFixturePage(page + 1)}
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </section>
              <section className="min-w-0 rounded-2xl border border-white/10 bg-card p-4 sm:p-5">
                <h2 className="mb-4 font-semibold">Recent results</h2>
                {!data?.recent.length && (
                  <div className="rounded-xl bg-white/[0.02] px-4 py-8 text-center">
                    <Trophy className="mx-auto mb-3 size-6 text-slate-600" />
                    <p className="text-sm font-medium">No results yet</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Completed tournament matches will appear here.
                    </p>
                  </div>
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
                    <div
                      key={f.id}
                      className="block border-t border-white/5 py-4 first:border-0 hover:text-cyan-200"
                    >
                      <div className="mb-2 flex justify-between text-[11px] text-muted-foreground">
                        <span>{fixtureLabel(f)}</span>
                        <span>{f.match?.completed_at?.slice(0, 10)}</span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-sm">
                        <span
                          className={
                            f.match?.winner_player_id === f.player_a_id
                              ? 'font-bold'
                              : ''
                          }
                        >
                          {snapshot && <TournamentPlayerName playerId={f.player_a_id} name={aName} snapshot={snapshot} />}
                        </span>
                        <span className="tabular-nums">{a.legs}</span>
                        <span
                          className={
                            f.match?.winner_player_id === f.player_b_id
                              ? 'font-bold'
                              : ''
                          }
                        >
                          {snapshot && <TournamentPlayerName playerId={f.player_b_id} name={bName} snapshot={snapshot} />}
                        </span>
                        <span className="tabular-nums">{b.legs}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        {f.match?.ended_early ? (
                          'Ended early · Excluded from standings'
                        ) : (
                          <>
                            <span className="rounded-full bg-white/5 px-2 py-1">
                              {aName.split(/\s+/)[0]} · {a.average.toFixed(2)}{' '}
                              avg
                            </span>
                            <span className="rounded-full bg-white/5 px-2 py-1">
                              {bName.split(/\s+/)[0]} · {b.average.toFixed(2)}{' '}
                              avg
                            </span>
                          </>
                        )}
                      </div>
                      {snapshot && <FixtureCountingNote fixture={f} snapshot={snapshot} />}
                      <Link href={`/match/${f.match_id}/report`} className="mt-3 inline-block text-xs text-cyan-300">View result</Link>
                    </div>
                  );
                })}
              </section>
            </div>
          </TabsContent>
          <TabsContent value="leaderboard" className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Current projections. Wins, then three-dart average. Cutoff ties
              need a play-off; leg difference does not settle them.
            </p>
            <div
              className="grid items-start gap-4 lg:grid-cols-3"
              aria-label="Office leaderboards"
            >
              {data?.offices.map((o) => (
                <div key={o.office} className="min-w-0 space-y-4">
                  <section
                    className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-card"
                  >
                    <div className="flex items-center justify-between border-b border-white/5 px-4 py-4">
                      <h2 className="text-lg font-bold">
                        {officeName(o.office)}
                      </h2>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {o.played} / {o.total} played
                      </span>
                    </div>
                    <table className="w-full table-fixed text-left text-xs">
                      <caption className="sr-only">
                        {officeName(o.office)} standings
                      </caption>
                      <colgroup>
                        <col className="w-7" />
                        <col />
                        <col className="w-7" />
                        <col className="w-7" />
                        <col className="w-12" />
                        <col className="w-8" />
                      </colgroup>
                      <thead className="bg-white/[0.02] text-[10px] text-muted-foreground">
                        <tr>
                          {['#', 'Player', 'W', 'L', 'AVG', 'Left'].map((h) => (
                            <th
                              key={h}
                              className={`py-2.5 font-medium ${h === '#' ? 'pl-3' : h === 'Player' ? 'pl-1' : 'text-center'}`}
                            >
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
                            <td className="py-3 pl-3 text-slate-500">
                              {row.rank}
                            </td>
                            <th
                              scope="row"
                              className="py-3 pl-1 pr-2 font-medium"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="inline-flex shrink-0">
                                  <PlayerAvatar player={row.player} size="sm" />
                                </span>
                                <div className="min-w-0">
                                  <span
                                    className="block truncate leading-4"
                                    title={row.player.display_name}
                                  >
                                    {snapshot && <TournamentPlayerName playerId={row.player.id} name={row.player.display_name} snapshot={snapshot} />}
                                  </span>
                                  {row.excluded > 0 && <span className="mt-1 block text-[9px] text-amber-200">{row.excluded} excluded</span>}
                                  <RankBadge
                                    row={row}
                                    complete={o.played === o.total}
                                  />
                                </div>
                              </div>
                            </th>
                            <td className="text-center font-bold tabular-nums text-cyan-200">
                              {row.wins}
                            </td>
                            <td className="text-center tabular-nums text-muted-foreground">
                              {row.losses}
                            </td>
                            <td className="text-center font-semibold tabular-nums">
                              {row.average.toFixed(2)}
                            </td>
                            <td className="text-center tabular-nums text-muted-foreground">
                              {row.remaining}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                  {o.office === 'sogndal' && snapshot && (
                    <section aria-label="Counting matches" className="rounded-2xl border border-white/10 bg-card px-4 py-3">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold">Counting matches</h2>
                        <HighdartsCountingRules />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">Six played, five count. Exclusions apply only to that player.</p>
                      <div className="mt-3 divide-y divide-white/5">
                        {data.offices.flatMap((office) => office.table.filter((row) => row.scheduled === 6 && row.player.id)).map((row) => (
                          <GroupCountingChoice key={row.key} playerId={row.player.id} snapshot={snapshot} canEdit={isAdmin || row.player.id === myId} onRefresh={refreshSnapshot} />
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ))}
            </div>
            {snapshot && (
              <HighdartsTieControls
                snapshot={snapshot}
                isAdmin={isAdmin}
                onRefresh={refreshSnapshot}
              />
            )}
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
                    Projected byes · {byes.length}/4
                  </h3>
                  <p className="text-sm leading-7">
                    {data?.played && byes.length && snapshot
                      ? byes.map((r) => <TournamentPlayerName key={r.key} playerId={r.player.id} name={r.player.display_name} snapshot={snapshot} className="mr-3 inline-block" />)
                      : 'Awaiting results'}
                  </p>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-cyan-200">
                    Projected play-off · {playoff.length}/8
                  </h3>
                  <p className="text-sm leading-7">
                    {data?.played && playoff.length && snapshot
                      ? playoff.map((r) => <TournamentPlayerName key={r.key} playerId={r.player.id} name={r.player.display_name} snapshot={snapshot} className="mr-3 inline-block" />)
                      : 'Awaiting results'}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Tied places remain undecided. These projections update as
                results arrive.
              </p>
            </section>
          </TabsContent>
          <TabsContent value="finals">
            {snapshot && (
              <HighdartsBracket
                snapshot={snapshot}
                isAdmin={isAdmin}
                onRefresh={refreshSnapshot}
              />
            )}
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
                className="min-h-[70vh] w-full rounded-xl border bg-white [filter:invert(0.9)_hue-rotate(180deg)]"
              />
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </TooltipProvider>
  );
}
