"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { apiRequest } from "@/lib/apiClient";
import { useScoliaBoardRealtime } from "@/hooks/useScoliaBoardRealtime";
import {
  hasFreshScoliaHeartbeat,
  isScoliaBoardReady,
} from "@/lib/scolia/availability";
import type {
  ScoliaBoardOption,
  ScoliaBoardPublicStatus,
} from "@/lib/scolia/types";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Search, X } from "lucide-react";
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
  loadStoredSetup,
  storeSetup,
  validateGameSelection,
  type GameType,
} from "@/components/games/NewGameOptions";
import {
  BoardPicker,
  MANUAL_BOARD_VALUE,
  loadStoredBoardId,
  storeBoardId,
} from "@/components/games/BoardPicker";
import { PlayerAvatar } from "@/components/PlayerAvatar";

type Player = { id: string; display_name: string; location: string | null; avatar_url?: string | null };

type StartScore = "201" | "301" | "501";

type FinishRule = "single_out" | "double_out";

const STORAGE_KEY = "match-location-filter";
function optionFromStatus(
  status: ScoliaBoardPublicStatus,
  current?: ScoliaBoardOption,
): ScoliaBoardOption {
  const activeMatchId = current?.activeMatchId ?? null;
  const activeGameSessionId = current?.activeGameSessionId ?? null;
  const workerConnectionStatus = hasFreshScoliaHeartbeat(status)
    ? status.workerConnectionStatus
    : "disconnected";
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
      if (Array.isArray(parsed)) return parsed.filter((value) => LOCATIONS.some((location) => location.value === value));
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
  const [playerSearch, setPlayerSearch] = useState("");
  const [startScore, setStartScore] = useState<StartScore>("301");
  const [finish, setFinish] = useState<FinishRule>("single_out");
  const [legsToWin, setLegsToWin] = useState(1);
  const [fairEnding, setFairEnding] = useState(false);
  // Start on X01 for SSR and pick up the stored choice after hydration.
  const [gameType, setGameType] = useState<GameType>("x01");
  const [gameConfig, setGameConfig] = useState<Record<string, unknown>>({});
  const [setupLoaded, setSetupLoaded] = useState(false);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  useEffect(() => {
    const setup = loadStoredSetup();
    if (setup) {
      setGameType(setup.gameType);
      setGameConfig(setup.gameConfig);
      setSelectedIds(setup.selectedIds);
      setStartScore(setup.startScore);
      setFinish(setup.finish);
      setLegsToWin(setup.legsToWin);
      setFairEnding(setup.fairEnding);
    } else {
      const stored = loadStoredGameType();
      if (stored !== "x01") {
        setGameType(stored);
        setGameConfig(defaultConfigFor(stored));
      }
    }
    setSetupLoaded(true);
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [boards, setBoards] = useState<ScoliaBoardOption[]>([]);
  // Start on manual for SSR and pick up the last chosen board after hydration.
  const [selectedBoardId, setSelectedBoardId] = useState(MANUAL_BOARD_VALUE);
  useEffect(() => {
    const stored = loadStoredBoardId();
    if (stored !== MANUAL_BOARD_VALUE) setSelectedBoardId(stored);
  }, []);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const boardsRequestInFlight = useRef(false);
  // Start with every location for SSR and pick up the stored filter after hydration.
  const [enabledLocations, setEnabledLocations] = useState<LocationValue[]>(
    () => LOCATIONS.map((l) => l.value),
  );
  useEffect(() => {
    setEnabledLocations(loadEnabledLocations());
  }, []);

  const loadBoards = useCallback(async (initialLoad = false) => {
    if (boardsRequestInFlight.current) return;
    boardsRequestInFlight.current = true;
    try {
      const result = await apiRequest<{ boards: ScoliaBoardOption[] }>(
        "/api/scolia/boards/available",
        { method: "GET" },
      );
      setBoards(result.boards);
      setBoardsError(null);
    } catch (error) {
      setBoardsError(
        error instanceof Error ? error.message : "Failed to load Scolia boards",
      );
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
      if (!cancelled && data) {
        const activePlayers = data as Player[];
        setPlayers(activePlayers);
        const activeIds = new Set(activePlayers.map((player) => player.id));
        setSelectedIds((ids) => ids.filter((id) => activeIds.has(id)));
        setPlayersLoaded(true);
      }
    };
    void loadPlayers();
    void loadBoards(true);
    return () => {
      cancelled = true;
    };
  }, [loadBoards]);

  useEffect(() => {
    // Do not overwrite saved players before hydration and roster reconciliation.
    if (!setupLoaded || !playersLoaded) return;
    storeSetup({ gameType, gameConfig, selectedIds, startScore, finish, legsToWin, fairEnding });
  }, [setupLoaded, playersLoaded, gameType, gameConfig, selectedIds, startScore, finish, legsToWin, fairEnding]);

  useScoliaBoardRealtime({
    onUpsert: (status) =>
      setBoards((current) => {
        const existing = current.find((board) => board.id === status.boardId);
        const next = current.filter((board) => board.id !== status.boardId);
        next.push(optionFromStatus(status, existing));
        return next.sort((a, b) => a.name.localeCompare(b.name));
      }),
    onRemove: (boardId) =>
      setBoards((current) => current.filter((board) => board.id !== boardId)),
    onOccupancyChange: () => void loadBoards(false),
    onReconcile: () => void loadBoards(false),
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      setBoards((current) => {
        let changed = false;
        const next = current.map((board) => {
          if (
            board.workerConnectionStatus === "disconnected" ||
            hasFreshScoliaHeartbeat(board)
          )
            return board;
          changed = true;
          return {
            ...board,
            workerConnectionStatus: "disconnected" as const,
            selectable: false,
          };
        });
        return changed ? next : current;
      });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  // Fall back to manual scoring if the chosen board goes offline or gets taken.
  // Waits for the first board load so a remembered board is not wiped early.
  // The stored preference is kept so the board is reselected once it is back.
  useEffect(() => {
    if (boardsLoading || selectedBoardId === MANUAL_BOARD_VALUE) return;
    const board = boards.find((b) => b.id === selectedBoardId);
    if (!board || !board.selectable) setSelectedBoardId(MANUAL_BOARD_VALUE);
  }, [boards, boardsLoading, selectedBoardId]);

  function chooseBoard(boardId: string) {
    setSelectedBoardId(boardId);
    storeBoardId(boardId);
  }

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
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const locationPlayers = players.filter(
    (p) =>
      p.location === null ||
      enabledLocations.includes(p.location as LocationValue),
  );
  const searchTerm = playerSearch.trim().toLowerCase();
  const filteredPlayers = searchTerm
    ? locationPlayers.filter((p) =>
        p.display_name.toLowerCase().includes(searchTerm),
      )
    : locationPlayers;
  const searchMatchesExisting = players.some(
    (p) => p.display_name.trim().toLowerCase() === searchTerm,
  );

  async function createPlayer(nameOverride?: string) {
    const name = (nameOverride ?? newName).trim();
    if (!name) return;
    try {
      const result = await apiRequest<{ player: Player }>("/api/players", {
        body: { displayName: name },
      });
      setPlayers((prev) => [...prev, result.player]);
      setSelectedIds((prev) => [...prev, result.player.id]);
      setNewName("");
      setPlayerSearch("");
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
      const assigned = config.assignedNumbers as
        Record<string, number> | undefined;
      if (!assigned) return config;
      const stale = Object.keys(assigned).filter(
        (id) => !selectedIds.includes(id),
      );
      if (stale.length === 0) return config;
      const next = { ...assigned };
      for (const id of stale) delete next[id];
      return { ...config, assignedNumbers: next };
    });
  }, [gameType, selectedIds]);

  const gameMode: GameMode | null = gameType === "x01" ? null : gameType;
  const validationError = gameMode
    ? validateGameSelection(gameMode, gameConfig, selectedIds)
    : null;
  const killerHint =
    gameMode === "killer" && selectedIds.length > 0 && selectedIds.length < 3;
  const selectedPlayers = selectedIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => Boolean(p))
    .map((p) => ({ id: p.id, name: p.display_name, display_name: p.display_name, avatar_url: p.avatar_url }));

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
        error instanceof Error
          ? error.message
          : `Failed to start ${GAME_MODE_INFO[mode].name}`,
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
    <div className="w-full space-y-5 px-4 pt-4 pb-44 md:px-6 lg:px-8">
      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5 rounded-2xl bg-slate-900/40 p-4 [&_button[data-slot=select-trigger]]:border-white/10 [&_input]:border-white/10 [&_button[data-variant=outline]]:border-white/10">
          <h1 className="text-3xl font-black tracking-tight">New Game</h1>
          <div className="space-y-2">
            <div className="font-medium">Game type</div>
            <GameTypePicker value={gameType} onChange={changeGameType} />
          </div>

          <div className="space-y-2">
            <div className="font-medium">Board</div>
            <BoardPicker
              boards={boards}
              value={selectedBoardId}
              onChange={chooseBoard}
              loading={boardsLoading}
            />
            {boardsError ? (
              <p className="text-xs text-destructive">
                {boardsError}. Manual scoring is still available.
              </p>
            ) : null}
          </div>

          {gameMode === null && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
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
                      className="border-white/10 bg-white/5 hover:bg-white/10"
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
                      className="border-white/10 bg-white/5 hover:bg-white/10"
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
              </div>
              {legsToWin === 1 && (
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
            </div>
          )}

          {gameMode !== null && (
            <GameConfigFields
              mode={gameMode}
              config={gameConfig}
              onChange={(next) => {
                setGameConfig(next);
                setSubmitError(null);
              }}
              players={selectedPlayers}
            />
          )}

        </div>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="mr-auto shrink-0 whitespace-nowrap text-2xl font-extrabold tracking-tight">
              Players
              <span className="ml-3 text-sm font-semibold tracking-normal text-sky-300" aria-live="polite">
                {selectedIds.length} selected
              </span>
            </div>
            <div className="flex gap-1" role="group" aria-label="Location filter">
              {LOCATIONS.map((loc) => (
                <Button
                  key={loc.value}
                  type="button"
                  size="sm"
                  variant="outline"
                  className={enabledLocations.includes(loc.value) ? "border border-sky-400/20 bg-sky-400/10 font-bold text-sky-300 hover:bg-sky-400/20" : "border border-white/10 bg-transparent font-bold text-slate-400 hover:bg-white/5"}
                  aria-pressed={enabledLocations.includes(loc.value)}
                  onClick={() => toggleLocation(loc.value)}
                >
                  {loc.label}
                </Button>
              ))}
            </div>
            <div className="relative w-full max-w-80 min-w-0 xl:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                inputMode="search"
                autoComplete="off"
                className="h-12 rounded-xl border-white/10 bg-slate-900/50 pl-9 text-base"
                placeholder="Search players"
                aria-label="Search players"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (filteredPlayers.length === 1) {
                    toggle(filteredPlayers[0].id);
                    setPlayerSearch("");
                  } else if (
                    filteredPlayers.length === 0 &&
                    searchTerm &&
                    !searchMatchesExisting
                  ) {
                    void createPlayer(playerSearch);
                  }
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:max-h-[calc(100dvh-324px)] lg:min-h-64 lg:overflow-y-auto 2xl:grid-cols-3">
            {filteredPlayers.map((p) => {
              const loc = LOCATIONS.find((l) => l.value === p.location);
              const checked = selectedIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggle(p.id)}
                  className={`flex min-h-24 min-w-0 cursor-pointer items-center gap-4 rounded-2xl border-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${checked ? "border-sky-300/70 bg-sky-400/10 text-sky-200 shadow-[inset_0_0_18px_rgba(56,189,248,0.12)] hover:bg-sky-400/20" : "border-white/[0.06] bg-slate-900/60 text-slate-100 hover:border-sky-300/40 hover:bg-slate-800/70"}`}
                >
                  <PlayerAvatar player={p} size="xl" className="size-16 text-xl ring-2 ring-white/10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-2xl font-black tracking-tight xl:text-[28px]">{p.display_name}</span>
                    {loc && (
                      <span className={`mt-0.5 block text-xs font-semibold tracking-wide ${checked ? "text-sky-300/70" : "text-slate-500"}`}>
                        {loc.label}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {filteredPlayers.length === 0 && (
              <p className="col-span-full py-3 text-center text-sm text-muted-foreground">
                {searchTerm
                  ? `No players match “${playerSearch.trim()}”.`
                  : "No players in the selected locations."}
              </p>
            )}
          </div>

          {gameMode !== null && (
            <>
              {killerHint && (
                <p className="text-sm text-amber-500">
                  Killer is best with 3 or more players.
                </p>
              )}
              {(submitError ??
                (selectedIds.length > 0 ? validationError : null)) && (
                <p className="text-sm text-destructive">
                  {submitError ?? validationError}
                </p>
              )}
            </>
          )}

          <div className="fixed inset-x-7 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 rounded-t-2xl bg-background/95 px-1 pt-3 pb-3 shadow-[0_-12px_32px_rgba(3,7,18,0.8)] backdrop-blur-xl md:inset-x-12 lg:right-14 lg:bottom-0 lg:left-[376px] xl:left-[408px]">
            <div className="mb-3">
{searchTerm && !searchMatchesExisting ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void createPlayer(playerSearch)}
            >
              Add “{playerSearch.trim()}” as a new player
            </Button>
          ) : (
            <div className="flex gap-2">
              <Input
                className="flex-1 border-white/10 bg-slate-900/40"
                placeholder="New player name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void createPlayer();
                  }
                }}
              />
              <Button type="button" className="border border-white/10 bg-slate-800 font-semibold text-slate-200 hover:bg-slate-700" onClick={() => void createPlayer()}>
                Add player
              </Button>
            </div>
          )}
            </div>
            <div className="start-action-bar grid grid-cols-2 items-center gap-3">
            <div className="flex h-16 min-w-0 items-center justify-center px-3" aria-label="Selected players">
              <div className="flex w-full items-center" style={{ maxWidth: selectedPlayers.length ? selectedPlayers.length * 56 - 8 : undefined }}>
              {selectedIds.length === 0 && <span className="w-full text-center text-xs text-slate-500">Choose your lineup</span>}
              {selectedPlayers.map((p, index) => (
                <div key={p.id} style={{ animationDelay: `${-index * 0.09}s` }} className="lineup-avatar-slot relative min-w-0 flex-[1_1_56px] last:flex-[0_0_48px] hover:z-10 focus-within:z-10">
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-label={`Remove ${p.name}`}
                  title={`${p.name} · Click to remove`}
                  style={{
                    animationDelay: `0s, ${0.56 + index * 0.28}s`,
                    animationDuration: "560ms, 6s",
                  }}
                  className="selected-lineup-avatar pointer-events-auto group relative isolate shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <PlayerAvatar player={p} size="lg" className="size-12 ring-0" />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/65 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
                    <X className="size-4" />
                  </span>
                </button>
                </div>
              ))}
            </div>
          </div>
            <Button
              size="lg"
              className="start-match-button group relative h-16 w-full min-w-0 gap-2 overflow-hidden rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 px-3 text-base font-semibold sm:px-6 sm:text-xl tracking-normal text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_24px_rgba(37,99,235,0.2)] transition-[filter,box-shadow,border-color] duration-200 hover:border-cyan-100 hover:brightness-110 hover:shadow-[inset_0_0_0_1px_rgba(165,243,252,0.8),0_0_0_2px_rgba(56,189,248,0.65),0_0_18px_rgba(56,189,248,0.65),0_0_38px_rgba(99,102,241,0.4)]"
              onClick={onStart}
              disabled={
                !setupLoaded || !playersLoaded || submitting || (gameMode !== null && validationError !== null)
              }
            >
              <span className="truncate">{submitting
                ? "Starting…"
                : gameMode === null
                  ? "Start match"
                  : `Start ${gameTypeName(gameMode)}`}</span>
              <ArrowRight className="hidden size-5 shrink-0 text-blue-100 sm:block transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden="true" />
            </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
