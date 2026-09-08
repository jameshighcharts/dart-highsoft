'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Radio } from 'lucide-react';

import { RematchPanel } from '@/components/games/RematchPanel';
import { GAME_MODE_INFO } from '@/lib/games/labels';
import { Button } from '@/components/ui/button';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { deriveGameView, gameTurnGuide } from '@/lib/games/presentation';
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
import type {
  AroundTheClockEvent,
  CricketEvent,
  GameState,
  KillerEvent,
  ShanghaiEvent,
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
  const [rematchOpen, setRematchOpen] = useState(false);
  const [inputMode, setInputMode] = useState<'keypad' | 'board'>('keypad');

  const { session, players, orderedPlayerIds, throws, loading, error, refetch, setThrows } = useGameData(gameId);

  const derived = useMemo(() => {
    if (!session || orderedPlayerIds.length === 0) return { view: null, error: null };
    try {
      return { view: deriveGameView(session.mode, session.config, orderedPlayerIds, throws.map(rowToThrowInput)), error: null };
    } catch (err) {
      return { view: null, error: err instanceof Error ? err.message : 'Could not read this game.' };
    }
  }, [session, orderedPlayerIds, throws]);
  const view = derived.view;
  const state = view?.state ?? null;

  const { throwDart, undo, endEarly, rematch, busy, message } = useGameActions({ gameId, state, setThrows, refetch });

  if (loading && !session) {
    return <div className="max-w-5xl mx-auto p-6 text-center text-muted-foreground">Loading game...</div>;
  }
  if ((error && !session) || derived.error) {
    return (
      <div className="max-w-5xl mx-auto p-6 text-center space-y-2">
        <AlertCircle className="size-8 mx-auto text-destructive" />
        <div className="text-destructive">{derived.error ?? error}</div>
        <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
      </div>
    );
  }
  if (!session || !state || !view) {
    return <div className="max-w-5xl mx-auto p-6 text-center text-muted-foreground">Preparing game...</div>;
  }

  const isActive = session.status === 'active' && !state.finished;
  const isScolia = Boolean(session.scolia_board_id);
  const showInput = !spectator && !isScolia;
  const currentPlayer = players.find((p) => p.player_id === state.currentPlayerId) ?? null;
  const winnerId = session.winner_player_id ?? state.winnerId;
  const celebration = celebrationFor(state, players);
  const turnThrows = state.turnSegments.map((segment, index) => ({ dart_index: index + 1, segment }));
  const guide = gameTurnGuide(view);
  const lastThrow = throws.at(-1);
  const lastVisit = lastThrow ? throws.filter((dart) => dart.turn_index === lastThrow.turn_index) : [];
  const lastPlayer = players.find((player) => player.player_id === lastThrow?.player_id);
  const previousVisit = throws.filter((dart) => dart.turn_index < state.turnIndex);
  const previousTurn = previousVisit.at(-1)?.turn_index;
  const recentVisit = previousVisit.filter((dart) => dart.turn_index === previousTurn);
  const recentPlayer = players.find((player) => player.player_id === recentVisit[0]?.player_id);

  const modePanel = (() => {
    const shared = { players, currentPlayerId: isActive ? state.currentPlayerId : null, throws, turnIndex: state.turnIndex };
    switch (view.mode) {
      case 'cricket':
        return (
          <CricketBoard
            {...shared}
            state={view.state}
            config={view.config}
          />
        );
      case 'killer':
        return (
          <KillerBoard
            {...shared}
            state={view.state}
            config={view.config}
          />
        );
      case 'shanghai':
        return (
          <ShanghaiBoard
            {...shared}
            state={view.state}
            config={view.config}
          />
        );
      case 'around_the_clock':
        return (
          <ClockBoard
            {...shared}
            state={view.state}
            config={view.config}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 pb-4">
      <GameHeader gameId={gameId} mode={session.mode} status={session.status} finished={state.finished}
        roundLabel={isActive ? guide.round : `Round ${lastThrow?.round_number ?? 1}`} spectator={spectator} scoliaBoardId={session.scolia_board_id} />
      {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
        Scores may be out of date. {error}<Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button>
      </div>}

      {message && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {message}
        </div>
      )}

      {!isActive && <RematchPanel
        players={players.map(player => ({ id: player.player_id, display_name: player.display_name }))}
        gameLabel={GAME_MODE_INFO[session.mode].name}
        minPlayers={GAME_MODE_INFO[session.mode].minPlayers} maxPlayers={GAME_MODE_INFO[session.mode].maxPlayers}
        showTrigger={spectator} open={rematchOpen} onOpenChange={setRematchOpen}
        onStart={rematch}
      />}
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
              isActive={false}
              canUndo={throws.length > 0 && session.status !== 'ended_early'}
              busy={busy}
              onUndo={() => void undo()}
              onEndEarly={() => void endEarly()}
              onRematch={() => setRematchOpen(true)}
            />
          )}
        </GameResults>
      )}

      <div className={cn('grid min-w-0 gap-4 xl:gap-6', isActive && (spectator ? 'lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.7fr)]' : 'lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.4fr)]'))}>
        {isActive && <section aria-label="Current turn" className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-lime-300/30 bg-gradient-to-br from-lime-300/10 to-transparent p-4 md:p-5">
            <div className="flex items-center gap-3">
              {currentPlayer && <PlayerAvatar player={{ id: currentPlayer.player_id, display_name: currentPlayer.display_name, avatar_url: currentPlayer.avatar_url }} size="md" />}
              <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest text-lime-300">On throw</p>
                <h2 className="break-words text-2xl font-bold md:text-3xl">{currentPlayer?.display_name}</h2>
              </div>
              <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">{3 - state.dartsThrownInTurn} {state.dartsThrownInTurn === 2 ? 'dart' : 'darts'} left</span>
            </div>
            <div className={cn('my-3', spectator && 'md:my-7')}>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{guide.label}</p>
              <div className={cn('mt-1 font-black tracking-tighter text-lime-300', guide.target.length > 6 ? 'text-4xl md:text-5xl' : 'text-6xl', spectator && guide.target.length <= 6 && 'md:text-8xl')}>{guide.target}</div>
            </div>
            {spectator ? <p className="text-sm leading-relaxed text-muted-foreground">{guide.instruction}</p> : <details className="text-sm text-muted-foreground">
              <summary className="w-fit cursor-pointer py-1 hover:text-foreground">Game rules</summary>
              <p className="pt-2 leading-relaxed">{guide.instruction}</p>
            </details>}
            <div className="mt-4 border-t border-white/10 pt-4" aria-label={`${currentPlayer?.display_name} current darts`}>
              <ThrowSegmentBadges throws={turnThrows} highlightIncomplete placeholder="·" className="gap-2 [&>div]:h-12 [&>div]:flex-1 [&>div]:text-xl" />
            </div>
            {celebration && <p role="status" className="mt-3 text-sm font-medium text-lime-200">{celebration}</p>}
          </div>

          {isScolia && <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">
            <Radio className="size-4 shrink-0" />Automatic scoring from the Scolia board
          </div>}

          {!spectator && <GameControls isActive canUndo={throws.length > 0} busy={busy}
            onUndo={() => void undo()} onEndEarly={() => void endEarly()} onRematch={() => void rematch()} />}

          {showInput && <div className="rounded-2xl border border-white/10 bg-card p-3 md:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Record a dart</h2>
              <div className="flex gap-1" role="group" aria-label="Scoring input">
                <Button size="sm" variant={inputMode === 'keypad' ? 'secondary' : 'ghost'} aria-pressed={inputMode === 'keypad'} onClick={() => setInputMode('keypad')}>Keypad</Button>
                <Button size="sm" variant={inputMode === 'board' ? 'secondary' : 'ghost'} aria-pressed={inputMode === 'board'} onClick={() => setInputMode('board')}>Dartboard</Button>
              </div>
            </div>
            <fieldset disabled={busy} aria-label="Dart scoring" aria-busy={busy} className={cn('min-w-0', busy && 'pointer-events-none opacity-60')}>
              {inputMode === 'keypad' ? <MobileKeypad onHit={(r) => void throwDart(r.label, r.scored)} />
                : <Dartboard onHit={(_x, _y, r) => void throwDart(r.label, r.scored)} />}
            </fieldset>
          </div>}
        </section>}
        <section aria-label={isActive ? 'Live scoreboard' : 'Final scoreboard'} className="min-w-0 space-y-4 rounded-2xl border border-white/10 bg-card p-3 md:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{isActive ? 'Live game' : 'Final scores'}</h2>
            <span className="text-xs text-muted-foreground">{players.length} {players.length === 1 ? 'player' : 'players'}</span>
          </div>
          {modePanel}
          {recentVisit.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/5 p-3" aria-label="Last completed turn">
            <div className="min-w-0 text-sm"><span className="text-muted-foreground">Last turn · </span><span className="font-medium">{recentPlayer?.display_name}</span></div>
            <ThrowSegmentBadges throws={recentVisit} className="[&>div]:h-7 [&>div]:min-w-10 [&>div]:text-sm" />
          </div>}
          {!isActive && lastVisit.length > 0 && lastThrow?.turn_index !== previousTurn && <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Final turn · {lastPlayer?.display_name}</span><ThrowSegmentBadges throws={lastVisit} />
          </div>}
        </section>
      </div>
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
