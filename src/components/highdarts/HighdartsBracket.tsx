'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { LockKeyhole, Pencil, Trophy, UnlockKeyhole } from 'lucide-react';
import { FixtureCard, TournamentPlayerName } from './Fixtures';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/apiClient';
import {
  buildStandings,
  fixtureFormat,
  fixtureAvailability,
  isCompleted,
  officeName,
  resultStats,
  stageName,
  type FixtureResult,
  type Snapshot,
} from '@/lib/highdarts/standings';
import {
  FINAL_STAGES,
  isFinalsStage,
  projectFinals,
  validateDraw,
  type DrawSelection,
  type Finalist,
} from '@/lib/highdarts/finals';

type Props = {
  snapshot: Snapshot;
  isAdmin: boolean;
  onRefresh: () => Promise<void>;
};
function Participant({
  person,
  winner,
  score,
  fallback,
  snapshot,
}: {
  person: Finalist | null;
  winner: boolean;
  score: number | null;
  fallback: string;
  snapshot: Snapshot;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 px-3 py-2.5 ${winner ? 'bg-lime-300/10 font-bold text-lime-200' : ''}`}
    >
      {person ? (
        <PlayerAvatar player={person.player} size="sm" />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-white/20 text-[10px] text-slate-500">
          ?
        </span>
      )}
      <div className="min-w-0 flex-1">
        <span
          className="block truncate text-xs"
          title={person?.player.display_name}
        >
          {person ? <TournamentPlayerName playerId={person.player.id} name={person.player.display_name} snapshot={snapshot} /> : 'TBD'}
        </span>
        <span className="mt-0.5 inline-block rounded bg-white/5 px-1 text-[9px] font-normal text-muted-foreground">
          {person ? officeName(person.office) : fallback}
        </span>
      </div>
      {score !== null && (
        <span className="text-base tabular-nums">{score}</span>
      )}
    </div>
  );
}
export function HighdartsTieControls({ snapshot, isAdmin, onRefresh }: Props) {
  const standings = useMemo(() => buildStandings(snapshot), [snapshot]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [choices, setChoices] = useState<Record<string, [string, string]>>({});
  if (!standings.played || !standings.ties.length) return null;
  async function create(context: string, players: [string, string]) {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/api/admin/highdarts/finals/tiebreak', {
        body: { context, playerIds: players },
      });
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create tie-break');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4">
      <h2 className="font-semibold text-amber-200">Places to decide</h2>
      {standings.ties.map((tie) => {
        const selected = choices[tie.context] ?? [
          tie.players[0]?.player.id ?? '',
          tie.players[1]?.player.id ?? '',
        ];
        const pending = snapshot.fixtures.filter(
          (f) =>
            f.stage === 'tiebreak' &&
            f.tie_context === tie.context &&
            !isCompleted(f),
        );
        return (
          <div
            key={tie.context}
            className="space-y-2 border-t border-white/5 pt-3"
          >
            <p className="text-sm font-semibold">{tie.label}</p>
            <p className="text-xs text-muted-foreground">
              {tie.players.map((r) => <TournamentPlayerName key={r.key} playerId={r.player.id} name={r.player.display_name} snapshot={snapshot} className="mr-2" />)}.{' '}
              {tie.places} {tie.places === 1 ? 'place' : 'places'} to decide.
            </p>
            {pending.map((f) => <FixtureCard key={f.id} fixture={f} snapshot={snapshot} showOffice />)}
            {isAdmin && !pending.length && (
              <div className="flex flex-wrap items-center gap-2">
                {tie.players.length > 2 &&
                  [0, 1].map((side) => (
                    <select
                      key={side}
                      aria-label={`${tie.label} player ${side + 1}`}
                      className="max-w-full rounded border bg-background p-2 text-xs"
                      value={selected[side]}
                      onChange={(e) => {
                        const next: [string, string] = [
                          selected[0],
                          selected[1],
                        ];
                        next[side] = e.target.value;
                        setChoices({ ...choices, [tie.context]: next });
                      }}
                    >
                      {tie.players.map((r) => (
                        <option key={r.key} value={r.player.id}>
                          {r.player.display_name}
                        </option>
                      ))}
                    </select>
                  ))}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    busy ||
                    !tie.ready ||
                    !selected[0] ||
                    !selected[1] ||
                    selected[0] === selected[1]
                  }
                  onClick={() =>
                    void create(tie.context, [selected[0], selected[1]])
                  }
                >
                  Create tie-break
                </Button>
                {!tie.ready && (
                  <span className="text-xs text-muted-foreground">
                    Available after the group games finish.
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
export function HighdartsBracket({ snapshot, isAdmin, onRefresh }: Props) {
  const standings = useMemo(() => buildStandings(snapshot), [snapshot]);
  const projection = useMemo(() => projectFinals(standings), [standings]);
  const live = snapshot.fixtures.filter((f) => isFinalsStage(f.stage));
  const locked = live.length > 0;
  const [draft, setDraft] = useState<DrawSelection | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const validation = draft ? validateDraw(standings, draft) : null;
  const games = validation?.ok ? validation.games : projection.games;
  const finalist = (id: string | null): Finalist | null => {
    if (!id) return null;
    const person = standings.offices
      .flatMap((o) =>
        o.table.map((r) => ({
          player: r.player,
          office: o.office,
          rank: r.rank,
        })),
      )
      .find((p) => p.player.id === id);
    return person ?? null;
  };
  async function save(method: 'POST' | 'DELETE') {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/api/admin/highdarts/finals/draw', {
        method,
        ...(method === 'POST' ? { body: draft ?? projection.selection } : {}),
      });
      setDraft(null);
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update draw');
    } finally {
      setBusy(false);
    }
  }
  const cards = locked
    ? live.map((f) => ({
        key: `${f.stage}-${f.fixture_no}`,
        stage: f.stage,
        position: f.fixture_no,
        a: finalist(f.player_a_id),
        b: finalist(f.player_b_id),
        fixture: f,
      }))
    : games.map((g) => ({ ...g, fixture: null }));
  const tieFixtures = snapshot.fixtures.filter((f) => f.stage === 'tiebreak');
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-300/15 bg-violet-300/5 p-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Trophy className="size-4 text-amber-200" />
            {locked
              ? 'The finals draw'
              : 'Projected from current standings — final draw happens when the group stage is complete'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {locked
              ? 'Winners advance automatically. Best of three in every round.'
              : 'Unresolved places stay TBD. Four byes, eight play-off players, one champion.'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            {locked ? (
              <Button
                variant="outline"
                size="sm"
                disabled={
                  busy ||
                  live.some((f) => isCompleted(f) || f.match?.ended_early)
                }
                onClick={() => void save('DELETE')}
              >
                <UnlockKeyhole className="mr-2 size-3.5" />
                Unlock draw
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!projection.ready || busy}
                  onClick={() => setDraft(draft ? null : projection.selection)}
                >
                  <Pencil className="mr-2 size-3.5" />
                  {draft ? 'Cancel edits' : 'Edit pairings'}
                </Button>
                <Button
                  size="sm"
                  disabled={
                    !projection.ready ||
                    busy ||
                    (validation !== null && !validation.ok)
                  }
                  onClick={() => void save('POST')}
                >
                  <LockKeyhole className="mr-2 size-3.5" />
                  {busy ? 'Saving…' : 'Lock the draw'}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {draft && (
        <section className="rounded-xl border p-4">
          <h2 className="mb-2 text-sm font-semibold">Edit the draw</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Play-off 1 feeds quarterfinal 1, and so on. Quarterfinals 1–2 are
            the upper half; 3–4 are the lower half. Each player must appear
            once.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {draft.playoffs.map((pair, i) => (
              <div
                key={i}
                className="space-y-2 rounded-lg border border-white/10 p-3"
              >
                <p className="text-xs font-semibold">Quarterfinal {i + 1}</p>
                <select
                  aria-label={`Quarterfinal ${i + 1} bye`}
                  className="w-full rounded border bg-background p-2 text-xs"
                  value={draft.byes[i]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      byes: draft.byes.map((id, j) =>
                        j === i ? e.target.value : id,
                      ),
                    })
                  }
                >
                  {projection.byes.map((p) => (
                    <option key={p.player.id} value={p.player.id}>
                      {p.player.display_name} · {officeName(p.office)} · Bye
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  vs winner of play-off {i + 1}
                </p>
                {pair.map((id, side) => (
                  <select
                    key={side}
                    aria-label={`Play-off ${i + 1} player ${side + 1}`}
                    className="w-full rounded border bg-background p-2 text-xs"
                    value={id}
                    onChange={(e) => {
                      const pairs = draft.playoffs.map(
                        ([a, b], j): [string, string] =>
                          j === i
                            ? side === 0
                              ? [e.target.value, b]
                              : [a, e.target.value]
                            : [a, b],
                      );
                      setDraft({ ...draft, playoffs: pairs });
                    }}
                  >
                    {projection.eligible
                      .filter(
                        (p) =>
                          !projection.byes.some(
                            (b) => b.player.id === p.player.id,
                          ),
                      )
                      .map((p) => (
                        <option key={p.player.id} value={p.player.id}>
                          {p.player.display_name} · {officeName(p.office)} #
                          {p.rank}
                        </option>
                      ))}
                  </select>
                ))}
              </div>
            ))}
          </div>
          {validation && !validation.ok && (
            <p role="status" className="mt-3 text-sm text-amber-200">
              {validation.error}
            </p>
          )}
        </section>
      )}
      <div
        className="grid gap-6 lg:grid-cols-4 lg:gap-8"
        aria-label="Finals bracket"
      >
        {FINAL_STAGES.map((stage, round) => (
          <section key={stage} className="min-w-0">
            <h2 className="mb-4 text-sm font-semibold">
              {stageName(stage)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {[8, 8, 4, 2][round]} players
              </span>
            </h2>
            <div className="relative grid gap-4 lg:h-[760px] lg:grid-rows-8">
              {round < 3 && (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 32 760"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute left-full top-0 hidden h-full w-8 overflow-visible text-white/20 lg:block"
                >
                  {(round < 2 ? [95, 285, 475, 665] : [190, 570]).map(
                    (y, i) => {
                      const to =
                        round === 0
                          ? y
                          : round === 1
                            ? i < 2
                              ? 190
                              : 570
                            : 380;
                      return (
                        <path
                          key={y}
                          d={`M 0 ${y} H 16 V ${to} H 32`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1"
                        />
                      );
                    },
                  )}
                </svg>
              )}
              {cards
                .filter((g) => g.stage === stage)
                .sort((a, b) => a.position - b.position)
                .map((g) => {
                  const f = g.fixture;
                  const format = fixtureFormat(g.stage);
                  const row =
                    stage === 'playoff' || stage === 'quarterfinal'
                      ? g.position * 2 - 1
                      : stage === 'semifinal'
                        ? g.position * 4 - 2
                        : 4;
                  return (
                    <article
                      key={g.key}
                      className={`relative my-auto rounded-xl border bg-card ${locked ? 'border-white/15' : 'border-dashed border-white/15 opacity-70'} ${['', 'lg:row-start-1', 'lg:row-start-2', 'lg:row-start-3', 'lg:row-start-4', 'lg:row-start-5', 'lg:row-start-6', 'lg:row-start-7'][row]} lg:row-span-2`}
                    >
                      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2 text-[10px] text-muted-foreground">
                        <span>
                          {stageName(stage)} {g.position}
                        </span>
                        {stage === 'quarterfinal' && (
                          <span className="text-amber-200">Bye + winner</span>
                        )}
                      </div>
                      <Participant
                        snapshot={snapshot}
                        person={g.a}
                        winner={Boolean(
                          f &&
                          f.player_a_id &&
                          f.match?.winner_player_id === f.player_a_id &&
                          isCompleted(f),
                        )}
                        score={
                          f?.match ? resultStats(f, f.player_a_id).legs : null
                        }
                        fallback={
                          stage === 'quarterfinal'
                            ? 'Bye'
                            : stage === 'semifinal'
                              ? `Winner QF ${g.position * 2 - 1}`
                              : stage === 'final'
                                ? 'Winner SF 1'
                                : 'Awaiting standings'
                        }
                      />
                      <div className="mx-3 border-t border-white/5" />
                      <Participant
                        snapshot={snapshot}
                        person={g.b}
                        winner={Boolean(
                          f &&
                          f.player_b_id &&
                          f.match?.winner_player_id === f.player_b_id &&
                          isCompleted(f),
                        )}
                        score={
                          f?.match ? resultStats(f, f.player_b_id).legs : null
                        }
                        fallback={
                          stage === 'quarterfinal'
                            ? `Winner play-off ${g.position}`
                            : stage === 'semifinal'
                              ? `Winner QF ${g.position * 2}`
                              : stage === 'final'
                                ? 'Winner SF 2'
                                : 'Awaiting standings'
                        }
                      />
                      <div className="border-t border-white/5 px-3 py-2 text-[10px] text-muted-foreground">
                        {format.startScore}{' '}
                        {format.finish === 'single_out'
                          ? 'straight out'
                          : 'double out'}{' '}
                        · Best of 3
                      </div>
                      {f && <MatchAction fixture={f} snapshot={snapshot} />}
                    </article>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
      <HighdartsTieControls
        snapshot={snapshot}
        isAdmin={isAdmin}
        onRefresh={onRefresh}
      />
      {tieFixtures.length > 0 && (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">Tie-break matches</h2>
          {tieFixtures.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3"
            >
              <p className="text-sm">
                <TournamentPlayerName playerId={f.player_a_id} name={f.player_a_name} snapshot={snapshot} /> vs <TournamentPlayerName playerId={f.player_b_id} name={f.player_b_name} snapshot={snapshot} />
                {isCompleted(f) && (
                  <strong className="ml-2">
                    {resultStats(f, f.player_a_id).legs}–
                    {resultStats(f, f.player_b_id).legs}
                  </strong>
                )}
              </p>
              <MatchAction fixture={f} snapshot={snapshot} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
function MatchAction({ fixture: f, snapshot }: { fixture: FixtureResult; snapshot: Snapshot }) {
  const unavailable = fixtureAvailability(f, snapshot);
  return f.match_id ? (
    <Link
      className="block border-t border-white/5 px-3 py-2 text-xs text-cyan-200"
      href={`/match/${f.match_id}${isCompleted(f) ? '/report' : ''}`}
    >
      {isCompleted(f)
        ? 'Match report'
        : f.match?.ended_early
          ? 'Ended early'
          : 'Open match'}{' '}
      ↗
    </Link>
  ) : unavailable ? (
    <Link href={unavailable.href} className="block px-3 py-2 text-xs text-amber-200">{unavailable.reason}</Link>
  ) : f.player_a_id && f.player_b_id ? (
    <Link
      className="block border-t border-white/5 px-3 py-2 text-xs font-semibold text-cyan-200"
      href={`/new?highdarts=${f.id}`}
    >
      Start this match ↗
    </Link>
  ) : null;
}
