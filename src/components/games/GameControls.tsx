'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, Gamepad2, Plus, RotateCcw, Square, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type GameControlsProps = {
  gameId: string;
  isActive: boolean;
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
  onEndEarly: () => void;
  onRematch: () => void;
};

export function GameControls({ gameId, isActive, canUndo, busy, onUndo, onEndEarly, onRematch }: GameControlsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={onUndo} disabled={!canUndo || busy} className="gap-1">
        <Undo2 className="size-4" />
        Undo
      </Button>
      {isActive && (
        <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} disabled={busy} className="gap-1">
          <Square className="size-4" />
          End game
        </Button>
      )}
      <Button variant="ghost" size="sm" asChild className="gap-1">
        <a href={`/game/${gameId}?spectator=true`} target="_blank" rel="noopener noreferrer">
          <Eye className="size-4" />
          Spectator view
        </a>
      </Button>
      {!isActive && (
        <>
          <Button size="sm" onClick={onRematch} disabled={busy} className="gap-1">
            <RotateCcw className="size-4" />
            Rematch
          </Button>
          <Button variant="outline" size="sm" asChild className="gap-1">
            <Link href="/new">
              <Plus className="size-4" />
              New game
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="gap-1">
            <Link href="/games">
              <Gamepad2 className="size-4" />
              Games
            </Link>
          </Button>
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>End this game early?</DialogTitle>
            <DialogDescription>
              The game will be marked as ended early with no winner. Recorded darts are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Keep playing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onEndEarly();
              }}
            >
              End game
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
