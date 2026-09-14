'use client';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/apiClient';
import {
  officeName,
  type Fixture,
  type Snapshot,
} from '@/lib/highdarts/standings';
import type { Player } from '@/lib/match/types';
import { Button } from '@/components/ui/button';

export function HighdartsAdminMapping() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiRequest<Snapshot>('/api/highdarts', { method: 'GET' }),
      apiRequest<{ players: (Player & { is_active: boolean })[] }>(
        '/api/admin/players',
        { method: 'GET' },
      ),
    ])
      .then(([data, list]) => {
        if (!cancelled) {
          setSnapshot(data);
          setPlayers(list.players.filter((p) => p.is_active));
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load Highdarts player links.');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function save(id: string, side: 'a' | 'b', playerId: string) {
    if (!playerId) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/admin/highdarts/fixtures/${id}`, {
        method: 'PATCH',
        body: { side, playerId },
      });
      setSnapshot(
        await apiRequest<Snapshot>('/api/highdarts', { method: 'GET' }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save player link');
    } finally {
      setBusy(false);
    }
  }
  const groups = new Map<
    string,
    { fixture: Fixture; side: 'a' | 'b'; name: string; numbers: number[] }
  >();
  for (const f of snapshot?.fixtures ?? []) {
    if (f.stage !== 'group') continue;
    for (const side of ['a', 'b'] as const) {
      if (f.match_id || f[side === 'a' ? 'player_a_id' : 'player_b_id'])
        continue;
      const name = f[side === 'a' ? 'player_a_name' : 'player_b_name'];
      const key = `${f.event_id}:${f.office}:${name}`;
      const group = groups.get(key);
      if (group) group.numbers.push(f.fixture_no);
      else groups.set(key, { fixture: f, side, name, numbers: [f.fixture_no] });
    }
  }
  return (
    <section className="mt-8 rounded-2xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Highdarts player links</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose the app player for each sheet name. Save links all their
        unstarted fixtures in that office.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {snapshot && !groups.size && (
        <p className="mt-4 text-sm text-muted-foreground">
          All fixture players are linked.
        </p>
      )}
      <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
        {[...groups].map(([key, { fixture, side, name, numbers }]) => (
          <form
            key={key}
            className="rounded-xl border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get('playerId');
              if (typeof value === 'string') void save(fixture.id, side, value);
            }}
          >
            <p className="mb-2 text-xs text-muted-foreground">
              {officeName(fixture.office)} · Fixtures {numbers.join(', ')}
            </p>
            <div className="flex items-end gap-2">
              <label className="min-w-0 flex-1 text-sm">
                {name}
                <select
                  required
                  name="playerId"
                  aria-label={`Link ${name}`}
                  className="mt-1 block h-10 w-full rounded-md border bg-background px-2"
                  disabled={busy}
                >
                  <option value="">Choose player</option>
                  {players.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={busy} size="sm">
                Save
              </Button>
            </div>
          </form>
        ))}
      </div>
    </section>
  );
}
