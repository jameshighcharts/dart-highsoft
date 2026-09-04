'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { apiRequest } from '@/lib/apiClient';
import type { AdminPlayer, AdminPlayersResponse } from '@/app/api/admin/players/route';
import type { SlackMember } from '@/lib/slack/members';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { LOCATIONS, type LocationValue } from '@/utils/locations';
import { formatNicknames } from '@/utils/nicknames';

type Viewer = { name: string; email: string | null; slackUserId: string };

const inputClass =
  'h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const buttonClass =
  'inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50';
const primaryButtonClass =
  'inline-flex h-9 items-center justify-center rounded-md bg-foreground px-3 text-sm font-medium text-background shadow-xs transition-colors hover:opacity-90 disabled:pointer-events-none disabled:opacity-50';

export function AdminUsersPanel({ viewer }: { viewer: Viewer }) {
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [slackMembers, setSlackMembers] = useState<SlackMember[]>([]);
  const [slackMembersError, setSlackMembersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState<LocationValue | ''>('');
  const [newNicknames, setNewNicknames] = useState('');
  const uploadTargetRef = useRef<AdminPlayer | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<AdminPlayersResponse>('/api/admin/players', { method: 'GET' });
      setPlayers(data.players);
      setSlackMembers(data.slackMembers);
      setSlackMembersError(data.slackMembersError);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load players');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const memberById = useMemo(() => new Map(slackMembers.map((member) => [member.id, member])), [slackMembers]);
  const linkedSlackIds = useMemo(
    () => new Set(players.map((player) => player.slack_user_id).filter((id): id is string => Boolean(id))),
    [players],
  );
  const myPlayer = players.find((player) => player.slack_user_id === viewer.slackUserId) ?? null;

  const visiblePlayers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return players;
    return players.filter((player) => {
      const slackName = player.slack_user_id ? memberById.get(player.slack_user_id)?.realName ?? '' : '';
      return player.display_name.toLowerCase().includes(needle) || slackName.toLowerCase().includes(needle);
    });
  }, [players, query, memberById]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  function patchLocal(playerId: string, patch: Partial<AdminPlayer>) {
    setPlayers((current) => current.map((player) => (player.id === playerId ? { ...player, ...patch } : player)));
  }

  async function addPlayer(event: React.FormEvent) {
    event.preventDefault();
    const displayName = newName.trim();
    if (!displayName) return;
    await run('add', async () => {
      const { player } = await apiRequest<{ player: AdminPlayer }>('/api/admin/players', {
        body: { displayName, location: newLocation || null, nicknames: newNicknames },
      });
      setPlayers((current) => [...current, player].sort((a, b) => a.display_name.localeCompare(b.display_name)));
      setNewName('');
      setNewLocation('');
      setNewNicknames('');
    });
  }

  async function updatePlayer(player: AdminPlayer, body: { displayName?: string; location?: string | null; isActive?: boolean; nicknames?: string }) {
    await run(player.id, async () => {
      const { player: updated } = await apiRequest<{ player: Omit<AdminPlayer, 'slack_user_id'> }>(
        `/api/admin/players/${player.id}`,
        { method: 'PATCH', body },
      );
      patchLocal(player.id, updated);
    });
  }

  async function setSlackLink(player: AdminPlayer, slackUserId: string | null) {
    await run(`${player.id}:slack`, async () => {
      if (slackUserId) {
        await apiRequest(`/api/admin/players/${player.id}/slack-link`, { method: 'PUT', body: { slackUserId } });
        // The Slack user can only be linked to one player, so clear it elsewhere.
        setPlayers((current) =>
          current.map((entry) =>
            entry.id === player.id
              ? { ...entry, slack_user_id: slackUserId }
              : entry.slack_user_id === slackUserId
                ? { ...entry, slack_user_id: null }
                : entry,
          ),
        );
      } else {
        await apiRequest(`/api/admin/players/${player.id}/slack-link`, { method: 'DELETE' });
        patchLocal(player.id, { slack_user_id: null });
      }
    });
  }

  async function syncSlackMembers() {
    await run('sync', async () => {
      const result = await apiRequest<{ members: number; created: number; linked: number; alreadyLinked: number }>(
        '/api/admin/slack/sync',
      );
      setNotice(
        `Synced ${result.members} Slack members: ${result.created} players created, ${result.linked} links added, ${result.alreadyLinked} already linked.`,
      );
      await load();
    });
  }

  function editNicknames(player: AdminPlayer) {
    const next = window.prompt('Nicknames (comma separated)', formatNicknames(player.nicknames));
    if (next === null || next.trim() === formatNicknames(player.nicknames)) return;
    void updatePlayer(player, { nicknames: next });
  }

  function pickAvatar(player: AdminPlayer) {
    uploadTargetRef.current = player;
    fileInputRef.current?.click();
  }

  async function onAvatarFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const player = uploadTargetRef.current;
    event.target.value = '';
    uploadTargetRef.current = null;
    if (!file || !player) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be 2 MB or smaller');
      return;
    }
    await run(`${player.id}:avatar`, async () => {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`/api/admin/players/${player.id}/avatar`, { method: 'POST', body: form });
      const data = (await response.json().catch(() => ({}))) as { avatarUrl?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? `Upload failed (${response.status})`);
      patchLocal(player.id, { avatar_url: data.avatarUrl ?? null });
    });
  }

  async function removeAvatar(player: AdminPlayer) {
    if (!window.confirm(`Remove ${player.display_name}'s picture?`)) return;
    await run(`${player.id}:avatar`, async () => {
      await apiRequest(`/api/admin/players/${player.id}/avatar`, { method: 'DELETE' });
      patchLocal(player.id, { avatar_url: null });
    });
  }

  function renameInline(player: AdminPlayer) {
    const next = window.prompt('Player name', player.display_name)?.trim();
    if (!next || next === player.display_name) return;
    void updatePlayer(player, { displayName: next });
  }

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label="Upload profile picture"
        onChange={(event) => void onAvatarFileChosen(event)}
      />
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-medium">You:</span>{' '}
            {myPlayer ? (
              <>
                linked to <span className="font-medium">{myPlayer.display_name}</span>
              </>
            ) : (
              <span className="text-muted-foreground">not linked to a player yet</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!myPlayer ? (
              <select
                aria-label="Link me to a player"
                className={inputClass}
                defaultValue=""
                disabled={busy !== null}
                onChange={(event) => {
                  const player = players.find((entry) => entry.id === event.target.value);
                  if (player) void setSlackLink(player, viewer.slackUserId);
                }}
              >
                <option value="">Link me to a player…</option>
                {players
                  .filter((player) => !player.slack_user_id)
                  .map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.display_name}
                    </option>
                  ))}
              </select>
            ) : null}
            <button type="button" className={primaryButtonClass} onClick={() => void syncSlackMembers()} disabled={busy !== null || Boolean(slackMembersError)}>
              {busy === 'sync' ? 'Syncing…' : 'Import Slack members'}
            </button>
          </div>
        </div>
        {slackMembersError ? (
          <p className="mt-2 text-xs text-muted-foreground">Slack directory unavailable: {slackMembersError}</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Import creates one player per Highsoft Slack member (first name, or first name + last initial when shared) and links them for the poll scheduler.
          </p>
        )}
      </section>

      {notice ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search players"
          className={`${inputClass} w-56`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <form onSubmit={addPlayer} className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} w-44`}
            placeholder="New player name"
            value={newName}
            maxLength={80}
            onChange={(event) => setNewName(event.target.value)}
          />
          <input
            className={`${inputClass} w-44`}
            placeholder="Nicknames, comma separated"
            value={newNicknames}
            onChange={(event) => setNewNicknames(event.target.value)}
          />
          <select className={inputClass} value={newLocation} onChange={(event) => setNewLocation(event.target.value as LocationValue | '')}>
            <option value="">No location</option>
            {LOCATIONS.map((location) => (
              <option key={location.value} value={location.value}>
                {location.label}
              </option>
            ))}
          </select>
          <button type="submit" className={buttonClass} disabled={busy !== null || !newName.trim()}>
            Add
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">Player</th>
              <th className="px-3 py-2 font-medium">Nicknames</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Slack</th>
              <th className="px-3 py-2 font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : visiblePlayers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No players
                </td>
              </tr>
            ) : (
              visiblePlayers.map((player) => {
                const rowBusy = busy === player.id || busy === `${player.id}:slack` || busy === `${player.id}:avatar`;
                const linkedMember = player.slack_user_id ? memberById.get(player.slack_user_id) : undefined;
                return (
                  <tr key={player.id} className={`border-b border-border last:border-0 ${player.is_active ? '' : 'text-muted-foreground'}`}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <div className="group relative shrink-0">
                          <button
                            type="button"
                            className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={player.avatar_url ? 'Replace picture' : 'Upload picture'}
                            aria-label={`${player.avatar_url ? 'Replace' : 'Upload'} picture for ${player.display_name}`}
                            onClick={() => pickAvatar(player)}
                            disabled={rowBusy}
                          >
                            <PlayerAvatar player={player} size="md" />
                          </button>
                          {player.avatar_url ? (
                            <button
                              type="button"
                              className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full border border-border bg-background text-[10px] leading-none shadow-xs group-hover:flex"
                              title="Remove picture"
                              aria-label={`Remove picture for ${player.display_name}`}
                              onClick={() => void removeAvatar(player)}
                              disabled={rowBusy}
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <button
                            type="button"
                            className="rounded px-1 text-left font-medium hover:bg-muted"
                            title="Rename"
                            onClick={() => renameInline(player)}
                            disabled={rowBusy}
                          >
                            {player.display_name}
                          </button>
                          {player.is_test ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">test</span> : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="max-w-48 truncate rounded px-1 text-left hover:bg-muted"
                        title="Edit nicknames"
                        onClick={() => editNicknames(player)}
                        disabled={rowBusy}
                      >
                        {player.nicknames.length > 0 ? formatNicknames(player.nicknames) : <span className="text-muted-foreground">—</span>}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`Location for ${player.display_name}`}
                        className={`${inputClass} h-8`}
                        value={player.location ?? ''}
                        disabled={rowBusy}
                        onChange={(event) => void updatePlayer(player, { location: event.target.value || null })}
                      >
                        <option value="">—</option>
                        {LOCATIONS.map((location) => (
                          <option key={location.value} value={location.value}>
                            {location.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {slackMembers.length > 0 ? (
                        <select
                          aria-label={`Slack user for ${player.display_name}`}
                          className={`${inputClass} h-8 max-w-56`}
                          value={player.slack_user_id ?? ''}
                          disabled={rowBusy}
                          onChange={(event) => void setSlackLink(player, event.target.value || null)}
                        >
                          <option value="">Not linked</option>
                          {player.slack_user_id && !linkedMember ? (
                            <option value={player.slack_user_id}>{player.slack_user_id}</option>
                          ) : null}
                          {slackMembers.map((member) => {
                            const takenElsewhere = linkedSlackIds.has(member.id) && member.id !== player.slack_user_id;
                            return (
                              <option key={member.id} value={member.id}>
                                {member.realName}
                                {takenElsewhere ? ' (linked)' : ''}
                              </option>
                            );
                          })}
                        </select>
                      ) : player.slack_user_id ? (
                        <span className="inline-flex items-center gap-2">
                          <code className="text-xs">{player.slack_user_id}</code>
                          <button type="button" className="text-xs underline" disabled={rowBusy} onClick={() => void setSlackLink(player, null)}>
                            Unlink
                          </button>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-foreground"
                          checked={player.is_active}
                          disabled={rowBusy}
                          onChange={(event) => void updatePlayer(player, { isActive: event.target.checked })}
                        />
                        <span className="sr-only">Active</span>
                      </label>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Click a picture to upload or replace it (PNG, JPEG or WebP, max 2 MB), a name to rename, nicknames to edit. Inactive players are hidden from leaderboards and player pickers but keep their history.
      </p>
    </div>
  );
}
