'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useRouter } from 'next/navigation';

import type { GameState } from '@/lib/games/types';
import type { GameThrowData } from '@/hooks/useGameData';

type ApiThrowResponse = { throw: GameThrowData; state: GameState };
type ApiError = { error?: string; code?: string };

type UseGameActionsArgs = {
  gameId: string;
  state: GameState | null;
  setThrows: Dispatch<SetStateAction<GameThrowData[]>>;
  refetch: () => Promise<void>;
};

const MESSAGE_TTL_MS = 4000;

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function pendingId(): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
  return `pending-${uuid}`;
}

export function useGameActions({ gameId, state, setThrows, refetch }: UseGameActionsArgs) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCountRef = useRef(0);
  const stateRef = useRef<GameState | null>(state);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => () => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
  }, []);

  const showMessage = useCallback((text: string) => {
    setMessage(text);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), MESSAGE_TTL_MS);
  }, []);

  /** Run `task` after every previously queued operation, so fast taps stay ordered. */
  const enqueue = useCallback((task: () => Promise<void>): Promise<void> => {
    pendingCountRef.current += 1;
    setBusy(true);
    const run = queueRef.current.then(task, task).finally(() => {
      pendingCountRef.current -= 1;
      if (pendingCountRef.current === 0) setBusy(false);
    });
    queueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const throwDart = useCallback(
    (segmentLabel: string, scored: number) =>
      enqueue(async () => {
        const current = stateRef.current;
        if (!current || current.finished || !current.currentPlayerId) return;
        const playerId = current.currentPlayerId;

        const optimistic: GameThrowData = {
          id: pendingId(),
          session_id: gameId,
          player_id: playerId,
          round_number: current.round,
          turn_index: current.turnIndex,
          dart_index: current.dartsThrownInTurn + 1,
          segment: segmentLabel,
          scored,
          meta: {},
          pending: true,
        };
        setThrows((prev) => [...prev, optimistic]);

        try {
          const response = await fetch(`/api/games/${gameId}/throws`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segment: segmentLabel, scored, playerId }),
          });

          if (response.status === 201) {
            const data = await readJson<ApiThrowResponse>(response);
            if (data?.throw) {
              setThrows((prev) => prev.map((row) => (row.id === optimistic.id ? { ...data.throw, pending: false } : row)));
            }
            await refetch();
            return;
          }

          const errorBody = (await readJson<ApiError>(response)) ?? {};
          setThrows((prev) => prev.filter((row) => row.id !== optimistic.id));
          if (response.status === 409 && (errorBody.code === 'slot_taken' || errorBody.code === 'wrong_player')) {
            await refetch();
            showMessage(errorBody.error ?? 'The board changed. Reloaded the latest state.');
            return;
          }
          if (response.status === 409) await refetch();
          showMessage(errorBody.error ?? `Failed to record dart (${response.status})`);
        } catch (err) {
          setThrows((prev) => prev.filter((row) => row.id !== optimistic.id));
          showMessage(err instanceof Error ? err.message : 'Failed to record dart');
        }
      }),
    [enqueue, gameId, refetch, setThrows, showMessage]
  );

  const undo = useCallback(
    () =>
      enqueue(async () => {
        try {
          const response = await fetch(`/api/games/${gameId}/throws`, { method: 'DELETE' });
          if (!response.ok) {
            const errorBody = (await readJson<ApiError>(response)) ?? {};
            showMessage(errorBody.error ?? `Undo failed (${response.status})`);
          }
        } catch (err) {
          showMessage(err instanceof Error ? err.message : 'Undo failed');
        } finally {
          await refetch();
        }
      }),
    [enqueue, gameId, refetch, showMessage]
  );

  const endEarly = useCallback(
    () =>
      enqueue(async () => {
        try {
          const response = await fetch(`/api/games/${gameId}/end`, { method: 'PATCH' });
          if (!response.ok) {
            const errorBody = (await readJson<ApiError>(response)) ?? {};
            showMessage(errorBody.error ?? `Could not end game (${response.status})`);
          }
        } catch (err) {
          showMessage(err instanceof Error ? err.message : 'Could not end game');
        } finally {
          await refetch();
        }
      }),
    [enqueue, gameId, refetch, showMessage]
  );

  const rematch = useCallback(
    () =>
      enqueue(async () => {
        try {
          const response = await fetch(`/api/games/${gameId}/rematch`, { method: 'POST' });
          const data = (await readJson<{ newGameId?: string } & ApiError>(response)) ?? {};
          if (!response.ok || !data.newGameId) {
            showMessage(data.error ?? `Could not start rematch (${response.status})`);
            return;
          }
          router.push(`/game/${data.newGameId}`);
        } catch (err) {
          showMessage(err instanceof Error ? err.message : 'Could not start rematch');
        }
      }),
    [enqueue, gameId, router, showMessage]
  );

  return { throwDart, undo, endEarly, rematch, busy, message, clearMessage: () => setMessage(null) };
}
