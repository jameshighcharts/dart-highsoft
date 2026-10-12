'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Plus, RefreshCw, Router, Trash2, Tv } from 'lucide-react';
import Link from 'next/link';

import { LoadingReveal } from '@/components/LoadingReveal';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/apiClient';
import { scoliaBoardsQuery } from '@/lib/queries/boards';
import { refreshAfterChange } from '@/lib/queries/refreshAfterChange';
import { isTVModeEnabled, TV_MODE_STORAGE_KEY } from '@/lib/tvMode';
import { useScoliaBoardRealtime, type RealtimeChannelStatus } from '@/hooks/useScoliaBoardRealtime';
import { isChannelLive } from '@/lib/scolia/connectionHealth';
import { ScoliaBoardHealth } from '@/components/scolia/ScoliaConnectionIndicator';
import { hasFreshScoliaHeartbeat } from '@/lib/scolia/availability';
import type { ScoliaBoard, ScoliaBoardPublicStatus } from '@/lib/scolia/types';
import { gameModeName } from '@/lib/games/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

function mergePublicStatus(board: ScoliaBoard, status: ScoliaBoardPublicStatus): ScoliaBoard {
  const heartbeatIsFresh = hasFreshScoliaHeartbeat({ workerHeartbeatAt: status.workerHeartbeatAt });
  return {
    ...board,
    name: status.name,
    isHomeSbc: status.isHomeSbc,
    workerConnectionStatus: heartbeatIsFresh ? status.workerConnectionStatus : 'disconnected',
    workerConnectionChangedAt: status.workerConnectionChangedAt ?? null,
    boardStatus: status.boardStatus,
    boardPhase: status.boardPhase,
    errorType: status.errorType,
    lastEventAt: status.lastEventAt,
    workerHeartbeatAt: status.workerHeartbeatAt,
  };
}

/** Boards whose heartbeat has gone stale are shown as disconnected; unchanged boards keep their identity. */
function markStaleHeartbeats(boards: ScoliaBoard[]): ScoliaBoard[] {
  let changed = false;
  const next = boards.map((board) => {
    if (
      board.workerConnectionStatus === 'disconnected'
      || hasFreshScoliaHeartbeat({ workerHeartbeatAt: board.workerHeartbeatAt ?? null })
    ) return board;
    changed = true;
    return { ...board, workerConnectionStatus: 'disconnected' as const };
  });
  return changed ? next : boards;
}

export default function BoardsPage() {
  const queryClient = useQueryClient();
  // Applied on read too, so boards cached from an earlier visit never show a stale heartbeat as live.
  const boardsQuery = useQuery({ ...scoliaBoardsQuery(), select: markStaleHeartbeats });
  const boards = boardsQuery.data ?? [];
  const setBoards = (update: (current: ScoliaBoard[]) => ScoliaBoard[]) => {
    const current = queryClient.getQueryData(scoliaBoardsQuery().queryKey);
    if (!current) return;
    const next = update(current);
    // Writing unchanged data would still notify every cache subscriber, including the persister.
    if (next !== current) queryClient.setQueryData(scoliaBoardsQuery().queryKey, next);
  };
  const [serialNumber, setSerialNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [removingSerial, setRemovingSerial] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const loadError = boardsQuery.isError
    ? (boardsQuery.error instanceof Error ? boardsQuery.error.message : 'Failed to load Scolia boards')
    : null;
  const error = actionError ?? loadError;
  const [tvMode, setTVMode] = useState(false);
  const [tvModeError, setTVModeError] = useState<string | null>(null);

  useEffect(() => {
    setTVMode(isTVModeEnabled());
  }, []);

  function changeTVMode(enabled: boolean) {
    try {
      window.localStorage.setItem(TV_MODE_STORAGE_KEY, String(enabled));
      setTVMode(enabled);
      setTVModeError(null);
    } catch {
      setTVModeError('Unable to save TV mode. Allow browser storage and try again.');
    }
  }

  const refreshBoards = () => refreshAfterChange(queryClient, scoliaBoardsQuery().queryKey);

  const [boardChannel, setBoardChannel] = useState<RealtimeChannelStatus | undefined>(undefined);
  useScoliaBoardRealtime({
    onUpsert: (status) => setBoards((current) => current.map((board) =>
      board.id === status.boardId ? mergePublicStatus(board, status) : board
    )),
    onRemove: (boardId) => setBoards((current) => current.filter((board) => board.id !== boardId)),
    onOccupancyChange: refreshBoards,
    // After every (re)subscribe: catches changes made between the last fetch and the subscription.
    onReconcile: refreshBoards,
    onChannelStatus: setBoardChannel,
  });

  useEffect(() => {
    const key = scoliaBoardsQuery().queryKey;
    const markStale = () => {
      const current = queryClient.getQueryData(key);
      if (!current) return;
      const next = markStaleHeartbeats(current);
      if (next !== current) queryClient.setQueryData(key, next);
    };
    markStale();
    const interval = window.setInterval(markStale, 1_000);
    return () => window.clearInterval(interval);
  }, [queryClient]);

  async function connectBoard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const serial = serialNumber.trim();
    if (!serial) return;

    setSaving(true);
    setActionError(null);
    try {
      const result = await apiRequest<{ board: ScoliaBoard }>('/api/scolia/boards', {
        method: 'PUT',
        body: { serialNumber: serial },
      });
      setBoards((current) => {
        const withoutConnectedBoard = current.filter((board) => board.serialNumber !== result.board.serialNumber);
        return [...withoutConnectedBoard, { ...result.board, workerConnectionStatus: 'disconnected' as const }].sort(
          (a, b) => a.name.localeCompare(b.name)
        );
      });
      setSerialNumber('');
    } catch (connectError) {
      setActionError(connectError instanceof Error ? connectError.message : 'Failed to connect Scolia board');
    } finally {
      setSaving(false);
    }
  }

  async function disconnectBoard(board: ScoliaBoard) {
    const confirmed = window.confirm(`Disconnect ${board.name || board.serialNumber} from this Scolia account?`);
    if (!confirmed) return;

    setRemovingSerial(board.serialNumber);
    setActionError(null);
    try {
      await apiRequest<{ ok: true }>(`/api/scolia/boards/${encodeURIComponent(board.serialNumber)}`, {
        method: 'DELETE',
      });
      setBoards((current) => current.filter((item) => item.serialNumber !== board.serialNumber));
    } catch (disconnectError) {
      setActionError(disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect Scolia board');
    } finally {
      setRemovingSerial(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-1 md:p-0">
      <div>
        <h1 className="text-2xl font-semibold">Scolia boards</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect boards to the Scolia service account used by this scoreboard.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect a board</CardTitle>
          <CardDescription>Enter the serial number printed on the Scolia processing unit.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={connectBoard}>
            <div className="flex-1 space-y-2">
              <Label htmlFor="scolia-serial-number">Serial number</Label>
              <Input
                id="scolia-serial-number"
                autoComplete="off"
                maxLength={128}
                placeholder="SCOLIA BOARD SERIAL"
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={saving || !serialNumber.trim()}>
              {saving ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Connect board
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="connected-boards-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="connected-boards-heading" className="text-lg font-semibold">Connected boards</h2>
            <p className="text-sm text-muted-foreground">Registration state from the Scolia REST API.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { setActionError(null); void boardsQuery.refetch(); }}
            disabled={boardsQuery.isFetching}
          >
            <RefreshCw className={boardsQuery.isFetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>

        {error ? (
          <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {boardsQuery.isPending ? (
          <LoadingReveal label="Loading boards…" className="grid gap-3">
            {[0, 1].map((index) => (
              <Card key={index} className="py-4">
                <CardContent className="flex items-center gap-4">
                  <Skeleton className="size-10 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-8 w-24" />
                </CardContent>
              </Card>
            ))}
          </LoadingReveal>
        ) : boards.length === 0 ? (
          <div className="rounded-xl border border-dashed px-6 py-12 text-center">
            <Router className="mx-auto mb-3 size-8 text-muted-foreground" />
            <div className="font-medium">No Scolia boards connected</div>
            <p className="mt-1 text-sm text-muted-foreground">Add a board by serial number to get started.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {boards.map((board) => (
              <Card key={board.serialNumber} className="py-4">
                <CardContent className="flex items-center gap-4">
                  <div className="rounded-lg bg-muted p-2.5">
                    <Router className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate font-medium">{board.name || 'Unnamed board'}</div>
                      <ScoliaBoardHealth board={board} live={isChannelLive(boardChannel)} />
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{board.serialNumber}</div>
                    {board.workerConnectionStatus === 'connected' && board.boardPhase ? (
                      <div className="mt-1 text-xs text-muted-foreground">Phase: {board.boardPhase}</div>
                    ) : null}
                    {board.activeMatch ? (
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <Badge variant="secondary">Match in progress</Badge>
                        <Link
                          href={`/match/${board.activeMatch.id}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {board.activeMatch.playerNames.length > 0
                            ? board.activeMatch.playerNames.join(' vs ')
                            : 'Open match'}
                          {' · '}{board.activeMatch.startScore}
                          {' · '}first to {board.activeMatch.legsToWin}
                          {' · '}{board.activeMatch.completedLegs} {board.activeMatch.completedLegs === 1 ? 'leg' : 'legs'} complete
                        </Link>
                      </div>
                    ) : board.activeGame ? (
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <Badge variant="secondary">Game in progress</Badge>
                        <Link
                          href={`/game/${board.activeGame.id}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {board.activeGame.playerNames.length > 0
                            ? board.activeGame.playerNames.join(' vs ')
                            : 'Open game'}
                          {' · '}{gameModeName(board.activeGame.mode)}
                        </Link>
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Match: {board.workerConnectionStatus === 'connected' && board.boardStatus === 'Ready'
                          ? 'Available'
                          : 'Unavailable until board is ready'}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={removingSerial !== null || Boolean(board.activeMatch) || Boolean(board.activeGame)}
                    title={
                      board.activeMatch
                        ? 'End the active match before disconnecting this board'
                        : board.activeGame
                          ? 'End the active game before disconnecting this board'
                          : undefined
                    }
                    onClick={() => void disconnectBoard(board)}
                  >
                    {removingSerial === board.serialNumber ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                    <span className="hidden sm:inline">{board.activeMatch || board.activeGame ? 'In use' : 'Disconnect'}</span>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="space-y-2">
        <label htmlFor="tv-mode" className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${tvMode ? 'border-cyan-400/30 bg-cyan-400/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/5'}`}>
          <Tv className={`h-5 w-5 shrink-0 ${tvMode ? 'text-cyan-300' : 'text-slate-400'}`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">TV mode</span>
            <span id="tv-mode-description" className="mt-0.5 block text-xs leading-relaxed text-slate-400">
              Open new games in fullscreen spectator mode. Saved in this browser.
            </span>
          </span>
          <Switch
            id="tv-mode"
            aria-label="TV mode"
            aria-describedby="tv-mode-description"
            checked={tvMode}
            onCheckedChange={changeTVMode}
            className="data-[state=checked]:bg-cyan-400"
          />
        </label>
        {tvModeError ? <p role="alert" className="text-sm text-destructive">{tvModeError}</p> : null}
      </div>
    </div>
  );
}
