"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Play } from "lucide-react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/apiClient";
import {
  fixtureAvailability,
  countsForPlayer,
  isCompleted,
  resultStats,
  fixtureLabel,
  personalFixtures,
  tournamentNames,
  type FixtureResult,
  type Snapshot,
} from "@/lib/highdarts/standings";

export function TournamentPlayerName({
  playerId,
  name,
  snapshot,
  className = "",
}: {
  playerId: string | null;
  name: string;
  snapshot: Snapshot;
  className?: string;
}) {
  const fullName =
    snapshot.players.find((p) => p.id === playerId)?.display_name ?? name;
  const label = tournamentNames(snapshot)(playerId, name);
  return playerId && snapshot.players.some((p) => p.id === playerId) ? (
    <Link
      href={`/players/${playerId}`}
      title={fullName}
      className={`hover:text-cyan-200 hover:underline ${className}`}
    >
      {label}
    </Link>
  ) : (
    <span title={fullName} className={className}>
      {label}
    </span>
  );
}

export function FixtureCard({
  fixture: f,
  snapshot,
  showOffice = false,
}: {
  fixture: FixtureResult;
  snapshot: Snapshot;
  showOffice?: boolean;
}) {
  const unavailable = fixtureAvailability(f, snapshot);
  const a = snapshot.players.find((p) => p.id === f.player_a_id) ?? {
    display_name: f.player_a_name,
  };
  const b = snapshot.players.find((p) => p.id === f.player_b_id) ?? {
    display_name: f.player_b_name,
  };
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-4 py-4 last:border-0 sm:px-5">
      <span className="text-xs font-medium tabular-nums text-slate-500">
        #{f.fixture_no}
      </span>
      <div className="min-w-0">
        {showOffice && (
          <p className="mb-1.5 text-xs text-muted-foreground">
            {fixtureLabel(f)}
          </p>
        )}
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <PlayerAvatar player={a} size="sm" />
            <TournamentPlayerName
              playerId={f.player_a_id}
              name={f.player_a_name}
              snapshot={snapshot}
              className="truncate text-sm font-medium"
            />
          </div>
          <span className="hidden text-xs text-slate-500 sm:block">vs</span>
          <div className="flex min-w-0 items-center gap-2">
            <PlayerAvatar player={b} size="sm" />
            <TournamentPlayerName
              playerId={f.player_b_id}
              name={f.player_b_name}
              snapshot={snapshot}
              className="truncate text-sm font-medium"
            />
          </div>
        </div>
      </div>
      {f.match_id ? (
        <Link
          className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-cyan-300"
          href={`/match/${f.match_id}`}
        >
          {f.match?.completed_at || f.match?.ended_early
            ? "View match"
            : "Watch live"}
          <ArrowUpRight className="size-3" />
        </Link>
      ) : unavailable ? (
        <div className="max-w-36 text-right text-xs text-muted-foreground">
          <p>{unavailable.reason}</p>
          <Link
            href={unavailable.href}
            className="mt-1 inline-block py-2 text-cyan-300"
          >
            {unavailable.href === "/boards"
              ? "View board"
              : "View current game"}
          </Link>
        </div>
      ) : f.player_a_id && f.player_b_id ? (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="h-10 gap-1.5 border-cyan-300/20 text-cyan-200 hover:bg-cyan-300/10"
        >
          <Link
            href={`/new?highdarts=${f.id}`}
            aria-label={`Start ${a.display_name} vs ${b.display_name}, ${fixtureLabel(f)}`}
          >
            <Play className="size-3" />
            <span className="sm:hidden">Start</span>
            <span className="hidden sm:inline">Start this match</span>
          </Link>
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="text-xs text-muted-foreground">
              Not ready
            </span>
          </TooltipTrigger>
          <TooltipContent>
            An organiser needs to link these players before the match can start.
          </TooltipContent>
        </Tooltip>
      )}
      {(f.counts_for_a === false || f.counts_for_b === false) && (
        <div className="col-span-2 col-start-2">
          <FixtureCountingNote fixture={f} snapshot={snapshot} />
        </div>
      )}
    </div>
  );
}
export function ProfileFixtures({
  playerId,
  title = "Your Highdarts 2026 schedule",
  canEditCounting = false,
}: {
  playerId: string;
  title?: string;
  canEditCounting?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function refresh() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const data = await apiRequest<Snapshot>("/api/highdarts", {
          method: "GET",
        });
        if (!cancelled) {
          setSnapshot(data);
          setError("");
        }
      } catch {
        if (!cancelled) setError("Your tournament schedule could not refresh.");
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const fixtures = snapshot ? personalFixtures(snapshot, playerId) : [];
  const remaining = fixtures.filter(
    (f) => !f.match?.completed_at && !f.match?.ended_early,
  );
  const history = fixtures.filter(
    (f) => f.match?.completed_at || f.match?.ended_early,
  );
  return (
    <TooltipProvider>
      <section
        aria-label="Your Highdarts schedule"
        className="overflow-hidden rounded-2xl border border-cyan-300/20 bg-card"
      >
        <div className="space-y-2 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{title}</h2>
            <Link href="/bengt" className="text-sm text-cyan-300">
              Bengt <ArrowUpRight className="inline size-3" />
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Opponents and fixtures. Arrange a time together; fixture numbers are
            not booked times.
          </p>
          {error && (
            <p role="status" className="text-sm text-amber-200">
              {error}
            </p>
          )}
          {!snapshot && !error && <p role="status">Loading your schedule…</p>}
          {snapshot && !fixtures.length && (
            <p className="text-sm text-muted-foreground">
              No fixtures are linked to your player yet. Check Bengt or ask an
              organiser to link your tournament entry.
            </p>
          )}
          {fixtures.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {remaining.length} remaining · {history.length} finished
            </p>
          )}
        </div>
        {snapshot && (
          <GroupCountingChoice
            playerId={playerId}
            snapshot={snapshot}
            canEdit={canEditCounting}
            onRefresh={async () =>
              setSnapshot(
                await apiRequest<Snapshot>("/api/highdarts", { method: "GET" }),
              )
            }
          />
        )}
        {snapshot &&
          remaining.map((f) => (
            <FixtureCard
              key={f.id}
              fixture={f}
              snapshot={snapshot}
              showOffice
            />
          ))}
        {snapshot && history.length > 0 && (
          <details>
            <summary className="cursor-pointer px-5 py-4 text-sm">
              Finished matches ({history.length})
            </summary>
            {history.map((f) => (
              <FixtureCard
                key={f.id}
                fixture={f}
                snapshot={snapshot}
                showOffice
              />
            ))}
          </details>
        )}
      </section>
    </TooltipProvider>
  );
}

export function FixtureCountingNote({
  fixture,
  snapshot,
}: {
  fixture: FixtureResult;
  snapshot: Snapshot;
}) {
  const names = tournamentNames(snapshot);
  const excluded = [
    fixture.counts_for_a === false
      ? names(fixture.player_a_id, fixture.player_a_name)
      : null,
    fixture.counts_for_b === false
      ? names(fixture.player_b_id, fixture.player_b_name)
      : null,
  ].filter((name) => name !== null);
  return excluded.length ? (
    <p className="text-xs text-amber-200">
      Excluded from {excluded.join(" and ")}’s tournament results.
    </p>
  ) : null;
}

export function GroupCountingChoice({
  playerId,
  snapshot,
  canEdit,
  onRefresh,
}: {
  playerId: string;
  snapshot: Snapshot;
  canEdit: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<{
    choice: string;
    expected: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fixtures = personalFixtures(snapshot, playerId).filter(
    (f) => f.stage === "group",
  );
  if (fixtures.length !== 6) return null;
  const excluded = fixtures.find((f) => !countsForPlayer(f, playerId));
  const current = excluded?.id ?? null;
  const locked = snapshot.fixtures.some(
    (f) => f.event_id === fixtures[0].event_id && f.stage === "final",
  );
  const name = tournamentNames(snapshot)(playerId, "Player");
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/highdarts/counting", {
        method: "PUT",
        body: {
          eventId: fixtures[0].event_id,
          playerId,
          excludedFixtureId: draft.choice || null,
          expectedExcludedFixtureId: draft.expected,
        },
      });
      setDraft(null);
      try {
        await onRefresh();
      } catch {
        setError(
          "Choice saved, but the standings could not refresh. Reload to see it.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save the excluded result.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label={`${name} counted results`}
      className="space-y-2 py-3 first:pt-0 last:pb-0"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          <TournamentPlayerName
            playerId={playerId}
            name={name}
            snapshot={snapshot}
          />
        </h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Counting rule for ${name}`}
              className="text-xs text-muted-foreground underline decoration-dotted underline-offset-4"
            >
              5 of 6 count
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            Play all six. Exclude one from your wins, losses, legs and average.
            Your opponent keeps their result. Choose before the finals draw
            locks.
          </TooltipContent>
        </Tooltip>
      </div>
      {canEdit && !locked ? (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={`Excluded match for ${name}`}
            className="min-h-10 min-w-0 max-w-full flex-1 rounded-md border border-white/10 bg-background px-2 text-xs"
            disabled={busy}
            value={draft?.choice ?? current ?? ""}
            onChange={(e) =>
              setDraft({ choice: e.target.value, expected: current })
            }
          >
            <option value="">No match excluded yet</option>
            {fixtures.map((f) => {
              const opponent =
                f.player_a_id === playerId ? f.player_b_id : f.player_a_id;
              const opponentName =
                f.player_a_id === playerId ? f.player_b_name : f.player_a_name;
              const label = tournamentNames(snapshot)(opponent, opponentName);
              return (
                <option key={f.id} value={f.id}>
                  {fixtureLabel(f)} vs {label}
                  {isCompleted(f)
                    ? ` · ${f.match?.winner_player_id === playerId ? "Won" : "Lost"} · ${resultStats(f, playerId).average.toFixed(2)} AVG`
                    : " · Not finished"}
                </option>
              );
            })}
          </select>
          <Button
            size="sm"
            variant="outline"
            className="min-h-10 shrink-0"
            aria-label={busy ? "Saving choice" : "Save choice"}
            disabled={busy || !draft || (draft.choice || null) === current}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {excluded ? `${fixtureLabel(excluded)} excluded` : "Awaiting choice"}
          {locked && " · Finals draw locked"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
    </section>
  );
}
