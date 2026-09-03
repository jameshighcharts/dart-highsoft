"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { apiRequest } from "@/lib/apiClient";
import { useScoliaBoardRealtime } from "@/hooks/useScoliaBoardRealtime";
import { hasFreshScoliaHeartbeat, isScoliaBoardReady } from "@/lib/scolia/availability";
import type { ScoliaBoardOption, ScoliaBoardPublicStatus } from "@/lib/scolia/types";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOCATIONS, type LocationValue } from "@/utils/locations";
import { GAME_MODE_INFO } from "@/lib/games/labels";
import type { GameMode } from "@/lib/games/types";
import {
  GameConfigFields,
  GameTypePicker,
  defaultConfigFor,
  gameTypeName,
  loadStoredGameType,
  storeGameType,
  validateGameSelection,
  type GameType,
} from "@/components/games/NewGameOptions";

type Player = { id: string; display_name: string; location: string | null };

type StartScore = "201" | "301" | "501";

type FinishRule = "single_out" | "double_out";

const STORAGE_KEY = "match-location-filter";
const MANUAL_BOARD_VALUE = "manual";

function titleCaseStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function optionFromStatus(status: ScoliaBoardPublicStatus, current?: ScoliaBoardOption): ScoliaBoardOption {
  const activeMatchId = current?.activeMatchId ?? null;
  const activeGameSessionId = current?.activeGameSessionId ?? null;
  const workerConnectionStatus = hasFreshScoliaHeartbeat(status)
    ? status.workerConnectionStatus
    : 'disconnected';
  const ready = isScoliaBoardReady({
    workerConnectionStatus,
    boardStatus: status.boardStatus,
    workerHeartbeatAt: status.workerHeartbeatAt,
  });
  return {
    id: status.boardId,
    name: status.name,
    isHomeSbc: status.isHomeSbc,
    workerConnectionStatus,
    boardStatus: status.boardStatus,
    workerHeartbeatAt: status.workerHeartbeatAt,
    activeMatchId,
    activeGameSessionId,
    selectable: ready && !activeMatchId && !activeGameSessionId,
  };
}

function loadEnabledLocations(): LocationValue[] {
  if (typeof window === "undefined") return LOCATIONS.map((l) => l.value);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as LocationValue[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* ignore */
  }
  return LOCATIONS.map((l) => l.value);
}

export default function NewMatchPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [startScore, setStartScore] = useState<StartScore>("501");
  const [finish, setFinish] = useState<FinishRule>("double_out");
  const [legsToWin, setLegsToWin] = useState(1);
  const [fairEnding, setFairEnding] = useState(false);
  // Start on X01 for SSR and pick up the stored choice after hydration.
  const [gameType, setGameType] = useState<GameType>("x01");
  const [gameConfig, setGameConfig] = useState<Record<string, unknown>>({});
  useEffect(() => {
    const stored = loadStoredGameType();
    if (stored !== "x01") {
      setGameType(stored);
      setGameConfig(defaultConfigFor(stored));
    }
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [boards, setBoards] = useState<ScoliaBoardOption[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState(MANUAL_BOARD_VALUE);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const boardsRequestInFlight = useRef(false);
  const [enabledLocations, setEnabledLocations] =
    useState<LocationValue[]>(loadEnabledLocations);

  const loadBoards = useCallback(async (initialLoad = false) => {
    if (boardsRequestInFlight.current) return;
    boardsRequestInFlight.current = true;
    try {
      const result = await apiRequest<{ boards: ScoliaBoardOption[] }>("/api/scolia/boards/available", { method: "GET" });
      setBoards(result.boards);
      setBoardsError(null);
    } catch (error) {
      setBoardsError(error instanceof Error ? error.message : "Failed to load Scolia boards");
    } finally {
      boardsRequestInFlight.current = false;
      if (initialLoad) setBoardsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPlayers = async () => {
      const supabase = await getSupabaseClient();
      const { data } = await supabase
        .from("players")
        .select("*")
        .eq("is_active", true)
        .order("display_name");
      if (!cancelled) setPlayers((data as Player[]) ?? []);
    };
    void loadPlayers();
    void loadBoards(true);
    return () => {
      cancelled = true;
    };
  }, [loadBoards]);

  useScoliaBoardRealtime({
    onUpsert: (status) => setBoards((current) => {
      const existing = current.find((board) => board.id === status.boardId);
      const next = current.filter((board) => board.id !== status.boardId);
      next.push(optionFromStatus(status, existing));
      return next.sort((a, b) => a.name.localeCompare(b.name));
    }),
    onRemove: (boardId) => setBoards((current) => current.filter((board) => board.id !== boardId)),
    onOccupancyChange: () => void loadBoards(false),
    onReconcile: () => void loadBoards(false),
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      setBoards((current) => {
        let changed = false;
        const next = current.map((board) => {
          if (board.workerConnectionStatus === 'disconnected' || hasFreshScoliaHeartbeat(board)) return board;
          changed = true;
          return { ...board, workerConnectionStatus: 'disconnected' as const, selectable: false };
        });
        return changed ? next : current;
      });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabledLocations));
  }, [enabledLocations]);

  function toggleLocation(loc: LocationValue) {
    setEnabledLocations((prev) => {
      const next = prev.includes(loc)
        ? prev.filter((l) => l !== loc)
        : [...prev, loc];
      // Deselect players that will be hidden by the new filter
      const hiddenIds = new Set(
        players
          .filter(
            (p) =>
              p.location !== null &&
              !next.includes(p.location as LocationValue),
          )
          .map((p) => p.id),
      );
      if (hiddenIds.size > 0) {
        setSelectedIds((ids) => ids.filter((id) => !hiddenIds.has(id)));
      }
      return next;
    });
  }

  const filteredPlayers = players.filter(
    (p) =>
      p.location === null ||
      enabledLocations.includes(p.location as LocationValue),
  );

  async function createPlayer() {
    const name = newName.trim();
    if (!name) return;
    try {
      const result = await apiRequest<{ player: Player }>("/api/players", {
        body: { displayName: name },
      });
      setPlayers((prev) => [...prev, result.player]);
      setSelectedIds((prev) => [...prev, result.player.id]);
      setNewName("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create player";
      alert(message);
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function changeGameType(type: GameType) {
    setGameType(type);
    setGameConfig(type === "x01" ? {} : defaultConfigFor(type));
    setSubmitError(null);
    storeGameType(type);
  }

  // Drop Killer number assignments for players who are no longer selected.
  useEffect(() => {
    if (gameType !== "killer") return;
    setGameConfig((config) => {
      const assigned = config.assignedNumbers as Record<string, number> | undefined;
      if (!assigned) return config;
      const stale = Object.keys(assigned).filter((id) => !selectedIds.includes(id));
      if (stale.length === 0) return config;
      const next = { ...assigned };
      for (const id of stale) delete next[id];
      return { ...config, assignedNumbers: next };
    });
  }, [gameType, selectedIds]);

  const gameMode: GameMode | null = gameType === "x01" ? null : gameType;
  const validationError = gameMode ? validateGameSelection(gameMode, gameConfig, selectedIds) : null;
  const killerHint = gameMode === "killer" && selectedIds.length > 0 && selectedIds.length < 3;
  const selectedPlayers = selectedIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => Boolean(p))
    .map((p) => ({ id: p.id, name: p.display_name }));

  async function onStartGame(mode: GameMode) {
    const problem = validateGameSelection(mode, gameConfig, selectedIds);
    if (problem) {
      setSubmitError(problem);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await apiRequest<{ gameId: string }>("/api/games", {
        body: {
          mode,
          config: gameConfig,
          playerIds: selectedIds,
          scoliaBoardId:
            selectedBoardId === MANUAL_BOARD_VALUE ? null : selectedBoardId,
        },
      });
      router.push(`/game/${result.gameId}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : `Failed to start ${GAME_MODE_INFO[mode].name}`,
      );
      setSubmitting(false);
    }
  }

  async function onStart() {
    if (gameMode) return onStartGame(gameMode);
    if (selectedIds.length < 2) return alert("Select at least 2 players");
    setSubmitting(true);
    try {
      const result = await apiRequest<{ matchId: string }>("/api/matches", {
        body: {
          startScore: parseInt(startScore, 10),
          finishRule: finish,
          legsToWin,
          fairEnding: legsToWin === 1 ? fairEnding : false,
          playerIds: selectedIds,
          scoliaBoardId:
            selectedBoardId === MANUAL_BOARD_VALUE ? null : selectedBoardId,
        },
      });
      router.push(`/match/${result.matchId}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create match";
      alert(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <h1 className="text-2xl font-semibold">New Game</h1>
      <div className="space-y-3">
        <div className="font-medium">Game type</div>
        <GameTypePicker value={gameType} onChange={changeGameType} />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium">Players</div>
          <div className="flex gap-1">
            {LOCATIONS.map((loc) => (
              <Button
                key={loc.value}
                type="button"
                size="sm"
                variant={
                  enabledLocations.includes(loc.value) ? "default" : "outline"
                }
                onClick={() => toggleLocation(loc.value)}
              >
                {loc.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filteredPlayers.map((p) => {
            const loc = LOCATIONS.find((l) => l.value === p.location);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-2 border p-2 rounded ${selectedIds.includes(p.id) ? "border-accent bg-accent/30" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span>{p.display_name}</span>
                {loc && (
                  <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {loc.label}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Input
            className="flex-1"
            placeholder="New player name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button onClick={createPlayer}>Add player</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <div className="font-medium mb-1">Board</div>
          <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select board" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MANUAL_BOARD_VALUE}>Manual scoring</SelectItem>
              {boards.map((board) => (
                <SelectItem
                  key={board.id}
                  value={board.id}
                  disabled={!board.selectable}
                >
                  {board.name} — Scolia:{" "}
                  {titleCaseStatus(board.workerConnectionStatus)} · Board:{" "}
                  {board.boardStatus ?? "Unknown"}
                  {board.activeMatchId || board.activeGameSessionId ? " · In use" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {boardsLoading ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Loading Scolia boards…
            </p>
          ) : boardsError ? (
            <p className="mt-1 text-xs text-destructive">
              {boardsError}. Manual scoring is still available.
            </p>
          ) : boards.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              No Scolia boards configured. Manual scoring is available.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Only connected, ready boards can start a Scolia game.
            </p>
          )}
        </div>
        {gameMode === null && (
        <>
        <div>
          <div className="font-medium mb-1">Start score</div>
          <Select
            value={startScore}
            onValueChange={(v) => setStartScore(v as StartScore)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Start score" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="201">201</SelectItem>
              <SelectItem value="301">301</SelectItem>
              <SelectItem value="501">501</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="font-medium mb-1">Finish rule</div>
          <Select
            value={finish}
            onValueChange={(v) => setFinish(v as FinishRule)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Finish rule" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="double_out">Double out</SelectItem>
              <SelectItem value="single_out">Single out</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="font-medium mb-1">Legs to win</div>
          <div className="flex items-stretch gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLegsToWin((v) => {
                  const next = Math.max(1, v - 1);
                  if (next !== 1) setFairEnding(false);
                  return next;
                });
              }}
            >
              −
            </Button>
            <Input
              readOnly
              className="text-center select-none"
              value={String(legsToWin)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLegsToWin((v) => {
                  const next = v + 1;
                  if (next !== 1) setFairEnding(false);
                  return next;
                });
              }}
            >
              +
            </Button>
          </div>
        </div>
        </>
        )}
      </div>

      {gameMode !== null && (
        <>
          <GameConfigFields
            mode={gameMode}
            config={gameConfig}
            onChange={(next) => {
              setGameConfig(next);
              setSubmitError(null);
            }}
            players={selectedPlayers}
          />
          {killerHint && (
            <p className="text-sm text-amber-500">Killer is best with 3 or more players.</p>
          )}
          {(submitError ?? (selectedIds.length > 0 ? validationError : null)) && (
            <p className="text-sm text-destructive">
              {submitError ?? validationError}
            </p>
          )}
        </>
      )}

      {gameMode === null && legsToWin === 1 && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={fairEnding}
            onChange={(e) => setFairEnding(e.target.checked)}
          />
          <span className="text-sm">
            Fair ending — all players complete the round before a winner is
            declared
          </span>
        </label>
      )}

      <div className="flex gap-3">
        <Button
          onClick={onStart}
          disabled={submitting || (gameMode !== null && validationError !== null)}
        >
          {submitting
            ? "Starting…"
            : gameMode === null
              ? "Start match"
              : `Start ${gameTypeName(gameMode)}`}
        </Button>
      </div>
    </div>
  );
}
