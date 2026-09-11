"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { apiRequest } from "@/lib/apiClient";
import { isTVModeEnabled, requestTVModeFullscreen } from "@/lib/tvMode";
import { useScoliaBoardRealtime } from "@/hooks/useScoliaBoardRealtime";
import {
  hasFreshScoliaHeartbeat,
  isScoliaBoardReady,
} from "@/lib/scolia/availability";
import {
  getManualScoringPrompt,
  type ManualScoringPrompt,
} from "@/lib/scolia/manualScoringPrompt";
import type {
  ScoliaBoardOption,
  ScoliaBoardPublicStatus,
} from "@/lib/scolia/types";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowRight, UserPlus, Search, Scale, Target, Volume2 } from "lucide-react";
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
  boardShortName,
  loadStoredBoardId,
  storeBoardId,
} from "@/components/games/BoardPicker";
import { SelectedPlayerLineup } from "@/components/games/SelectedPlayerLineup";
import { PlayerAvatar } from "@/components/PlayerAvatar";

type Player = { id: string; display_name: string; location: string | null; avatar_url?: string | null; gamesPlayed?: number };

type StartScore = "201" | "301" | "501";

type FinishRule = "single_out" | "double_out";

const STORAGE_KEY = "match-location-filter";

function formatDuration(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs) || diffMs < 60_000) return "just started";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}
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
    activeGame: current?.activeGame ?? null,
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
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [addPlayerError, setAddPlayerError] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState("");
  const [startScore, setStartScore] = useState<StartScore>("301");
  const [finish, setFinish] = useState<FinishRule>("single_out");
  const [legsToWin, setLegsToWin] = useState(1);
  const [closestToBull, setClosestToBull] = useState(false);
  const [fairEnding, setFairEnding] = useState(false);
  const [commentaryEnabled, setCommentaryEnabled] = useState(false);
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
      setClosestToBull(setup.closestToBull === true);
      setCommentaryEnabled(setup.commentaryEnabled === true);
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
  // Dev-only: the API returns simulated boards, so realtime must not override them.
  const [boardsSimulated, setBoardsSimulated] = useState(false);
  const [manualPrompt, setManualPrompt] = useState<ManualScoringPrompt | null>(null);
  const [endingGameId, setEndingGameId] = useState<string | null>(null);
  const [showBoardChoice, setShowBoardChoice] = useState(false);
  const [endGameError, setEndGameError] = useState<string | null>(null);

  // Ends the match or game occupying a board so it can be used again. Once the
  // board list refreshes, the dialog recomputes and offers the freed board.
  async function endActiveGame(board: ScoliaBoardOption) {
    const matchId = board.activeMatchId;
    const gameId = board.activeGameSessionId;
    const target = matchId ? `/api/matches/${matchId}/end` : gameId ? `/api/games/${gameId}/end` : null;
    if (!target) return;
    setEndingGameId(matchId ?? gameId);
    setEndGameError(null);
    try {
      await apiRequest(target, { method: "PATCH" });
      const result = await apiRequest<{ boards: ScoliaBoardOption[] }>("/api/scolia/boards/available");
      setBoards(result.boards);
      setManualPrompt(getManualScoringPrompt(result.boards));
    } catch (error) {
      setEndGameError(error instanceof Error ? error.message : "Failed to end the game");
    } finally {
      setEndingGameId(null);
    }
  }
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const boardsRequestInFlight = useRef(false);
  // Start with every location for SSR and pick up the stored filter after hydration.
  const [includeNoLocation, setIncludeNoLocation] = useState(true);
  const [enabledLocations, setEnabledLocations] = useState<LocationValue[]>(
    () => LOCATIONS.map((l) => l.value),
  );
  useEffect(() => {
    setEnabledLocations(loadEnabledLocations());
    try {
      setIncludeNoLocation(localStorage.getItem("match-include-no-location") !== "false");
    } catch { /* Keep the default when storage is unavailable. */ }
  }, []);

  const loadBoards = useCallback(async (initialLoad = false) => {
    if (boardsRequestInFlight.current) return;
    boardsRequestInFlight.current = true;
    try {
      const result = await apiRequest<{ boards: ScoliaBoardOption[]; simulated?: boolean }>(
        "/api/scolia/boards/available",
        { method: "GET" },
      );
      setBoards(result.boards);
      setBoardsSimulated(result.simulated === true);
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
        .select("id, display_name, location, avatar_url, match_players(count), game_session_players(count)")
        .eq("is_active", true)
        .order("display_name");
      if (!cancelled && data) {
        const activePlayers: Player[] = data.map((player) => ({
          id: player.id,
          display_name: player.display_name,
          location: player.location,
          avatar_url: player.avatar_url,
          gamesPlayed: (player.match_players[0]?.count ?? 0)
            + (player.game_session_players[0]?.count ?? 0),
        }));
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
    storeSetup({ gameType, gameConfig, selectedIds, startScore, finish, legsToWin, fairEnding, closestToBull, commentaryEnabled });
  }, [setupLoaded, playersLoaded, gameType, gameConfig, selectedIds, startScore, finish, legsToWin, fairEnding, closestToBull, commentaryEnabled]);

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
  }, !boardsSimulated);

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

  function toggleNoLocation() {
    const next = !includeNoLocation;
    setIncludeNoLocation(next);
    try {
      localStorage.setItem("match-include-no-location", String(next));
    } catch { /* Filtering still works without storage. */ }
  }

  function toggleLocation(loc: LocationValue) {
    setEnabledLocations((prev) => {
      const next = prev.includes(loc)
        ? prev.filter((l) => l !== loc)
        : [...prev, loc];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const sortedPlayers = useMemo(() => [...players].sort((a, b) =>
    (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0)
      || a.display_name.localeCompare(b.display_name),
  ), [players]);
  const locationPlayers = sortedPlayers.filter(
    (p) =>
      p.location === null ? includeNoLocation :
      enabledLocations.includes(p.location as LocationValue),
  );
  const searchTerm = playerSearch.trim().toLowerCase();
  const matchingPlayers = searchTerm
    ? locationPlayers.filter((p) =>
        p.display_name.toLowerCase().includes(searchTerm),
      )
    : locationPlayers;
  const selectedPlayerIds = new Set(selectedIds);
  const matchingPlayerIds = new Set(matchingPlayers.map((player) => player.id));
  const filteredPlayers = sortedPlayers.filter((player) =>
    selectedPlayerIds.has(player.id) || matchingPlayerIds.has(player.id),
  );
  const searchMatchesExisting = players.some(
    (p) => p.display_name.trim().toLowerCase() === searchTerm,
  );

  async function createPlayer() {
    const name = newName.trim();
    if (!name || addingPlayer) return;
    setAddingPlayer(true);
    setAddPlayerError(null);
    try {
      const result = await apiRequest<{ player: Player }>("/api/players", {
        body: { displayName: name },
      });
      setPlayers((prev) => [...prev, result.player]);
      setSelectedIds((prev) => [...prev, result.player.id]);
      setNewName("");
      setAddPlayerOpen(false);
      setPlayerSearch("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create player";
      setAddPlayerError(message);
    } finally {
      setAddingPlayer(false);
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

  async function onStartGame(mode: GameMode, boardId: string) {
    const problem = validateGameSelection(mode, gameConfig, selectedIds);
    if (problem) {
      setSubmitError(problem);
      return;
    }
    requestTVModeFullscreen();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await apiRequest<{ gameId: string }>("/api/games", {
        body: {
          mode,
          config: gameConfig,
          playerIds: selectedIds,
          scoliaBoardId: boardId === MANUAL_BOARD_VALUE ? null : boardId,
        },
      });
      router.push(`/game/${result.gameId}${isTVModeEnabled() ? '?spectator=true' : ''}`);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : `Failed to start ${GAME_MODE_INFO[mode].name}`,
      );
      setSubmitting(false);
    }
  }

  /**
   * Manual scoring while a Scolia board is online is usually a mistake, so
   * confirm first. The same dialog warns when an online board already has a
   * game running, since a board can only host one game at a time.
   */
  function onStart() {
    if (selectedBoardId === MANUAL_BOARD_VALUE) {
      const prompt = getManualScoringPrompt(boards);
      if (prompt) {
        setManualPrompt(prompt);
        return;
      }
    }
    void startWithBoard(selectedBoardId);
  }

  function startWithBoard(boardId: string) {
    setManualPrompt(null);
    setShowBoardChoice(false);
    if (boardId !== MANUAL_BOARD_VALUE) chooseBoard(boardId);
    return submitWithBoard(boardId);
  }

  async function submitWithBoard(boardId: string) {
    if (gameMode) return onStartGame(gameMode, boardId);
    if (selectedIds.length < 2) return alert("Select at least 2 players");
    requestTVModeFullscreen();
    setSubmitting(true);
    try {
      const result = await apiRequest<{ matchId: string }>("/api/matches", {
        body: {
          startScore: parseInt(startScore, 10),
          finishRule: finish,
          legsToWin,
          closestToBull,
          fairEnding: legsToWin === 1 ? fairEnding : false,
          playerIds: selectedIds,
          scoliaBoardId: boardId === MANUAL_BOARD_VALUE ? null : boardId,
        },
      });
      const params = new URLSearchParams();
      if (isTVModeEnabled()) params.set('spectator', 'true');
      if (commentaryEnabled) params.set('commentary', 'true');
      router.push(`/match/${result.matchId}${params.size ? `?${params}` : ''}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create match";
      alert(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full space-y-5 px-4 pt-4 pb-32 md:px-6 lg:h-[calc(100dvh-113px)] lg:pb-0 lg:px-8">
      <div className="grid items-start gap-5 lg:h-full lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)] xl:gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5 rounded-2xl bg-slate-900/40 p-4 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin] [&_button[data-slot=select-trigger]]:border-white/10 [&_input]:border-white/10 [&_button[data-variant=outline]]:border-white/10">
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
              <div className="space-y-2">
                {legsToWin === 1 && (
                  <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${fairEnding ? "border-cyan-400/30 bg-cyan-400/10" : "border-white/10 bg-white/[0.03] hover:bg-white/5"}`}>
                    <Scale className={`h-5 w-5 shrink-0 ${fairEnding ? "text-cyan-300" : "text-slate-400"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">Fair ending</span>
                      <span id="fair-ending-description" className="mt-0.5 block text-xs leading-relaxed text-slate-400">Everyone finishes the round before a winner is declared.</span>
                    </span>
                    <Switch aria-label="Fair ending" aria-describedby="fair-ending-description" checked={fairEnding} onCheckedChange={setFairEnding} className="data-[state=checked]:bg-cyan-400" />
                  </label>
                )}
                <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${closestToBull ? "border-cyan-400/30 bg-cyan-400/10" : "border-white/10 bg-white/[0.03] hover:bg-white/5"}`}>
                  <Target className={`h-5 w-5 shrink-0 transition-colors ${closestToBull ? "text-cyan-300" : "text-slate-400"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">Bull-off</span>
                    <span id="bull-off-description" className="mt-0.5 block text-xs leading-relaxed text-slate-400">One dart each decides the order. Tied players throw again.</span>
                  </span>
                  <Switch aria-label="Bull-off" aria-describedby="bull-off-description" checked={closestToBull} onCheckedChange={setClosestToBull} className="data-[state=checked]:bg-cyan-400" />
                </label>
                <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${commentaryEnabled ? "border-cyan-400/30 bg-cyan-400/10" : "border-white/10 bg-white/[0.03] hover:bg-white/5"}`}>
                  <Volume2 className={`h-5 w-5 shrink-0 ${commentaryEnabled ? "text-cyan-300" : "text-slate-400"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">Commentary</span>
                    <span id="commentary-description" className="mt-0.5 block text-xs leading-relaxed text-slate-400">Automatically play live commentary in spectator mode.</span>
                  </span>
                  <Switch aria-label="Commentary" aria-describedby="commentary-description" checked={commentaryEnabled} onCheckedChange={setCommentaryEnabled} className="data-[state=checked]:bg-cyan-400" />
                </label>
              </div>
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
        <div className="min-w-0 space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:pb-28">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div className="mr-auto shrink-0 whitespace-nowrap text-2xl font-extrabold tracking-tight">
              Players
              <span className="ml-3 text-sm font-semibold tracking-normal text-sky-300" aria-live="polite">
                {selectedIds.length} selected
              </span>
            </div>
            <Dialog open={addPlayerOpen} onOpenChange={(open) => {
              if (addingPlayer) return;
              setAddPlayerOpen(open);
              setAddPlayerError(null);
              if (open) setNewName(playerSearch.trim());
            }}>
              <DialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="shrink-0 gap-2 text-slate-400 hover:bg-white/5 hover:text-slate-300">
                  <UserPlus className="size-4" aria-hidden="true" />
                  Add player
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!addingPlayer}>
                <DialogHeader>
                  <DialogTitle>Add player</DialogTitle>
                  <DialogDescription>Create a new player and add them to your lineup.</DialogDescription>
                </DialogHeader>
                <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void createPlayer(); }}>
                  <div className="space-y-2">
                    <label htmlFor="new-player-name" className="text-sm font-medium">Player name</label>
                    <Input id="new-player-name" placeholder="New player name" value={newName} onChange={(event) => setNewName(event.target.value)} disabled={addingPlayer} autoComplete="off" className="border-white/10 bg-slate-900/40" />
                  </div>
                  {addPlayerError && <p role="alert" className="text-sm text-destructive">{addPlayerError}</p>}
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setAddPlayerOpen(false)} disabled={addingPlayer}>Cancel</Button>
                    <Button type="submit" disabled={!newName.trim() || addingPlayer}>{addingPlayer ? 'Adding…' : 'Add player'}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Location filter">
              {LOCATIONS.map((loc) => (
                <Button
                  key={loc.value}
                  type="button"
                  size="sm"
                  variant="outline"
                  className={enabledLocations.includes(loc.value) ? "border border-sky-400/20 bg-sky-400/10 font-bold text-sky-300 hover:bg-sky-400/20 hover:text-sky-300" : "border border-white/10 bg-transparent font-bold text-slate-400 hover:bg-white/5 hover:text-slate-300"}
                  aria-pressed={enabledLocations.includes(loc.value)}
                  onClick={() => toggleLocation(loc.value)}
                >
                  {loc.label}
                </Button>
              ))}
              <Button type="button" size="sm" variant="outline" aria-pressed={includeNoLocation} onClick={toggleNoLocation} className={includeNoLocation ? "border-sky-400/20 bg-sky-400/10 font-bold text-sky-300 hover:bg-sky-400/20 hover:text-sky-300" : "border-white/10 bg-transparent text-slate-400 hover:bg-white/5 hover:text-slate-300"}>
                No location
              </Button>
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
                  if (matchingPlayers.length === 1) {
                    if (!selectedPlayerIds.has(matchingPlayers[0].id)) toggle(matchingPlayers[0].id);
                    setPlayerSearch("");
                  } else if (
                    matchingPlayers.length === 0 &&
                    searchTerm &&
                    !searchMatchesExisting
                  ) {
                    setNewName(playerSearch.trim());
                    setAddPlayerError(null);
                    setAddPlayerOpen(true);
                  }
                }}
              />
            </div>
          </div>
          <div className="grid min-h-0 grid-cols-1 content-start gap-2.5 min-[480px]:grid-cols-2 md:grid-cols-3 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain xl:grid-cols-4">
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
                    <span title={p.display_name} className="block truncate text-2xl font-black tracking-tight xl:text-[28px]">{p.display_name}</span>
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
            <div className="start-action-bar grid grid-cols-2 items-center gap-3">
            <SelectedPlayerLineup players={selectedPlayers} onRemove={toggle} />
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
      <Dialog
        open={manualPrompt !== null}
        onOpenChange={(open) => {
          if (!open) {
            setManualPrompt(null);
            setShowBoardChoice(false);
            setEndGameError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-xs" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Score manually?</DialogTitle>
          </DialogHeader>

          {manualPrompt && manualPrompt.busyBoards.length > 0 && (
            <div className="space-y-1">
              {manualPrompt.busyBoards.map((board) => {
                const game = board.activeGame ?? null;
                const busyId = board.activeMatchId ?? board.activeGameSessionId;
                return (
                  <div key={board.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span aria-hidden className="inline-block size-1.5 rounded-full bg-amber-400" />
                    <span className="flex-1 truncate">
                      {boardShortName(board.name)} in use
                      {game && game.players.length > 0 ? ` · ${game.players.join(" vs ")}` : ""}
                      {game ? ` · ${formatDuration(game.startedAt)}` : ""}
                    </span>
                    <button
                      type="button"
                      className="text-red-300 underline-offset-2 hover:underline disabled:opacity-50"
                      disabled={endingGameId !== null}
                      onClick={() => void endActiveGame(board)}
                    >
                      {endingGameId === busyId ? "Ending…" : "End"}
                    </button>
                  </div>
                );
              })}
              {endGameError && <p className="text-xs text-destructive">{endGameError}</p>}
            </div>
          )}

          {manualPrompt && manualPrompt.readyBoards.length > 0 && showBoardChoice && (
            <div className="space-y-2">
              {manualPrompt.readyBoards.map((board) => (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => void startWithBoard(board.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-left font-semibold transition-colors hover:border-sky-300/50 hover:bg-sky-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden className="inline-block size-2 rounded-full bg-emerald-400" />
                  <span className="flex-1 truncate">{boardShortName(board.name)}</span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {manualPrompt && manualPrompt.readyBoards.length > 0 && !showBoardChoice && (
              <Button className="w-full" onClick={() => setShowBoardChoice(true)}>
                Add board
              </Button>
            )}
            <Button
              variant={manualPrompt && manualPrompt.readyBoards.length > 0 ? "ghost" : "default"}
              className="w-full"
              onClick={() => void startWithBoard(MANUAL_BOARD_VALUE)}
            >
              Score manually
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
