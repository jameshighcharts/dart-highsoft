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
    </div>
  );
}
export function ProfileFixtures({
  playerId,
  title = "Your Highdarts 2026 schedule",
}: {
  playerId: string;
  title?: string;
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
