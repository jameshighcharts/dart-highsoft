"use client";

import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { practicePlayersQuery } from '@/lib/queries/practice';

// A static shell served from the CDN; the players load in the browser.
export default function PracticePage() {
  const { data: players, isPending } = useQuery(practicePlayersQuery());

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Practice Mode</h1>
      
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Select Player</CardTitle>
          <CardDescription>Choose who will be practicing. Each player gets their own practice session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            {(players || []).map((player) => (
              <Button
                key={player.id}
                variant="outline"
                className="justify-start"
                asChild
              >
                <Link href={`/practice/${player.id}`} className="inline-flex items-center gap-2">
                  <PlayerAvatar player={player} size="md" />
                  {player.display_name}
                </Link>
              </Button>
            ))}
            {!isPending && (!players || players.length === 0) && (
              <p className="text-center text-muted-foreground">
                No players found. <Link href="/players" className="text-blue-600 hover:underline">Create some players</Link> first.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}