'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PlayerAvatar } from '@/components/PlayerAvatar';

type LineupPlayer = { id: string; display_name: string; avatar_url?: string | null };

/** Keep removed avatars briefly visible while selection changes immediately. */
export function SelectedPlayerLineup({ players, onRemove }: {
  players: LineupPlayer[];
  onRemove: (id: string) => void;
}) {
  const selectionKey = JSON.stringify(players.map((player) => player.id));
  const [previousSelection, setPreviousSelection] = useState(selectionKey);
  const [visiblePlayers, setVisiblePlayers] = useState(players);
  const selectedById = new Map(players.map((player) => [player.id, player]));

  if (previousSelection !== selectionKey) {
    const next = [...players];
    visiblePlayers.forEach((player, index) => {
      if (!selectedById.has(player.id)) next.splice(Math.min(index, next.length), 0, player);
    });
    setPreviousSelection(selectionKey);
    setVisiblePlayers(next);
  }

  const exitingKey = JSON.stringify(visiblePlayers.filter((player) => !selectedById.has(player.id)).map((player) => player.id));
  const removeExited = useCallback((ids: string[]) => {
    setVisiblePlayers((current) => current.filter((player) => !ids.includes(player.id)));
  }, []);

  useEffect(() => {
    const ids = JSON.parse(exitingKey) as string[];
    if (!ids.length) return;
    // No delay for reduced motion; timeout also handles interrupted animations.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      removeExited(ids);
      return;
    }
    const timeout = window.setTimeout(() => removeExited(ids), 320);
    return () => window.clearTimeout(timeout);
  }, [exitingKey, removeExited]);

  return (
    <div className="flex h-16 min-w-0 items-center justify-center px-3" aria-label="Selected players">
      <div className="flex w-full items-center" style={{ maxWidth: visiblePlayers.length ? visiblePlayers.length * 56 - 8 : undefined }}>
        {visiblePlayers.length === 0 && <span className="w-full text-center text-xs text-slate-500">Choose your lineup</span>}
        {visiblePlayers.map((savedPlayer, index) => {
          const player = selectedById.get(savedPlayer.id) ?? savedPlayer;
          const exiting = !selectedById.has(player.id);
          return (
            <div key={player.id} aria-hidden={exiting || undefined} style={{ animationDelay: `${-index * 0.09}s` }} className={`${exiting ? '' : 'lineup-avatar-slot'} relative min-w-0 flex-[1_1_56px] last:flex-[0_0_48px] hover:z-10 focus-within:z-10`}>
              <button type="button" disabled={exiting} onClick={() => onRemove(player.id)}
                aria-label={`Remove ${player.display_name}`} title={`${player.display_name} · Click to remove`}
                onAnimationEnd={(event) => {
                  if (exiting && event.animationName === 'lineup-avatar-exit') removeExited([player.id]);
                }}
                style={{ animationDelay: exiting ? '0s' : `0s, ${0.56 + index * 0.28}s`, animationDuration: exiting ? '280ms' : '560ms, 6s' }}
                className={`${exiting ? 'exiting-lineup-avatar' : 'selected-lineup-avatar'} pointer-events-auto group relative isolate shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950`}>
                <PlayerAvatar player={player} size="lg" className="size-12 ring-0" />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/65 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true"><X className="size-4" /></span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
