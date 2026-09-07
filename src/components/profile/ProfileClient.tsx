'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Camera, Trash2 } from 'lucide-react';

import type { MeResponse } from '@/app/api/me/route';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { PlayerEloStats } from '@/components/PlayerEloStats';
import { PlayerMultiEloStats } from '@/components/PlayerMultiEloStats';
import { ProfileSummaryCard } from '@/components/profile/ProfileSummaryCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiRequest } from '@/lib/apiClient';
import type { MyPlayer } from '@/lib/server/myPlayer';
import { LOCATIONS } from '@/utils/locations';
import { formatNicknames } from '@/utils/nicknames';

const NO_LOCATION = '__none__';

export function ProfileClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nicknames, setNicknames] = useState('');
  const [newName, setNewName] = useState('');
  const [claimId, setClaimId] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<MeResponse>('/api/me', { method: 'GET' });
      setMe(data);
      setNicknames(formatNicknames(data.player?.nicknames));
      if (!data.player) setNewName((data.user.name ?? '').split(/\s+/)[0] ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  function setPlayer(player: MyPlayer) {
    setMe((current) => (current ? { ...current, player, unclaimedPlayers: [] } : current));
    setNicknames(formatNicknames(player.nicknames));
  }

  async function claim(body: { playerId: string } | { displayName: string }) {
    await run('claim', async () => {
      const { player } = await apiRequest<{ player: MyPlayer }>('/api/me/link', { body });
      setPlayer(player);
    });
  }

  async function saveNicknames() {
    await run('nicknames', async () => {
      const { player } = await apiRequest<{ player: MyPlayer }>('/api/me', { method: 'PATCH', body: { nicknames } });
      setPlayer(player);
    });
  }

  async function saveLocation(value: string) {
    await run('location', async () => {
      const { player } = await apiRequest<{ player: MyPlayer }>('/api/me', {
        method: 'PATCH',
        body: { location: value === NO_LOCATION ? null : value },
      });
      setPlayer(player);
    });
  }

  async function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be 2 MB or smaller');
      return;
    }
    await run('avatar', async () => {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/me/avatar', { method: 'POST', body: form });
      const data = (await response.json().catch(() => ({}))) as { avatarUrl?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? `Upload failed (${response.status})`);
      setMe((current) => (current?.player ? { ...current, player: { ...current.player, avatar_url: data.avatarUrl ?? null } } : current));
    });
  }

  async function removeAvatar() {
    if (!window.confirm('Remove your picture?')) return;
    await run('avatar', async () => {
      await apiRequest('/api/me/avatar', { method: 'DELETE' });
      setMe((current) => (current?.player ? { ...current, player: { ...current.player, avatar_url: null } } : current));
    });
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl p-4 text-sm text-muted-foreground">Loading your profile…</div>;
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {error ?? 'Could not load your profile.'}
        </p>
      </div>
    );
  }

  const { player, user } = me;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-2 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My profile</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{user.email ?? user.name}</span>
          {user.isAdmin ? (
            <Link href="/admin" className="underline-offset-4 hover:underline">
              Admin
            </Link>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {!player ? (
        <Card>
          <CardHeader>
            <CardTitle>Which player are you?</CardTitle>
            <CardDescription>
              Link your Slack account to your player once. Your matches, Elo and the <code className="text-xs">/dart</code> poll will use it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {me.unclaimedPlayers.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="claim-existing">I already have a player</Label>
                <div className="flex flex-wrap gap-2">
                  <Select value={claimId} onValueChange={setClaimId}>
                    <SelectTrigger id="claim-existing" className="w-64">
                      <SelectValue placeholder="Choose your player…" />
                    </SelectTrigger>
                    <SelectContent>
                      {me.unclaimedPlayers.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          <span className="inline-flex items-center gap-1.5">
                            <PlayerAvatar player={candidate} size="xs" />
                            {candidate.display_name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button disabled={!claimId || busy !== null} onClick={() => void claim({ playerId: claimId })}>
                    This is me
                  </Button>
                </div>
              </div>
            ) : null}
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (newName.trim()) void claim({ displayName: newName.trim() });
              }}
            >
              <Label htmlFor="new-player">I&apos;m new here</Label>
              <div className="flex flex-wrap gap-2">
                <Input id="new-player" className="w-64" maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Player name" />
                <Button type="submit" variant="secondary" disabled={!newName.trim() || busy !== null}>
                  Create my player
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-6 pt-0 sm:flex-row sm:items-start">
              <div className="flex flex-col items-center gap-2">
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Upload profile picture" onChange={(event) => void onFileChosen(event)} />
                <button
                  type="button"
                  className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy !== null}
                  aria-label={player.avatar_url ? 'Replace picture' : 'Upload picture'}
                >
                  <PlayerAvatar player={player} size="xl" />
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Camera className="size-6" />
                  </span>
                </button>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => fileInputRef.current?.click()}>
                    <Camera />
                    {player.avatar_url ? 'Replace' : 'Upload'}
                  </Button>
                  {player.avatar_url ? (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void removeAvatar()} aria-label="Remove picture">
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                <p className="text-center text-[11px] text-muted-foreground">PNG, JPEG or WebP, max 2 MB</p>
              </div>

              <div className="flex-1 space-y-5">
                <div>
                  <div className="text-2xl font-semibold">{player.display_name}</div>
                  <p className="text-xs text-muted-foreground">Ask an admin to change your name.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nicknames">Nicknames</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id="nicknames"
                      className="w-full sm:w-80"
                      placeholder="Comma separated, e.g. The Hammer, Bullseye"
                      value={nicknames}
                      onChange={(event) => setNicknames(event.target.value)}
                    />
                    <Button variant="secondary" disabled={busy !== null || nicknames.trim() === formatNicknames(player.nicknames)} onClick={() => void saveNicknames()}>
                      {busy === 'nicknames' ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Select value={player.location ?? NO_LOCATION} onValueChange={(value) => void saveLocation(value)} disabled={busy !== null}>
                    <SelectTrigger id="location" className="w-48">
                      <SelectValue placeholder="Location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LOCATION}>No location</SelectItem>
                      {LOCATIONS.map((location) => (
                        <SelectItem key={location.value} value={location.value}>
                          {location.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">My stats</h2>
            <div className="flex gap-3 text-sm">
              <Link href={`/practice/${player.id}`} className="text-muted-foreground underline-offset-4 hover:underline">
                Practice
              </Link>
              <Link href="/stats" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline">
                <BarChart3 className="size-4" />
                Full statistics
              </Link>
            </div>
          </div>
          <ProfileSummaryCard playerId={player.id} />
          <div className="grid gap-6 md:grid-cols-2">
            <PlayerEloStats player={player} showHistory />
            <PlayerMultiEloStats player={player} showHistory />
          </div>
        </>
      )}
    </div>
  );
}
