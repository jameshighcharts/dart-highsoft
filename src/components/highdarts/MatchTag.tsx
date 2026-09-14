'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { apiRequest } from '@/lib/apiClient';
import {
  fixtureLabel,
  fixtureFormat,
  fixturesForPair,
  type Fixture,
  type Snapshot,
} from '@/lib/highdarts/standings';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MatchRecord, Player } from '@/lib/match/types';

export function HighdartsMatchTag({
  match,
  players,
  hasThrows,
  spectator,
  reload,
}: {
  match: MatchRecord;
  players: Player[];
  hasThrows: boolean;
  spectator: boolean;
  reload: () => Promise<void>;
}) {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chosenId, setChosenId] = useState('');
  useEffect(() => {
    let cancelled = false;
    const eligible =
      Boolean(match.highdarts_fixture_id) ||
      (!spectator &&
        !hasThrows &&
        players.length === 2 &&
        !match.ended_early &&
        !match.winner_player_id &&
        !match.tournament_match_id);
    if (!eligible) return;
    try {
      setDismissed(
        localStorage.getItem(`highdarts-friendly:${match.id}`) === 'yes',
      );
    } catch {
      setDismissed(false);
    }
    void apiRequest<Snapshot>('/api/highdarts', { method: 'GET' })
      .then((data) => {
        if (!cancelled) setFixtures(data.fixtures);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    match.id,
    match.highdarts_fixture_id,
    match.ended_early,
    match.winner_player_id,
    match.tournament_match_id,
    players.length,
    hasThrows,
    spectator,
  ]);
  const linked = fixtures.find((f) => f.id === match.highdarts_fixture_id);
  const available = fixturesForPair(
    fixtures,
    players.map((p) => p.id),
  ).filter((f) => !f.match_id);
  const candidate = available.find((f) => f.id === chosenId) ?? available[0];
  const format = fixtureFormat(candidate?.stage ?? 'group');
  const open =
    !spectator &&
    !dismissed &&
    !hasThrows &&
    !match.highdarts_fixture_id &&
    !match.ended_early &&
    !match.winner_player_id &&
    Boolean(candidate);
  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(`highdarts-friendly:${match.id}`, 'yes');
    } catch {
      /* A storage restriction should not prevent friendly play. */
    }
  }
  async function link() {
    if (!candidate) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/matches/${match.id}/highdarts`, {
        method: 'PATCH',
        body: { fixtureId: candidate.id },
      });
      await reload();
      setDismissed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not link the fixture');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {match.highdarts_fixture_id && (
        <div className="px-4 pt-3">
          <Link
            href="/bengt"
            className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1 text-xs font-semibold text-violet-200"
          >
            <Trophy className="size-3" />
            Highdarts 2026{linked ? ` · ${fixtureLabel(linked)}` : ''}
          </Link>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && !busy) dismiss();
        }}
      >
        <DialogContent
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Is this a Highdarts 2026 match?</DialogTitle>
            <DialogDescription>
              {candidate
                ? `${fixtureLabel(candidate)} · ${candidate.player_a_name} vs ${candidate.player_b_name}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This round uses {format.startScore},{' '}
            {format.finish.replace('_', ' ')}, first to two legs, with fair
            ending off.
          </p>
          {available.length > 1 && (
            <label className="text-sm">
              Fixture
              <select
                className="mt-2 block w-full rounded border bg-background p-2"
                value={candidate?.id}
                onChange={(e) => setChosenId(e.target.value)}
              >
                {available.map((f) => (
                  <option key={f.id} value={f.id}>
                    {fixtureLabel(f)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button disabled={busy} onClick={() => void link()}>
            {busy ? 'Linking…' : "Yes, it's a tournament match"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={dismiss}>
            No, just a friendly
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
