'use client';

import { useEffect, useState } from 'react';

import type { AdminPlayer, AdminPlayersResponse } from '@/app/api/admin/players/route';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/lib/apiClient';
import { formatNicknames } from '@/utils/nicknames';

type NicknamePlayer = Pick<AdminPlayer, 'id' | 'display_name' | 'nicknames'>;

export function AdminNicknameEditor({ onSaved }: { onSaved: (player: NicknamePlayer) => void }) {
  const [players, setPlayers] = useState<NicknamePlayer[]>([]);
  const [playerId, setPlayerId] = useState('');
  const [nicknames, setNicknames] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const player = players.find((candidate) => candidate.id === playerId);

  useEffect(() => {
    let cancelled = false;
    apiRequest<AdminPlayersResponse>('/api/admin/players', { method: 'GET' })
      .then((data) => { if (!cancelled) setPlayers(data.players); })
      .catch((error: unknown) => {
        if (!cancelled) setError(error instanceof Error ? error.message : 'Failed to load players');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!player || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { player: updated } = await apiRequest<{ player: NicknamePlayer }>(`/api/admin/players/${player.id}`, {
        method: 'PATCH', body: { nicknames },
      });
      setPlayers((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setNicknames(formatNicknames(updated.nicknames));
      setNotice(`Nicknames saved for ${updated.display_name}.`);
      onSaved(updated);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save nicknames');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player nicknames</CardTitle>
        <CardDescription>As an admin, you can edit nicknames for any player.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="space-y-2">
            <Label htmlFor="admin-nickname-player">Player</Label>
            <select
              id="admin-nickname-player"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={playerId}
              disabled={loading || saving}
              onChange={(event) => {
                const selected = players.find((candidate) => candidate.id === event.target.value);
                setPlayerId(event.target.value);
                setNicknames(formatNicknames(selected?.nicknames));
                setError(null);
                setNotice(null);
              }}
            >
              <option value="">{loading ? 'Loading players…' : players.length ? 'Choose a player' : 'No players available'}</option>
              {players.map((entry) => <option key={entry.id} value={entry.id}>{entry.display_name}</option>)}
            </select>
          </div>
          {player ? (
            <div className="space-y-2">
              <Label htmlFor="admin-nicknames">Nicknames for {player.display_name}</Label>
              <Input id="admin-nicknames" value={nicknames} disabled={saving} onChange={(event) => setNicknames(event.target.value)} aria-describedby="admin-nicknames-help" />
              <p id="admin-nicknames-help" className="text-xs text-muted-foreground">Separate nicknames with commas. Leave blank to remove all nicknames.</p>
              <Button type="submit" disabled={saving || nicknames.trim() === formatNicknames(player.nicknames)}>{saving ? 'Saving…' : 'Save nicknames'}</Button>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
