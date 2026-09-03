'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Plus, RefreshCw, Router, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { apiRequest } from '@/lib/apiClient';
import { useScoliaBoardRealtime } from '@/hooks/useScoliaBoardRealtime';
import { hasFreshScoliaHeartbeat } from '@/lib/scolia/availability';
import type { ScoliaBoard, ScoliaBoardPublicStatus } from '@/lib/scolia/types';
import { gameModeName } from '@/lib/games/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function connectionLabel(status: ScoliaBoard['workerConnectionStatus']): string {
  if (status === 'connected') return 'Connected';
  if (status === 'connecting') return 'Connecting';
  if (status === 'reconnecting') return 'Reconnecting';
  return 'Disconnected';
}

function mergePublicStatus(board: ScoliaBoard, status: ScoliaBoardPublicStatus): ScoliaBoard {
  const heartbeatIsFresh = hasFreshScoliaHeartbeat({ workerHeartbeatAt: status.workerHeartbeatAt });
  return {
    ...board,
    name: status.name,
    isHomeSbc: status.isHomeSbc,
    workerConnectionStatus: heartbeatIsFresh ? status.workerConnectionStatus : 'disconnected',
    boardStatus: status.boardStatus,
    boardPhase: status.boardPhase,
    errorType: status.errorType,
    lastEventAt: status.lastEventAt,
    workerHeartbeatAt: status.workerHeartbeatAt,
  };
}

export default function BoardsPage() {
  const [boards, setBoards] = useState<ScoliaBoard[]>([]);
  const [serialNumber, setSerialNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingSerial, setRemovingSerial] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBoards = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<{ boards: ScoliaBoard[] }>('/api/scolia/boards', { method: 'GET' });
      setBoards(result.boards);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Scolia boards');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  useScoliaBoardRealtime({
    onUpsert: (status) => setBoards((current) => current.map((board) =>
      board.id === status.boardId ? mergePublicStatus(board, status) : board
    )),
    onRemove: (boardId) => setBoards((current) => current.filter((board) => board.id !== boardId)),
    onOccupancyChange: () => void loadBoards(false),
    onReconcile: () => void loadBoards(false),
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      setBoards((current) => {
        let changed = false;
        const next = current.map((board) => {
          if (
            board.workerConnectionStatus === 'disconnected'
            || hasFreshScoliaHeartbeat({ workerHeartbeatAt: board.workerHeartbeatAt ?? null })
          ) return board;
          changed = true;
          return { ...board, workerConnectionStatus: 'disconnected' as const };
        });
        return changed ? next : current;
      });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  async function connectBoard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const serial = serialNumber.trim();
    if (!serial) return;

    setSaving(true);
    setError(null);
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
      setError(connectError instanceof Error ? connectError.message : 'Failed to connect Scolia board');
    } finally {
      setSaving(false);
    }
  }

  async function disconnectBoard(board: ScoliaBoard) {
    const confirmed = window.confirm(`Disconnect ${board.name || board.serialNumber} from this Scolia account?`);
    if (!confirmed) return;

    setRemovingSerial(board.serialNumber);
    setError(null);
    try {
      await apiRequest<{ ok: true }>(`/api/scolia/boards/${encodeURIComponent(board.serialNumber)}`, {
        method: 'DELETE',
      });
      setBoards((current) => current.filter((item) => item.serialNumber !== board.serialNumber));
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect Scolia board');
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
          <Button type="button" variant="outline" size="sm" onClick={() => void loadBoards()} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>

        {error ? (
          <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border py-12 text-sm text-muted-foreground">
            <LoaderCircle className="animate-spin" />
            Loading boards…
          </div>
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
                      <Badge variant="outline" className="border-border/40 text-muted-foreground">
                        Scolia: {connectionLabel(board.workerConnectionStatus)}
                      </Badge>
                      {board.workerConnectionStatus === 'connected' && board.boardStatus ? (
                        <Badge
                          variant={board.boardStatus === 'Error' ? 'destructive' : board.boardStatus === 'Ready' ? 'default' : 'secondary'}
                          className={board.boardStatus === 'Ready' ? 'bg-emerald-600 text-white' : undefined}
                        >
                          Board: {board.boardStatus}
                        </Badge>
                      ) : null}
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
    </div>
  );
}
