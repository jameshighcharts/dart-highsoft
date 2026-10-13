"use client";

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { newMatchPlayersQuery } from '@/lib/queries/newMatch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MultiEloLeaderboard } from '@/components/MultiEloLeaderboard';
import { PlayerMultiEloStats } from '@/components/PlayerMultiEloStats';

export default function MultiEloPage() {
  // The active players, shared with /new and /tournament/new: from the browser's saved cache at once.
  const players = useQuery(newMatchPlayersQuery()).data ?? [];
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');

  const selected = players.find((p) => p.id === selectedPlayer);

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Multiplayer Elo</h1>
        <p className="text-muted-foreground">Rankings and player rating details for 3+ player matches</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <MultiEloLeaderboard limit={20} showRecentChanges={true} />
        </div>
        <div>
          {selected ? (
            <PlayerMultiEloStats player={selected} showHistory={true} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Player Multiplayer Elo</CardTitle>
                <CardDescription>Select a player below to view their rating and history</CardDescription>
              </CardHeader>
              <CardContent>
                <Select value={selectedPlayer} onValueChange={setSelectedPlayer}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a player..." />
                  </SelectTrigger>
                  <SelectContent>
                    {players.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
