"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GameActivityHeatmap } from '@/components/games/GameActivityHeatmap';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, Play, Eye, Trophy, Clock, Users, Swords, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { LoadingReveal } from '@/components/LoadingReveal';
import { Skeleton } from '@/components/ui/skeleton';
import { GAME_MODE_INFO, gameModeName } from '@/lib/games/labels';
import type { GameMode } from '@/lib/games/types';
import {
  browserTimeZone,
  countGamesByDay,
  gameDateKey,
  gamesActivityQuery,
  liveGamesQuery,
  matchesPlayerSearch,
  recentGamesQuery,
  RECENT_PAGE_SIZE,
  tournamentsQuery,
  type GameSessionWithDetails,
  type ListedGame,
  type MatchWithDetails,
  type RecentGames,
  trimRecentGamesToFirstPage,
} from '@/lib/queries/games';

/** Search typed into the box reaches the database once typing pauses. */
const SEARCH_DEBOUNCE_MS = 250;

function createPreviewGames(): ListedGame[] {
  const names = ['James', 'Ada', 'Ben', 'Nikita', 'Sofia', 'Oliver'];
  return Array.from({ length: 420 }, (_, index): ListedGame => {
    const date = new Date();
    date.setDate(date.getDate() - (index < 2 ? 0 : Math.floor(((index * 37) % 365) / 7) * 7 + index % 5));
    date.setHours(12 + index % 8, index % 60, 0, 0);
    if (index < 2) date.setTime(Date.now() - (index + 1) * 12 * 60_000);
    const players = [index % names.length, (index + 1 + index % 4) % names.length].map((player, play_order) => ({
      id: `preview-player-${player}`, display_name: names[player], play_order,
    }));
    const created_at = date.toISOString();
    const winner = index < 2 ? null : players[index % 2];
    if (index % 3 === 0) return {
      kind: 'game', created_at,
      game: { id: `preview-game-${index}`, mode: 'cricket', status: winner ? 'completed' : 'active', created_at,
        players, winner_player_id: winner?.id ?? null, winner_name: winner?.display_name },
    };
    return {
      kind: 'match', created_at,
      match: { id: `preview-match-${index}`, mode: 'x01', start_score: '501', finish: 'double_out', legs_to_win: 2,
        created_at, players, winner_player_id: winner?.id ?? null, winner_name: winner?.display_name,
        completed_at: winner ? created_at : null, ended_early: false,
        legs_won: winner ? 2 : 0,
      },
    };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export default function GamesPage() {
  const queryClient = useQueryClient();
  const [playerSearch, setPlayerSearch] = useState('');
  const [search, setSearch] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Only the local preview pages through its dummy list with a count; real pages load by cursor.
  const [visibleCount, setVisibleCount] = useState(RECENT_PAGE_SIZE);
  const [deletingMatchId, setDeletingMatchId] = useState<string | null>(null);
  const [previewGames, setPreviewGames] = useState<ListedGame[] | null>(null);
  const preview = previewGames !== null;
  const router = useRouter();
  const [timeZone] = useState(browserTimeZone);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(playerSearch.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [playerSearch]);

  // The database returns the page of finished games and the per-day counts for the current
  // filters; the few live games come in full and are filtered here as you type.
  const liveQuery = useQuery({ ...liveGamesQuery(), enabled: !preview });
  const recentQuery = useInfiniteQuery({
    ...recentGamesQuery({ search, day: selectedDate, timeZone }),
    enabled: !preview,
    // A new search or day keeps the current list up until its results arrive.
    placeholderData: keepPreviousData,
  });
  const activityQuery = useQuery({
    ...gamesActivityQuery({ search, timeZone }),
    enabled: !preview,
    placeholderData: keepPreviousData,
  });
  const tournamentsResult = useQuery({ ...tournamentsQuery(), enabled: !preview });

  const matchesDate = (entry: ListedGame) => !selectedDate || gameDateKey(new Date(entry.created_at)) === selectedDate;
  const isLive = (entry: ListedGame) => entry.kind === 'game' ? entry.game.status === 'active' : !entry.match.completed_at;
  const previewSearched = previewGames?.filter((entry) => matchesPlayerSearch(entry, playerSearch)) ?? [];
  const previewRecent = previewSearched.filter((entry) => !isLive(entry)).filter(matchesDate);
  const liveGames = previewGames ? previewGames.filter(isLive) : liveQuery.data ?? [];
  const recent = previewGames
    ? { games: previewRecent.slice(0, visibleCount), hasMore: previewRecent.length > visibleCount }
    : { games: recentQuery.data?.pages.flatMap((page) => page.games) ?? [], hasMore: recentQuery.hasNextPage };
  const activity = preview ? countGamesByDay(previewSearched) : activityQuery.data ?? {};
  const tournaments = preview ? [] : tournamentsResult.data ?? [];
  const filteredLive = liveGames.filter((entry) => matchesPlayerSearch(entry, playerSearch)).filter(matchesDate);
  // Cached data stays on screen while it refreshes; the loading state is only for a first visit.
  const loading = !preview && (liveQuery.isPending || recentQuery.isPending);
  const loadError = !preview && ((liveQuery.isError && !liveQuery.data) || (recentQuery.isError && !recentQuery.data));

  // Leaving the page keeps only the first page of each cached list: the next visit then refetches
  // (and storage keeps) one page instead of every page loaded with "Show more".
  useEffect(() => () => {
    queryClient.setQueriesData<RecentGames>({ queryKey: ['games', 'recent'] }, trimRecentGamesToFirstPage);
  }, [queryClient]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && new URLSearchParams(window.location.search).get('preview') === '1') {
      setPreviewGames(createPreviewGames());
    }
  }, []);

  const handleJoinLiveGame = (matchId: string) => {
    router.push(`/match/${matchId}?spectator=true`);
  };

  const handleDeleteGame = async (match: MatchWithDetails) => {
    if (preview) return;
    const confirmed = window.confirm(
      `Permanently delete this game (${match.players.map((player) => player.display_name).join(', ')}). This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingMatchId(match.id);
    try {
      const response = await fetch(`/api/matches/${match.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to delete game');
      }
      const keep = (entry: ListedGame) => entry.kind !== 'match' || entry.match.id !== match.id;
      queryClient.setQueryData(liveGamesQuery().queryKey, (games) => games?.filter(keep));
      queryClient.setQueriesData<RecentGames>({ queryKey: ['games', 'recent'] }, (data) => data && {
        ...data,
        pages: data.pages.map((page) => ({ ...page, games: page.games.filter(keep) })),
      });
      // Refill the page and recount its day; this also drops a fallback copy of the full history.
      void queryClient.invalidateQueries({ queryKey: ['games'] });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete game');
    } finally {
      setDeletingMatchId(null);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const gameTime = new Date(dateString);
    const diffMs = now.getTime() - gameTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      return `${diffDays}d ago`;
    }
  };

  const getGameDuration = (match: MatchWithDetails) => {
    const legsPlayed = match.legs_won;
    const totalLegs = match.legs_to_win * 2 - 1; // Assuming best of format
    return `${legsPlayed}/${totalLegs} legs`;
  };

  const getGameProgress = (match: MatchWithDetails) => {
    if (match.winner_player_id) return 'Completed';
    
    if (match.legs_won === 0) return 'Starting';
    
    return 'In Progress';
  };

  const gameModeBadge = (mode: GameMode) => {
    const info = GAME_MODE_INFO[mode];
    if (info.shortName === info.name) return null;
    return <Badge variant="secondary">{info.shortName}</Badge>;
  };

  const renderLiveGameSession = (game: GameSessionWithDetails) => (
    <Card key={game.id} className="border-cyan-400/20 bg-cyan-400/[0.025] transition-[border-color,box-shadow] hover:border-cyan-400/30 hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">{gameModeName(game.mode)}</CardTitle>
            {gameModeBadge(game.mode)}
          </div>
          <Badge variant="destructive" className="animate-pulse">
            LIVE
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          Started {formatTimeAgo(game.created_at)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-4 w-4" />
            <span className="font-medium">Players</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {game.players.map((player) => (
              <Badge key={player.id} variant="outline" className="text-xs gap-1.5">
                <PlayerAvatar player={player} size="xs" />
                {player.display_name}
              </Badge>
            ))}
          </div>
        </div>

        <Button asChild className="w-full" size="sm">
          <Link href={`/game/${game.id}?spectator=true`}>
            <Eye className="h-4 w-4 mr-2" />
            Watch Live
          </Link>
        </Button>
      </CardContent>
    </Card>
  );

  const renderRecentGameSession = (game: GameSessionWithDetails) => (
    <Card key={game.id} className="hover:shadow-md transition-shadow">
      <CardContent className="py-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
          {/* Game Info */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{gameModeName(game.mode)}</span>
              {gameModeBadge(game.mode)}
            </div>
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(game.created_at)}
            </div>
          </div>

          {/* Players */}
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">Players</div>
            <div className="flex flex-wrap gap-1">
              {game.players.map((player) => (
                <Badge
                  key={player.id}
                  variant={player.id === game.winner_player_id ? "default" : "outline"}
                  className="text-xs gap-1.5"
                >
                  <PlayerAvatar player={player} size="xs" />
                  {player.display_name}
                  {player.id === game.winner_player_id && ' 🏆'}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium text-muted-foreground">Result</div>
            {game.status === 'ended_early' ? (
              <Badge variant="secondary">Ended early</Badge>
            ) : (
              <div className="font-semibold text-green-700 flex items-center gap-1">
                <Trophy className="h-4 w-4" />
                {game.winner_player_id && (
                  <PlayerAvatar player={game.players.find((p) => p.id === game.winner_player_id) ?? { id: game.winner_player_id }} size="xs" />
                )}
                {game.winner_name ?? 'No winner'}
              </div>
            )}
          </div>

          {/* Action */}
          <div className="flex md:justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href={`/game/${game.id}`}>
                <Eye className="h-4 w-4 mr-2" />
                View
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="container mx-auto p-4 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Games</h1>
          <p className="text-muted-foreground">Live and recent dart matches</p>
        </div>
        <LoadingReveal label="Loading games..." className="space-y-6">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-10 w-full max-w-sm" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-44 rounded-xl" />)}
          </div>
        </LoadingReveal>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Games</h1>
        <p className="text-muted-foreground">Live and recent dart matches</p>
      </div>

      {loadError && <div role="alert" className="text-destructive">Could not load games. <Button variant="outline" onClick={() => { void liveQuery.refetch(); void recentQuery.refetch(); }}>Try again</Button></div>}
      {selectedDate && <div className="flex items-center gap-3 text-sm">
        Games on {selectedDate}
        <Button variant="outline" size="sm" onClick={() => setSelectedDate(null)}>Clear date</Button>
      </div>}

      {preview && <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Local preview with dummy games. Player search and date filters are interactive; game links are examples.</p>}

      {/* Active Tournaments */}
      {tournaments.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-purple-500" />
            <h2 className="text-2xl font-semibold">Tournaments</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => (
              <Link key={t.id} href={`/tournament/${t.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{t.name}</CardTitle>
                      <Badge variant={t.status === 'in_progress' ? 'default' : 'secondary'} className={t.status === 'in_progress' ? 'animate-pulse' : ''}>
                        {t.status === 'in_progress' ? 'Live' : 'Done'}
                      </Badge>
                    </div>
                    <CardDescription>
                      {t.start_score} X01 &middot; {t.finish === 'double_out' ? 'Double Out' : 'Single Out'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>{t.player_count} players</span>
                      <span>&middot;</span>
                      <Clock className="h-4 w-4" />
                      <span>{formatTimeAgo(t.created_at)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Live Games Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Play className="h-5 w-5 text-red-500" />
          <h2 className="text-2xl font-semibold">Live Games</h2>
          {filteredLive.length > 0 && (
            <Badge variant="destructive" className="animate-pulse">
              {filteredLive.length} Live
            </Badge>
          )}
        </div>

        {filteredLive.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {playerSearch || selectedDate ? 'No live games match your filters' : 'No live games at the moment'}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredLive.map((item) => {
              if (item.kind === 'game') return renderLiveGameSession(item.game);
              const match = item.match;
              return (
              <Card key={match.id} className="border-cyan-400/20 bg-cyan-400/[0.025] transition-[border-color,box-shadow] hover:border-cyan-400/30 hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      {match.start_score} {match.mode.toUpperCase()}
                    </CardTitle>
                    <Badge variant="destructive" className="animate-pulse">
                      LIVE
                    </Badge>
                  </div>
                  <CardDescription className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    Started {formatTimeAgo(match.created_at)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-4 w-4" />
                      <span className="font-medium">Players</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {match.players.map((player) => (
                        <Badge key={player.id} variant="outline" className="text-xs gap-1.5">
                          <PlayerAvatar player={player} size="xs" />
                          {player.display_name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{getGameDuration(match)}</span>
                    <span>{getGameProgress(match)}</span>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleJoinLiveGame(match.id)}
                      className="flex-1"
                      size="sm"
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Watch Live
                    </Button>
                    <Button
                      aria-label="Delete game"
                      variant="destructive"
                      size="icon"
                      onClick={() => handleDeleteGame(match)}
                      disabled={preview || deletingMatchId === match.id}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </div>

      {!loadError && <GameActivityHeatmap
        activity={activity}
        selectedDate={selectedDate}
        onSelectDate={date => { setSelectedDate(date === selectedDate ? null : date); setVisibleCount(RECENT_PAGE_SIZE); }}
      />}

      {/* Recent Games Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-yellow-500" />
          <h2 className="text-2xl font-semibold">Recent Games</h2>
        </div>

        <div className="max-w-md space-y-2">
          <label htmlFor="player-search" className="text-sm font-medium">Search by player</label>
          <Input id="player-search" placeholder="Enter a player name…" value={playerSearch}
            onChange={event => { setPlayerSearch(event.target.value); setVisibleCount(RECENT_PAGE_SIZE); }} />
        </div>

        {recent.games.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {playerSearch || selectedDate ? 'No completed games match your filters' : 'No completed games yet'}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {recent.games.map((item) => {
              if (item.kind === 'game') return renderRecentGameSession(item.game);
              const match = item.match;
              return (
                <Card
                  key={match.id}
                  className="group relative cursor-pointer transition-all hover:-translate-y-0.5 hover:border-cyan-400/30 hover:shadow-md focus-within:border-cyan-400/30 focus-within:ring-2 focus-within:ring-cyan-400/20"
                >
                  <Link
                    href={`/match/${match.id}?spectator=true&history=true`}
                    aria-label={`View stats for ${match.players.map((player) => player.display_name).join(' versus ')}`}
                    className="absolute inset-0 z-0 rounded-xl outline-none"
                  />
                  <CardContent className="pointer-events-none relative z-10 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                    {/* Game Info */}
                    <div className="space-y-1">
                      <div className="font-semibold">
                        {match.start_score} {match.mode.toUpperCase()}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTimeAgo(match.created_at)}
                      </div>
                    </div>

                    {/* Players */}
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">Players</div>
                      <div className="flex flex-wrap gap-1">
                        {match.players.map((player) => (
                          <Badge 
                            key={player.id} 
                            variant={player.id === match.winner_player_id ? "default" : "outline"}
                            className="text-xs gap-1.5"
                          >
                            <PlayerAvatar player={player} size="xs" />
                            {player.display_name}
                            {player.id === match.winner_player_id && ' 🏆'}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Result */}
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-muted-foreground">Result</div>
                      {match.winner_name ? (
                        <div className="font-semibold text-green-700 flex items-center gap-1">
                          <Trophy className="h-4 w-4" />
                          <PlayerAvatar player={match.players.find((p) => p.id === match.winner_player_id) ?? { id: match.winner_player_id }} size="xs" />
                          {match.winner_name}
                        </div>
                      ) : (
                        <div className="font-semibold text-muted-foreground">Ended early</div>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-muted-foreground">Game Stats</div>
                        <div className="text-sm">
                          <div>{getGameDuration(match)}</div>
                          <div className="text-muted-foreground">Best of {match.legs_to_win * 2 - 1}</div>
                        </div>
                        <div className="flex items-center gap-1 pt-1 text-sm font-medium text-primary">
                          <Eye className="h-4 w-4" />
                          View stats
                        </div>
                      </div>
                      <div className="pointer-events-auto relative z-20 flex gap-2">
                        <Button asChild aria-label="Open DartIQ report" variant="outline" size="icon">
                          <Link href={`/match/${match.id}/report`}>
                            <Activity className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          aria-label="Delete game"
                          variant="destructive"
                          size="icon"
                          onClick={() => handleDeleteGame(match)}
                          disabled={preview || deletingMatchId === match.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {recent.hasMore && (
          <Button
            variant="outline"
            disabled={!preview && (recentQuery.isPlaceholderData || recentQuery.isFetchingNextPage)}
            onClick={() => preview ? setVisibleCount(count => count + RECENT_PAGE_SIZE) : void recentQuery.fetchNextPage()}
          >
            Show more games
          </Button>
        )}
      </div>
    </div>
  );
}
