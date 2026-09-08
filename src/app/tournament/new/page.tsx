"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { apiRequest } from '@/lib/apiClient';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LOCATIONS, type LocationValue } from '@/utils/locations';
import { ArrowRight, Search, Scale, Trophy, Volume2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { BoardPicker, MANUAL_BOARD_VALUE, loadStoredBoardId, storeBoardId } from '@/components/games/BoardPicker';
import type { ScoliaBoardOption } from '@/lib/scolia/types';
import { useScoliaBoardRealtime } from '@/hooks/useScoliaBoardRealtime';
import { requestTVModeFullscreen } from '@/lib/tvMode';
import { SelectedPlayerLineup } from '@/components/games/SelectedPlayerLineup';
import { PlayerAvatar } from '@/components/PlayerAvatar';

type Player = { id: string; display_name: string; location: string | null; avatar_url?: string | null };
type StartScore = '201' | '301' | '501';
type FinishRule = 'single_out' | 'double_out';

const STORAGE_KEY = 'match-location-filter';
const COMMENTARY_STORAGE_KEY = 'tournament-auto-commentary';

function loadEnabledLocations(): LocationValue[] {
  if (typeof window === 'undefined') return LOCATIONS.map((l) => l.value);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as LocationValue[];
      if (Array.isArray(parsed)) return parsed.filter((value) => LOCATIONS.some((location) => location.value === value));
    }
  } catch { /* ignore */ }
  return LOCATIONS.map((l) => l.value);
}

export default function NewTournamentPage() {
  const router = useRouter();
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [startScore, setStartScore] = useState<StartScore>('301');
  const [finish, setFinish] = useState<FinishRule>('single_out');
  const [legsToWin, setLegsToWin] = useState(1);
  const [fairEnding, setFairEnding] = useState(false);
  const [enabledLocations, setEnabledLocations] = useState<LocationValue[]>(() => LOCATIONS.map((location) => location.value));
  const [locationsLoaded, setLocationsLoaded] = useState(false);

  useEffect(() => {
    setEnabledLocations(loadEnabledLocations());
    setLocationsLoaded(true);
  }, []);
  const [creating, setCreating] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState(MANUAL_BOARD_VALUE);
  const [boards, setBoards] = useState<ScoliaBoardOption[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [commentaryEnabled, setCommentaryEnabled] = useState(false);
  const boardsRequestInFlight = useRef(false);

  useEffect(() => {
    setSelectedBoardId(loadStoredBoardId());
    try { setCommentaryEnabled(localStorage.getItem(COMMENTARY_STORAGE_KEY) === 'true'); } catch { /* optional preference */ }
  }, []);

  const loadBoards = useCallback(async () => {
    if (boardsRequestInFlight.current) return;
    boardsRequestInFlight.current = true;
    try {
      const result = await apiRequest<{ boards: ScoliaBoardOption[] }>('/api/scolia/boards/available', { method: 'GET' });
      setBoards(result.boards);
      setBoardsError(null);
    } catch (error) {
      setBoardsError(error instanceof Error ? error.message : 'Failed to load boards');
    } finally {
      boardsRequestInFlight.current = false;
      setBoardsLoading(false);
    }
  }, []);
  useEffect(() => { void loadBoards(); }, [loadBoards]);
  useScoliaBoardRealtime({ onUpsert: loadBoards, onRemove: loadBoards, onOccupancyChange: loadBoards, onReconcile: loadBoards });
  const boardUnavailable = selectedBoardId !== MANUAL_BOARD_VALUE
    && (boardsLoading || Boolean(boardsError) || !boards.some((board) => board.id === selectedBoardId && board.selectable));

  useEffect(() => {
    (async () => {
      const supabase = await getSupabaseClient();
      const { data } = await supabase.from('players').select('*').eq('is_active', true).order('display_name');
      setPlayers((data as Player[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    if (!locationsLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(enabledLocations));
    } catch { /* Keep filters usable when browser storage is unavailable. */ }
  }, [enabledLocations, locationsLoaded]);

  function toggleLocation(loc: LocationValue) {
    setEnabledLocations((prev) => {
      const next = prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc];
      const hiddenIds = new Set(
        players
          .filter((p) => p.location !== null && !next.includes(p.location as LocationValue))
          .map((p) => p.id)
      );
      if (hiddenIds.size > 0) {
        setSelectedIds((ids) => ids.filter((id) => !hiddenIds.has(id)));
      }
      return next;
    });
  }

  const filteredPlayers = players.filter(
    (p) => (p.location === null || enabledLocations.includes(p.location as LocationValue))
      && p.display_name.toLocaleLowerCase().includes(playerSearch.trim().toLocaleLowerCase())
  );

  const selectedPlayers = selectedIds.flatMap((id) => {
    const player = players.find((entry) => entry.id === id);
    return player ? [player] : [];
  });

  async function createPlayer() {
    const trimmed = newPlayerName.trim();
    if (!trimmed) return;
    try {
      const result = await apiRequest<{ player: Player }>('/api/players', { body: { displayName: trimmed } });
      setPlayers((prev) => [...prev, result.player]);
      setSelectedIds((prev) => [...prev, result.player.id]);
      setNewPlayerName('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create player';
      alert(message);
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onStart() {
    if (selectedIds.length < 3) return alert('Select at least 3 players for a tournament');
    if (!name.trim()) return alert('Enter a tournament name');
    if (boardUnavailable) return;
    requestTVModeFullscreen();
    setCreating(true);
    try {
      const result = await apiRequest<{ tournamentId: string }>('/api/tournaments', {
        body: {
          name: name.trim(),
          startScore: parseInt(startScore, 10),
          finishRule: finish,
          legsToWin,
          fairEnding: legsToWin === 1 ? fairEnding : false,
          playerIds: selectedIds,
          scoliaBoardId: selectedBoardId === MANUAL_BOARD_VALUE ? null : selectedBoardId,
          commentaryEnabled,
        },
      });
      router.push(`/tournament/${result.tournamentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create tournament';
      alert(message);
      setCreating(false);
    }
  }

  return (
    <div className="w-full px-4 pt-4 pb-52 md:px-6 lg:h-[calc(100dvh-113px)] lg:pb-0 lg:px-8">
      <div className="grid items-start gap-5 lg:h-full lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)] xl:gap-8">
        <section aria-label="Tournament settings" className="min-w-0 space-y-5 rounded-2xl bg-slate-900/40 p-4 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin]">
          <div>
            <h1 className="text-3xl font-black tracking-tight">New Tournament</h1>
            <p className="mt-1 text-sm text-slate-400">Build your lineup. Play for the title.</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-transparent bg-[linear-gradient(115deg,#102033,#0c1425),linear-gradient(120deg,#4fe3f5,#5c8dff_55%,#a78bfa)] p-3 [background-origin:border-box] [background-clip:padding-box,border-box]">
            <Trophy className="size-8 text-cyan-300" aria-hidden="true" />
            <div><div className="text-lg font-extrabold">X01 Tournament</div><p className="text-xs text-slate-400">Your players. One champion.</p></div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">Board</div>
            <BoardPicker boards={boards} value={selectedBoardId} loading={boardsLoading} onChange={(boardId) => { setSelectedBoardId(boardId); storeBoardId(boardId); }} />
            <p className="text-xs leading-relaxed text-slate-400">The board is assigned when you open a match from the bracket. Finish that match before opening the next one.</p>
            {boardsError && <p role="alert" className="text-xs text-amber-400">{boardsError}</p>}
            {boardUnavailable && !boardsLoading && <p className="text-xs text-amber-400">Choose a ready board or Manual to continue.</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="tournament-name" className="text-sm font-semibold">Tournament name</label>
            <Input id="tournament-name" placeholder="e.g. Friday Night Darts" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
      <div className="grid grid-cols-1 gap-4">
        <div>
          <div className="font-medium mb-1">Start score</div>
          <Select value={startScore} onValueChange={(v) => setStartScore(v as StartScore)}>
            <SelectTrigger aria-label="Start score" className="w-full"><SelectValue placeholder="Start score" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="201">201</SelectItem>
              <SelectItem value="301">301</SelectItem>
              <SelectItem value="501">501</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="font-medium mb-1">Finish rule</div>
          <Select value={finish} onValueChange={(v) => setFinish(v as FinishRule)}>
            <SelectTrigger aria-label="Finish rule" className="w-full"><SelectValue placeholder="Finish rule" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="double_out">Double out</SelectItem>
              <SelectItem value="single_out">Single out</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="font-medium mb-1">Legs to win</div>
          <div className="flex items-stretch gap-2">
            <Button type="button" variant="outline" onClick={() => {
              setLegsToWin((v) => {
                const next = Math.max(1, v - 1);
                if (next !== 1) setFairEnding(false);
                return next;
              });
            }}>-</Button>
            <Input aria-label="Legs to win" readOnly className="text-center select-none" value={String(legsToWin)} />
            <Button type="button" variant="outline" onClick={() => {
              setLegsToWin((v) => {
                const next = v + 1;
                if (next !== 1) setFairEnding(false);
                return next;
              });
            }}>+</Button>
          </div>
        </div>
      </div>

          {legsToWin === 1 && (
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${fairEnding ? 'border-cyan-400/30 bg-cyan-400/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/5'}`}>
              <Scale className={`size-5 shrink-0 ${fairEnding ? 'text-cyan-300' : 'text-slate-400'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Fair ending</span><span id="tournament-fair-ending-description" className="mt-0.5 block text-xs leading-relaxed text-slate-400">Everyone finishes the round before a winner is declared.</span></span>
              <Switch aria-label="Fair ending" aria-describedby="tournament-fair-ending-description" checked={fairEnding} onCheckedChange={setFairEnding} className="data-[state=checked]:bg-cyan-400" />
            </label>
          )}
          <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${commentaryEnabled ? 'border-cyan-400/30 bg-cyan-400/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/5'}`}>
            <Volume2 className={`size-5 shrink-0 ${commentaryEnabled ? 'text-cyan-300' : 'text-slate-400'}`} aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Commentary</span><span id="tournament-commentary-description" className="mt-0.5 block text-xs leading-relaxed text-slate-400">Automatically play live commentary when tournament matches open in spectator mode.</span></span>
            <Switch aria-label="Commentary" aria-describedby="tournament-commentary-description" checked={commentaryEnabled} onCheckedChange={(enabled) => { setCommentaryEnabled(enabled); try { localStorage.setItem(COMMENTARY_STORAGE_KEY, String(enabled)); } catch { /* optional preference */ } }} className="data-[state=checked]:bg-cyan-400" />
          </label>
        </section>
        <section aria-label="Tournament players" className="min-w-0 space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:pb-40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="mr-auto shrink-0 whitespace-nowrap text-lg font-bold">Players <span className="text-sm font-normal text-slate-400">{selectedIds.length} selected · min 3</span></h2>
            <div className="flex flex-wrap gap-1.5">
              {LOCATIONS.map((loc) => (
                <Button key={loc.value} type="button" size="sm" variant="outline" aria-pressed={enabledLocations.includes(loc.value)} onClick={() => toggleLocation(loc.value)} className={enabledLocations.includes(loc.value) ? 'border-sky-400/20 bg-sky-400/10 font-bold text-sky-300 hover:bg-sky-400/20 hover:text-sky-300' : 'border-white/10 bg-transparent text-slate-400 hover:bg-white/5 hover:text-slate-300'}>{loc.label}</Button>
              ))}
            </div>
            <div className="relative w-full max-w-80 min-w-0 xl:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input type="search" aria-label="Search players" placeholder="Search players" value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} className="h-12 rounded-xl border-white/10 bg-slate-900/50 pl-9 text-base" />
            </div>
          </div>
          <div className="grid min-h-0 grid-cols-1 content-start gap-2.5 min-[480px]:grid-cols-2 md:grid-cols-3 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain xl:grid-cols-4">
            {filteredPlayers.map((player) => {
              const checked = selectedIds.includes(player.id);
              const location = LOCATIONS.find((entry) => entry.value === player.location);
              return (
                <button key={player.id} type="button" aria-pressed={checked} onClick={() => toggle(player.id)} className={`flex min-h-24 min-w-0 items-center gap-4 rounded-2xl border-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${checked ? 'border-sky-300/70 bg-sky-400/10 text-sky-200 shadow-[inset_0_0_18px_rgba(56,189,248,0.12)] hover:bg-sky-400/20' : 'border-white/[0.06] bg-slate-900/60 text-slate-100 hover:border-sky-300/40 hover:bg-slate-800/70'}`}>
                  <PlayerAvatar player={player} size="xl" className="size-16 text-xl ring-2 ring-white/10" />
                  <span className="min-w-0 flex-1"><span title={player.display_name} className="block truncate text-2xl font-black tracking-tight xl:text-[28px]">{player.display_name}</span>{location && <span className="mt-0.5 block text-xs font-semibold text-slate-500">{location.label}</span>}</span>
                </button>
              );
            })}
            {filteredPlayers.length === 0 && <p className="col-span-full py-6 text-center text-sm text-slate-400">No players match your filters.</p>}
          </div>
          <div className="fixed inset-x-7 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 space-y-3 rounded-t-2xl bg-background/95 px-1 py-3 shadow-[0_-12px_32px_rgba(3,7,18,0.8)] backdrop-blur-xl md:inset-x-12 lg:right-14 lg:bottom-0 lg:left-[376px] xl:left-[408px]">
            <div className="flex gap-2">
              <Input aria-label="New player name" placeholder="New player name" value={newPlayerName} onChange={(e) => setNewPlayerName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createPlayer(); } }} className="flex-1 border-white/10 bg-slate-900/40" />
              <Button type="button" variant="outline" onClick={() => void createPlayer()} disabled={!newPlayerName.trim()}>Add player</Button>
            </div>
            <div className="start-action-bar grid grid-cols-2 items-center gap-3">
              <SelectedPlayerLineup players={selectedPlayers} onRemove={toggle} />
              <Button type="button" onClick={() => void onStart()} disabled={creating || selectedIds.length < 3 || !name.trim() || boardUnavailable} className="start-match-button group h-16 w-full min-w-0 gap-2 rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 px-3 text-base font-semibold text-white shadow-[0_6px_24px_rgba(37,99,235,0.2)] transition-[filter,box-shadow,border-color] hover:border-cyan-100 hover:brightness-110 hover:shadow-[0_0_18px_rgba(56,189,248,0.45)] sm:text-xl">
                <span className="truncate">{creating ? 'Creating…' : 'Start Tournament'}</span><ArrowRight className="hidden size-5 shrink-0 sm:block" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
