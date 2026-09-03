'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Radio } from 'lucide-react';

import Dartboard from '@/components/Dartboard';
import MobileKeypad from '@/components/MobileKeypad';
import { ThrowSegmentBadges } from '@/components/ThrowSegmentBadges';
import { ClockBoard } from '@/components/games/ClockBoard';
import { CricketBoard } from '@/components/games/CricketBoard';
import { GameControls } from '@/components/games/GameControls';
import { GameHeader } from '@/components/games/GameHeader';
import { GameResults } from '@/components/games/GameResults';
import { KillerBoard } from '@/components/games/KillerBoard';
import { ShanghaiBoard } from '@/components/games/ShanghaiBoard';
import { useGameActions } from '@/hooks/useGameActions';
import { rowToThrowInput, useGameData } from '@/hooks/useGameData';
import type { GamePlayerData } from '@/hooks/useGameData';
import { shanghaiTargetForRound } from '@/lib/games/engines/shanghai';
import { describeSegment } from '@/lib/games/labels';
import { getEngine } from '@/lib/games/registry';
import type {
  AroundTheClockConfig,
  AroundTheClockEvent,
  AroundTheClockPlayerState,
  CricketConfig,
  CricketEvent,
  CricketPlayerState,
  GameState,
  KillerConfig,
  KillerEvent,
  KillerPlayerState,
  ShanghaiConfig,
  ShanghaiEvent,
  ShanghaiPlayerState,
} from '@/lib/games/types';
import { cn } from '@/lib/utils';

type GameClientProps = { gameId: string };

function celebrationFor(state: GameState, players: GamePlayerData[]): string | null {
  const event = state.lastEvent;
  if (!event) return null;
  const nameOf = (id: string) => players.find((p) => p.player_id === id)?.display_name ?? 'Someone';
  const actor = nameOf(event.playerId);
  switch (event.type) {
    case 'cricket_throw': {
      const e = event as CricketEvent;
      if (e.closed && e.target !== null) return `${actor} closed ${e.target === 25 ? 'Bull' : e.target}!`;
      return null;
    }
    case 'killer_throw': {
      const e = event as KillerEvent;
      if (e.eliminatedPlayerId) return `${nameOf(e.eliminatedPlayerId)} is out!`;
      if (e.kill && e.victimId) return `${actor} took a life from ${nameOf(e.victimId)}!`;
      if (e.becameKiller) return `${actor} is now a killer!`;
      if (e.selfHit) return `${actor} hit their own number and lost a life.`;
      return null;
    }
    case 'shanghai_throw': {
      const e = event as ShanghaiEvent;
      if (e.shanghai) return `SHANGHAI! ${actor} wins on the spot.`;
      return null;
    }
    case 'clock_throw': {
      const e = event as AroundTheClockEvent;
      if (e.finished) return `${actor} finished the clock!`;
      return null;
    }
    default:
      return null;
  }
}

function GameClientInner({ gameId }: GameClientProps) {
  const searchParams = useSearchParams();
  const spectator = searchParams.get('spectator') === 'true';

  const { session, players, orderedPlayerIds, throws, loading, error, refetch, setThrows } = useGameData(gameId);

  const state = useMemo<GameState | null>(() => {
    if (!session || orderedPlayerIds.length === 0) return null;
    try {
      return getEngine(session.mode).deriveState(session.config, orderedPlayerIds, throws.map(rowToThrowInput));
    } catch (err) {
      console.error('Failed to derive game state:', err);
      return null;
    }
  }, [session, orderedPlayerIds, throws]);

  const { throwDart, undo, endEarly, rematch, busy, message } = useGameActions({ gameId, state, setThrows, refetch });

  if (loading && !session) {
    return <div className="max-w-5xl mx-auto p-6 text-center text-muted-foreground">Loading game...</div>;
  }
  if (error && !session) {
    return (
      <div className="max-w-5xl mx-auto p-6 text-center space-y-2">
        <AlertCircle className="size-8 mx-auto text-destructive" />
        <div className="text-destructive">{error}</div>
      </div>
    );
  }
  if (!session || !state) {
    return <div className="max-w-5xl mx-auto p-6 text-center text-muted-foreground">Preparing game...</div>;
  }

  const isActive = session.status === 'active' && !state.finished;
  const isScolia = Boolean(session.scolia_board_id);
  const showInput = !spectator && !isScolia;
  const currentPlayer = players.find((p) => p.player_id === state.currentPlayerId) ?? null;
  const winnerId = session.winner_player_id ?? state.winnerId;
  const celebration = celebrationFor(state, players);
  const turnThrows = state.turnSegments.map((segment, index) => ({ dart_index: index + 1, segment }));
  const roundTarget = session.mode === 'shanghai' && !state.finished
    ? shanghaiTargetForRound(session.config as unknown as ShanghaiConfig, state.round)
    : null;

  const modePanel = (() => {
    const shared = { players, currentPlayerId: state.currentPlayerId };
    switch (session.mode) {
      case 'cricket':
        return (
          <CricketBoard
            {...shared}
            state={state as GameState<CricketPlayerState, CricketEvent>}
            config={session.config as unknown as CricketConfig}
          />
        );
      case 'killer':
        return (
          <KillerBoard
            {...shared}
            state={state as GameState<KillerPlayerState, KillerEvent>}
            config={session.config as unknown as KillerConfig}
          />
        );
      case 'shanghai':
        return (
          <ShanghaiBoard
            {...shared}
            state={state as GameState<ShanghaiPlayerState, ShanghaiEvent>}
            config={session.config as unknown as ShanghaiConfig}
          />
        );
      case 'around_the_clock':
        return (
          <ClockBoard
            {...shared}
            state={state as GameState<AroundTheClockPlayerState, AroundTheClockEvent>}
            config={session.config as unknown as AroundTheClockConfig}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div className={cn('mx-auto space-y-4', spectator ? 'max-w-7xl' : 'max-w-5xl')}>
      <GameHeader
        mode={session.mode}
        status={session.status}
        finished={state.finished}
        round={state.round}
        roundTarget={roundTarget}
        currentPlayerName={currentPlayer?.display_name ?? null}
        scoliaBoardId={session.scolia_board_id}
        celebration={celebration}
      />

      {message && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {message}
        </div>
      )}

      {!isActive && (
        <GameResults
          mode={session.mode}
          status={session.status}
          config={session.config}
          state={state}
          players={players}
          winnerId={winnerId}
        >
          {!spectator && (
            <GameControls
              gameId={gameId}
              isActive={false}
              canUndo={throws.length > 0 && session.status !== 'ended_early'}
              busy={busy}
              onUndo={() => void undo()}
              onEndEarly={() => void endEarly()}
              onRematch={() => void rematch()}
            />
          )}
        </GameResults>
      )}

      <div className={cn(spectator && 'text-lg')}>{modePanel}</div>

      {isActive && (
        <div className="rounded-lg border bg-card p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">This turn</span>
          <ThrowSegmentBadges throws={turnThrows} highlightIncomplete className="[&>div]:h-8 [&>div]:min-w-12 [&>div]:text-sm" />
          {state.turnSegments.length > 0 && (
            <span className="text-sm text-muted-foreground truncate">
              {describeSegment(state.turnSegments[state.turnSegments.length - 1])}
            </span>
          )}
        </div>
      )}

      {isActive && isScolia && !spectator && (
        <div className="rounded-lg border border-emerald-700/50 bg-emerald-900/20 p-4 text-center text-emerald-200 flex items-center justify-center gap-2">
          <Radio className="size-5" />
          Throws are scored automatically by the Scolia board
        </div>
      )}

      {isActive && showInput && (
        <div className={cn('rounded-lg border bg-card p-2 md:p-4', busy && 'pointer-events-none opacity-50')}>
          <div className="lg:hidden">
            <MobileKeypad onHit={(r) => void throwDart(r.label, r.scored)} />
          </div>
          <div className="hidden lg:flex justify-center">
            <Dartboard onHit={(_x, _y, r) => void throwDart(r.label, r.scored)} />
          </div>
        </div>
      )}

      {isActive && !spectator && (
        <GameControls
          gameId={gameId}
          isActive
          canUndo={throws.length > 0}
          busy={busy}
          onUndo={() => void undo()}
          onEndEarly={() => void endEarly()}
          onRematch={() => void rematch()}
        />
      )}
    </div>
  );
}

export default function GameClient(props: GameClientProps) {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto p-6 text-center text-muted-foreground">Loading game...</div>}>
      <GameClientInner {...props} />
    </Suspense>
  );
}
