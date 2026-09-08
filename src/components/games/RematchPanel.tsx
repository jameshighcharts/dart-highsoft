'use client';

import { useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { LOCATIONS, type LocationValue } from '@/utils/locations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/apiClient';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { Player } from '@/lib/match/types';

type Props = {
  players: Player[];
  gameLabel: string;
  minPlayers: number;
  maxPlayers?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (playerIds?: string[]) => Promise<void>;
  showTrigger?: boolean;
};

export function RematchPanel({ players, gameLabel, minPlayers, maxPlayers = Infinity, open, onOpenChange, onStart, showTrigger = true }: Props) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Player[]>([]);
  const [available, setAvailable] = useState<Player[]>([]);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [enabledLocations, setEnabledLocations] = useState<LocationValue[]>(() => LOCATIONS.map(location => location.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try { await action(); } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the next game');
    } finally { pending.current = false; setBusy(false); }
  }

  function start(playerIds?: string[]) {
    void run(async () => {
      await onStart(playerIds);
      onOpenChange(false);
      setEditing(false);
    });
  }

  function changeOpen(value: boolean) {
    if (pending.current) return;
    onOpenChange(value);
    setEditing(false);
    setError(null);
    setSearch('');
    setName('');
  }

  async function editPlayers() {
    setSelected(players);
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('match-location-filter') ?? 'null');
      if (Array.isArray(stored)) {
        setEnabledLocations(LOCATIONS.filter(location => stored.includes(location.value)).map(location => location.value));
      }
    } catch { /* Use all locations when the saved preference is unavailable. */ }
    setEditing(true);
    await run(async () => {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase.from('players').select('id, display_name, location, avatar_url').eq('is_active', true).order('display_name');
      if (error) throw new Error(error.message);
      setAvailable(data ?? []);
    });
  }

  const searchTerm = search.trim().toLowerCase();
  const filteredPlayers = available.filter(player =>
    (!player.location || enabledLocations.some(location => location === player.location))
    && player.display_name.toLowerCase().includes(searchTerm)
  );
  const atCapacity = selected.length >= maxPlayers;

  function togglePlayer(player: Player) {
    setSelected(current => current.some(selectedPlayer => selectedPlayer.id === player.id)
      ? current.filter(selectedPlayer => selectedPlayer.id !== player.id)
      : current.length < maxPlayers ? [...current, player] : current);
  }

  function toggleLocation(location: LocationValue) {
    const next = enabledLocations.includes(location)
      ? enabledLocations.filter(value => value !== location)
      : [...enabledLocations, location];
    setEnabledLocations(next);
    try { localStorage.setItem('match-location-filter', JSON.stringify(next)); } catch { /* Filtering still works without storage. */ }
  }

  return <>
    {showTrigger && <section aria-label="Play again" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div><h2 className="font-semibold">Play again?</h2><p className="text-sm text-muted-foreground">Keep the {gameLabel} settings and choose your players.</p></div>
      <Button onClick={() => changeOpen(true)}>Rematch</Button>
    </section>}
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{editing ? 'Edit rematch players' : 'Ready for a rematch?'}</DialogTitle>
          <DialogDescription>New {gameLabel} game with the same settings. The finished game stays in your history.</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {!editing ? <>
            <p className="text-sm">{players.map(player => player.display_name).join(', ')}</p>
            <div className="flex flex-wrap gap-2"><Button onClick={() => start()}>{busy ? 'Starting...' : 'Same players'}</Button>
              <Button variant="outline" onClick={() => void editPlayers()}>Edit players</Button></div>
          </> : <>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Players <span className="font-normal text-muted-foreground">{selected.length} selected</span></h3>
                <div role="group" aria-label="Location filter" className="flex flex-wrap gap-1">
                  {LOCATIONS.map(location => (
                    <Button key={location.value} type="button" size="sm"
                      variant={enabledLocations.includes(location.value) ? 'default' : 'outline'}
                      aria-pressed={enabledLocations.includes(location.value)}
                      onClick={() => toggleLocation(location.value)}>
                      {location.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5" aria-label="Selected players">
                {selected.map(player => (
                  <button key={player.id} type="button" aria-label={`Remove ${player.display_name}`}
                    className="flex max-w-full items-center gap-1.5 rounded-full bg-accent/40 px-2.5 py-1.5 text-xs font-medium hover:bg-accent/60"
                    onClick={() => togglePlayer(player)}>
                    <span className="truncate">{player.display_name}</span><X className="size-3 shrink-0" />
                  </button>
                ))}
                {selected.length === 0 && <p className="text-sm text-muted-foreground">Choose players for the next game.</p>}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" inputMode="search" autoComplete="off" className="h-11 pl-9 pr-10"
                  aria-label="Search players" placeholder="Search players" value={search}
                  onChange={event => setSearch(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (filteredPlayers.length === 1) togglePlayer(filteredPlayers[0]);
                    }
                  }} />
                {search && <button type="button" aria-label="Clear player search" className="absolute right-0 top-0 flex h-11 w-10 items-center justify-center text-muted-foreground hover:text-foreground" onClick={() => setSearch('')}><X className="size-4" /></button>}
              </div>
              <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2" aria-label="Available players">
                {filteredPlayers.map(player => {
                  const checked = selected.some(selectedPlayer => selectedPlayer.id === player.id);
                  const location = LOCATIONS.find(location => location.value === player.location);
                  return (
                    <label key={player.id} className={`flex min-h-12 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${checked ? 'border-accent bg-accent/30' : 'border-border hover:bg-accent/15'} ${atCapacity && !checked ? 'opacity-50' : ''}`}>
                      <input type="checkbox" aria-label={player.display_name} className="size-4 shrink-0 accent-current" checked={checked} disabled={atCapacity && !checked} onChange={() => togglePlayer(player)} />
                      <PlayerAvatar player={player} size="sm" />
                      <span className="min-w-0 truncate text-sm" title={player.display_name}>{player.display_name}</span>
                      {location && <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{location.label}</span>}
                    </label>
                  );
                })}
                {filteredPlayers.length === 0 && <p className="col-span-full py-4 text-center text-sm text-muted-foreground">{searchTerm ? 'No players match your search in these locations.' : 'No players in the selected locations.'}</p>}
              </div>
            </div>
            <form className="space-y-2 border-t pt-3" onSubmit={event => { event.preventDefault(); void run(async () => {
              const { player } = await apiRequest<{ player: Player }>('/api/players', { body: { displayName: name.trim() } });
              setSelected(current => [...current, player]);
              setAvailable(current => [...current, player]);
              setName('');
              setSearch('');
            }); }}>
              <label htmlFor="rematch-new-player" className="text-sm font-medium">Create a player</label>
              <div className="flex gap-2">
                <Input id="rematch-new-player" aria-label="New player name" placeholder="New player name" value={name} onChange={event => setName(event.target.value)} />
                <Button type="submit" variant="outline" disabled={!name.trim() || atCapacity}>Add new player</Button>
              </div>
            </form>
            <div className="sticky -bottom-6 -mx-6 flex items-center justify-between gap-3 border-t bg-background px-6 py-4">
              <p className="text-xs text-muted-foreground">{atCapacity ? 'Player limit reached' : `Choose at least ${minPlayers} players`}</p>
              <Button disabled={selected.length < minPlayers || selected.length > maxPlayers} onClick={() => start(selected.map(player => player.id))}>{busy ? 'Starting...' : 'Start rematch'}</Button>
            </div>
          </>}
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
