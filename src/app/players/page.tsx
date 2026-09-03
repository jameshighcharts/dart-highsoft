"use client";

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { apiRequest } from '@/lib/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOCATIONS, type LocationValue } from '@/utils/locations';

type Player = { id: string; display_name: string; location: string | null };

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const [location, setLocation] = useState<LocationValue | ''>('');
  const [loading, setLoading] = useState(false);
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);

  async function load() {
    const supabase = await getSupabaseClient();
    const { data } = await supabase.from('players').select('*').order('display_name');
    setPlayers(data ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  async function addPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!location) return alert('Please select a location');
    setLoading(true);
    try {
      await apiRequest('/api/players', { body: { displayName: name.trim(), location } });
      setName('');
      load();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create player';
      alert(message);
    } finally {
      setLoading(false);
    }
  }

  async function updatePlayerLocation(playerId: string, nextLocation: LocationValue) {
    const previousLocation = players.find((player) => player.id === playerId)?.location ?? null;
    setPlayers((current) => current.map((player) => (player.id === playerId ? { ...player, location: nextLocation } : player)));
    setSavingPlayerId(playerId);
    try {
      await apiRequest(`/api/players/${playerId}`, {
        method: 'PATCH',
        body: { location: nextLocation },
      });
    } catch (error) {
      setPlayers((current) => current.map((player) => (player.id === playerId ? { ...player, location: previousLocation } : player)));
      const message = error instanceof Error ? error.message : 'Failed to update location';
      alert(message);
    } finally {
      setSavingPlayerId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Players</h1>
      <form onSubmit={addPlayer} className="flex gap-2">
        <Input className="flex-1" placeholder="New player name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={location} onValueChange={(v) => setLocation(v as LocationValue)}>
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Location" /></SelectTrigger>
          <SelectContent>
            {LOCATIONS.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button disabled={loading}>Add</Button>
      </form>
      <ul className="divide-y border rounded bg-card text-card-foreground">
        {players.map((p) => (
          <li key={p.id} className="px-3 py-2 flex items-center justify-between">
            <span>{p.display_name}</span>
            <div className="flex items-center gap-2">
              <Select
                value={p.location ?? undefined}
                onValueChange={(value) => {
                  const selectedLocation = LOCATIONS.find((option) => option.value === value)?.value;
                  if (selectedLocation) void updatePlayerLocation(p.id, selectedLocation);
                }}
                disabled={savingPlayerId === p.id}
              >
                <SelectTrigger className="w-[130px]" aria-label={`Location for ${p.display_name}`}>
                  <SelectValue placeholder="Add location" />
                </SelectTrigger>
                <SelectContent>
                  {LOCATIONS.map((locationOption) => (
                    <SelectItem key={locationOption.value} value={locationOption.value}>
                      {locationOption.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {savingPlayerId === p.id && <span className="text-xs text-muted-foreground">Saving…</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
