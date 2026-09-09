"use client";

import { BullOffRound } from '@/components/match/BullOffRound';
import { bullOffBrief } from '@/lib/commentary/bullOff';
import { RematchPanel } from '@/components/games/RematchPanel';
import { MatchScoringView } from '@/components/match/MatchScoringView';
import { RealtimeDebugPanel } from '@/components/match/RealtimeDebugPanel';
import { PerfDebugPanel } from '@/components/match/PerfDebugPanel';
import { SegmentResult } from '@/utils/dartboard';
import { FinishRule } from '@/utils/x01';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { useCommentary } from '@/hooks/useCommentary';
import { useMatchData } from '@/hooks/useMatchData';
import { useMatchRealtime } from '@/hooks/useMatchRealtime';
import { useMatchActions } from '@/hooks/useMatchActions';
import { useMatchEloChanges } from '@/hooks/useMatchEloChanges';
import { useDartIQ } from '@/hooks/useDartIQ';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRealtime } from '@/hooks/useRealtime';
import type { LegRecord, MatchRecord, Player, TurnRecord } from '@/lib/match/types';
import { PendingThrowBuffer } from '@/lib/match/realtime';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { incrementRealtimeMetric } from '@/lib/match/realtimeMetrics';
import {
  selectCurrentLeg,
  selectOrderPlayers,
  selectMatchWinnerId,
  selectPlayerStats,
  selectCurrentPlayer,
  selectCurrentPlayerWithFairEnding,
  selectSpectatorCurrentPlayer,
  getScoreForPlayer as getScoreForPlayerSelector,
  getAvgForPlayer as getAvgForPlayerSelector,
  canEditPlayers as canEditPlayersSelector,
  canReorderPlayers as canReorderPlayersSelector,
} from '@/lib/match/selectors';
import { computeFairEndingState, type FairEndingState } from '@/utils/fairEnding';

type SpectatorViewComponent = ComponentType<ComponentProps<typeof import('@/components/match/MatchSpectatorView')['MatchSpectatorView']>>;

const MatchSpectatorView = dynamic(
  () => import('@/components/match/MatchSpectatorView').then((module) => module.MatchSpectatorView),
  { loading: () => <div className="p-4">Loading spectator view…</div> }
);

export default function MatchClient({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [rematchOpen, setRematchOpen] = useState(false);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const spectatorParam = searchParams.get('spectator') === 'true';
  const historyParam = searchParams.get('history') === 'true';
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  
  // Spectator mode state
  const [isSpectatorMode, setIsSpectatorMode] = useState(spectatorParam);
  const [celebration, setCelebration] = useState<{
    score: number;
    playerName: string;
    level: 'info' | 'good' | 'excellent' | 'godlike' | 'max' | 'bust' | 'nikita';
    throws: { segment: string; scored: number; dart_index: number }[];
  } | null>(null);
  const celebratedTurns = useRef<Set<string>>(new Set());

  // Commentary state (persona-driven)
  const {
    commentaryEnabled,
    realtimeCommentaryStatus,
    toggleQuickCommentary,
    audioEnabled,
    voice,
    personaId,
    currentCommentary,
    commentaryTranscriptLog,
    commentaryLoading,
    commentaryPlaying,
    activePersona,
    ttsServiceRef,
    realtimeCommentaryRef,
    setCurrentCommentary,
    recordCompletedCommentary,
    clearCommentaryTranscriptLog,
    setCommentaryLoading,
    setCommentaryPlaying,
    setAudioEnabled,
    setVoice,
    handleCommentaryEnabledChange,
    handleAudioEnabledChange,
    handlePersonaChange,
    skipCommentary,
  } = useCommentary(matchId, isSpectatorMode && searchParams.get('commentary') === 'true');

  // Ref to hold latest state for event handlers (prevents stale closure bugs)
  const latestStateRef = useRef({
    isSpectatorMode: false,
    playerById: {} as Record<string, Player>,
    turnThrowCounts: {} as Record<string, number>,
    turns: [] as TurnRecord[],
    turnsByLeg: {} as Record<string, TurnRecord[]>,
    legs: [] as LegRecord[],
    players: [] as Player[],
    match: null as MatchRecord | null,
    knownLegIds: new Set<string>(),
    knownTurnIds: new Set<string>(),
  });
  const pendingThrowBufferRef = useRef(new PendingThrowBuffer());
  const pendingTurnReconcileRef = useRef(new Set<string>());

  const {
    loading,
    error,
    match,
    setMatch,
    players,
    legs,
    turns,
    setTurns,
    turnsByLeg,
    setTurnsByLeg,
    turnThrowCounts,
    setTurnThrowCounts,
    spectatorLoading,
    loadAll,
    loadAllSpectator,
    loadMatchOnly,
    loadLegsOnly,
    loadPlayersOnly,
    loadTurnsForLeg,
  } = useMatchData(matchId);
  const finishRule: FinishRule = useMemo(() => (match?.finish ?? 'double_out'), [match?.finish]);
  const dartIQPlayerIds = useMemo(() => players.map((player) => player.id), [players]);
  const dartIQ = useDartIQ(matchId, dartIQPlayerIds, finishRule, !isSpectatorMode);

  const ongoingTurnRef = useRef<{
    turnId: string;
    playerId: string;
    darts: { scored: number; label: string; kind: SegmentResult['kind'] }[];
    startScore: number;
  } | null>(null);

  const [localTurn, setLocalTurn] = useState<{
    playerId: string | null;
    darts: { scored: number; label: string; kind: SegmentResult['kind'] }[];
  }>({ playerId: null, darts: [] });


  // Real-time connection
  const realtime = useRealtime(matchId);
  const realtimeEnabled = true; // For now, always enabled
  const realtimeIsConnected = realtime.isConnected;
  const realtimeConnectionStatus = realtime.connectionStatus;
  const realtimeUpdatePresence = realtime.updatePresence;
  const debugRealtime =
    process.env.NODE_ENV !== 'production' &&
    (searchParams.get('debugRealtime') === '1' || searchParams.get('debug') === 'realtime');
  const debugPerf = process.env.NODE_ENV !== 'production' && searchParams.get('perf') === 'true';

  useEffect(() => {
    if (isSpectatorMode) {
      void loadAllSpectator();
      return;
    }
    void loadAll();
  }, [isSpectatorMode, loadAll, loadAllSpectator]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Resolve tournament_match_id → tournament_id from DB
  useEffect(() => {
    if (!match?.tournament_match_id) {
      setTournamentId(null);
      return;
    }
    (async () => {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('tournament_matches')
        .select('tournament_id')
        .eq('id', match.tournament_match_id!)
        .single();
      if (error) {
        console.error('Failed to resolve tournament id for match:', error);
        setTournamentId(null);
        return;
      }
      setTournamentId(data?.tournament_id ?? null);
    })();
  }, [match?.tournament_match_id]);

  // Compute playerById memo
  const playerById = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);

  // Sync latest state to ref (prevents stale closures in event handlers)
  useEffect(() => {
    const knownLegIds = new Set<string>(legs.map((leg) => leg.id));
    const knownTurnIds = new Set<string>();
    for (const turn of turns) {
      knownTurnIds.add(turn.id);
    }
    for (const legTurns of Object.values(turnsByLeg)) {
      for (const turn of legTurns) {
        knownTurnIds.add(turn.id);
      }
    }

    latestStateRef.current = {
      isSpectatorMode,
      playerById,
      turnThrowCounts,
      turns,
      turnsByLeg,
      legs,
      players,
      match,
      knownLegIds,
      knownTurnIds,
    };
  }, [isSpectatorMode, playerById, turnThrowCounts, turns, turnsByLeg, legs, players, match]);

  useMatchRealtime({
    matchId,
    realtime: {
      isConnected: realtimeIsConnected,
      connectionStatus: realtimeConnectionStatus,
      updatePresence: realtimeUpdatePresence,
    },
    realtimeEnabled,
    isSpectatorMode,
    loadAll,
    loadAllSpectator,
    loadMatchOnly,
    loadLegsOnly,
    loadPlayersOnly,
    loadTurnsForLeg,
    latestStateRef,
    pendingThrowBufferRef,
    pendingTurnReconcileRef,
    setTurns,
    setTurnsByLeg,
    setTurnThrowCounts,
    setMatch,
    ongoingTurnRef,
    setLocalTurn,
    setCelebration,
    celebratedTurns,
    commentaryEnabled,
    personaId,
    setCommentaryLoading,
    setCommentaryPlaying,
    setCurrentCommentary,
    recordCompletedCommentary,
    ttsServiceRef,
    realtimeCommentaryRef,
    dartIQEvidenceByPlayerId: dartIQ.profilesByPlayerId,
    dartIQPopulationEvidence: dartIQ.populationProfile,
    dartIQModelsByPlayerId: dartIQ.outcomeModelsByPlayerId,
    dartIQWorkerEvidence: dartIQ.workerEvidence,
  });

  const [bullOffHandoffPending, setBullOffHandoffPending] = useState(false);
  const [preparedSpectatorView, setPreparedSpectatorView] = useState<SpectatorViewComponent | null>(null);
  useEffect(() => {
    if (!isSpectatorMode || !bullOffHandoffPending) return;
    let cancelled = false;
    void import('@/components/match/MatchSpectatorView').then(module => {
      if (!cancelled) setPreparedSpectatorView(() => module.MatchSpectatorView);
    }).catch(() => {
      // Preserve the ordinary dynamic-loader retry path on a failed preload.
      if (!cancelled) setPreparedSpectatorView(() => MatchSpectatorView);
    });
    return () => { cancelled = true; };
  }, [isSpectatorMode, bullOffHandoffPending]);
  const SpectatorView = preparedSpectatorView ?? MatchSpectatorView;
  const bullOffOrderReady = match?.bull_off?.phase === 'complete'
    && players.length === match.bull_off.order.length
    && players.every((player, index) => player.id === match.bull_off!.order[index])
    && legs.find(leg => leg.leg_number === 1)?.starting_player_id === match.bull_off.order[0];
  const bullOffTransitionReady = bullOffOrderReady && (!isSpectatorMode || preparedSpectatorView !== null);
  useEffect(() => {
    if (match?.bull_off?.phase === 'throwing') setBullOffHandoffPending(true);
    else if (bullOffTransitionReady || !match?.bull_off) setBullOffHandoffPending(false);
  }, [match?.bull_off, bullOffTransitionReady]);

  const bullOffSeen = useRef<string | null>(null);
  const bullOffReloaded = useRef<string | null>(null);
  useEffect(() => {
    bullOffSeen.current = null;
    bullOffReloaded.current = null;
  }, [matchId]);
  useEffect(() => {
    const state = match?.bull_off;
    if (!state || match.id !== matchId) return;
    const key = `${state.shots.length}:${state.phase}:${state.round}`;
    if (bullOffSeen.current === null) { bullOffSeen.current = key; return; }
    if (bullOffSeen.current === key) return;
    if (state.phase === 'complete') {
      if (bullOffReloaded.current !== key) {
        bullOffReloaded.current = key;
        void loadAllSpectator();
      }
      if (!bullOffTransitionReady) return;
    }
    bullOffSeen.current = key;
    const scoringAlreadyStarted = state.phase === 'complete' && Object.values(turnThrowCounts).some(count => count > 0);
    if (commentaryEnabled && realtimeCommentaryStatus === 'ready' && !scoringAlreadyStarted) {
      realtimeCommentaryRef.current?.publishBullOff(
        bullOffBrief(state, Object.fromEntries(players.map(player => [player.id, player.display_name])), match),
        state.phase === 'complete'
      );
    }
  }, [matchId, match, players, commentaryEnabled, realtimeCommentaryStatus, realtimeCommentaryRef, loadAllSpectator, bullOffTransitionReady, turnThrowCounts]);

  // Check for spectator mode from URL params
  useEffect(() => {
    setIsSpectatorMode(spectatorParam);
  }, [spectatorParam]);

  useEffect(() => {
    if (!isSpectatorMode) return;
    const handleRematch = (event: Event) => {
      const payload = (event as CustomEvent).detail as { newMatchId?: string } | undefined;
      if (payload?.newMatchId) {
        router.push(`/match/${payload.newMatchId}?spectator=true`);
      }
    };
    window.addEventListener('supabase-rematch-created', handleRematch as EventListener);
    return () => {
      window.removeEventListener('supabase-rematch-created', handleRematch as EventListener);
    };
  }, [isSpectatorMode, router]);

  // Auto-refresh in spectator mode (fallback when real-time is not available)
  useEffect(() => {
    if (!isSpectatorMode) return;
    
    // Only use polling if real-time is not connected or disabled
    if (realtimeIsConnected && realtimeEnabled) return;
    
    const interval = setInterval(() => {
      // Only reload if not currently loading to prevent flickering
      if (!spectatorLoading) {
        incrementRealtimeMetric(matchId, 'fallbackPollTicks');
        void loadAllSpectator();
      }
    }, 2000); // Refresh every 2 seconds as fallback
    
    return () => clearInterval(interval);
  }, [matchId, isSpectatorMode, loadAllSpectator, spectatorLoading, realtimeIsConnected, realtimeEnabled]);

  const currentLeg = useMemo(() => selectCurrentLeg(legs ?? []), [legs]);

  useEffect(() => {
    // Reset per-leg celebration tracking only when the active leg changes.
    celebratedTurns.current.clear();
  }, [currentLeg?.id]);

  const orderPlayers = useMemo(() => selectOrderPlayers(match, players, currentLeg), [match, players, currentLeg]);

  const startScore: number = useMemo(() => (match?.start_score ? parseInt(match.start_score, 10) : 501), [match?.start_score]);

  // Determine if match has a winner already
  const matchWinnerId = useMemo(() => selectMatchWinnerId(match, legs), [match, legs]);

  // When this match transitions from in-progress to completed in the user's session,
  // invalidate the leaderboard caches so the front page shows the new result on return.
  const lastInvalidatedWinnerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!matchWinnerId) {
      lastInvalidatedWinnerRef.current = null;
      return;
    }
    if (lastInvalidatedWinnerRef.current === matchWinnerId) return;
    lastInvalidatedWinnerRef.current = matchWinnerId;
    queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    queryClient.invalidateQueries({ queryKey: ['eloHistory'] });
  }, [matchWinnerId, queryClient]);

  // Fetch ELO rating changes for the completed match
  const { eloChanges, loading: eloChangesLoading } = useMatchEloChanges(matchId, matchWinnerId, players.length);

  // Check if first round is completed (all players have had at least one turn)
  const canEditPlayers = useMemo(
    () =>
      canEditPlayersSelector({
        currentLeg,
        players,
        turns,
        matchWinnerId,
      }) && !match?.tournament_match_id,
    [currentLeg, players, turns, matchWinnerId, match?.tournament_match_id]
  );

  // Check if game hasn't started yet (no turns/throws registered)
  const canReorderPlayers = useMemo(() => canReorderPlayersSelector(turns, matchWinnerId), [turns, matchWinnerId]);

  // Compute fair ending state
  const fairEndingState: FairEndingState = useMemo(() => {
    if (!match?.fair_ending) {
      return { phase: 'normal' as const, checkedOutPlayerIds: [], tiebreakRound: 0, tiebreakPlayerIds: [], tiebreakScores: {}, winnerId: null };
    }
    return computeFairEndingState(
      turns.map((t) => {
        const tw = t as import('@/lib/match/types').TurnWithThrows;
        const throwsTotal = tw.throws?.reduce((sum, thr) => sum + thr.scored, 0);
        return {
          player_id: t.player_id,
          total_scored: t.total_scored,
          busted: t.busted,
          tiebreak_round: t.tiebreak_round,
          throw_count: turnThrowCounts[t.id] ?? 0,
          throws_total: throwsTotal,
        };
      }),
      orderPlayers,
      startScore,
      true
    );
  }, [match?.fair_ending, turns, orderPlayers, startScore, turnThrowCounts]);

  const standardCurrentPlayer = useMemo(
    () =>
      selectCurrentPlayer({
        orderPlayers,
        currentLeg,
        localTurn,
        turns,
        turnThrowCounts,
      }),
    [orderPlayers, currentLeg, localTurn, turns, turnThrowCounts]
  );

  const currentPlayer = useMemo(
    () =>
      match?.fair_ending
        ? selectCurrentPlayerWithFairEnding({
            fairEndingState,
            orderPlayers,
            turns,
            turnThrowCounts,
            fallback: standardCurrentPlayer,
          })
        : standardCurrentPlayer,
    [match?.fair_ending, fairEndingState, orderPlayers, turns, turnThrowCounts, standardCurrentPlayer]
  );

  // For spectator mode, determine current player based on incomplete turns
  const standardSpectatorCurrentPlayer = useMemo(
    () =>
      selectSpectatorCurrentPlayer({
        orderPlayers,
        currentLeg,
        turns,
        turnThrowCounts,
      }),
    [orderPlayers, currentLeg, turns, turnThrowCounts]
  );

  const spectatorCurrentPlayer = useMemo(
    () =>
      match?.fair_ending
        ? selectCurrentPlayerWithFairEnding({
            fairEndingState,
            orderPlayers,
            turns,
            turnThrowCounts,
            fallback: standardSpectatorCurrentPlayer,
          })
        : standardSpectatorCurrentPlayer,
    [match?.fair_ending, fairEndingState, orderPlayers, turns, turnThrowCounts, standardSpectatorCurrentPlayer]
  );

  const currentLegId = currentLeg?.id;

  // Memoized player stats in a single pass over turns
  const playerStats = useMemo(
    () => selectPlayerStats(players, turns, currentLegId, startScore),
    [players, turns, currentLegId, startScore]
  );

  function getScoreForPlayer(playerId: string): number {
    return getScoreForPlayerSelector({
      playerId,
      startScore,
      playerStats,
      localTurn,
      turnThrowCounts,
      ongoingTurnId: ongoingTurnRef.current?.turnId ?? null,
    });
  }

  function getAvgForPlayer(playerId: string): number {
    return getAvgForPlayerSelector(playerId, playerStats);
  }

  const {
    editOpen,
    setEditOpen,
    editingThrows,
    selectedThrowId,
    setSelectedThrowId,
    editPlayersOpen,
    setEditPlayersOpen,
    availablePlayers,
    newPlayerName,
    setNewPlayerName,
    endGameDialogOpen,
    setEndGameDialogOpen,
    endGameLoading,
    pauseLoading,
    rematchLoading,
    handleBoardClick,
    undoLastThrow,
    openEditModal,
    updateSelectedThrow,
    openEditPlayersModal,
    addNewPlayer,
    addPlayerToMatch,
    removePlayerFromMatch,
    movePlayerUp,
    movePlayerDown,
    startRematch,
    endGameEarly,
    togglePause,
    endLegAndMaybeMatch,
  } = useMatchActions({
    matchId,
    match,
    players,
    legs,
    turns,
    turnThrowCounts,
    currentLeg,
    currentPlayer,
    orderPlayers,
    finishRule,
    matchWinnerId,
    localTurn,
    ongoingTurnRef,
    setLocalTurn,
    loadAll,
    loadTurnsForLeg,
    routerPush: router.push,
    getScoreForPlayer,
    canEditPlayers,
    canReorderPlayers,
    commentaryEnabled,
    personaId,
    setCurrentCommentary,
    setCommentaryLoading,
    setCommentaryPlaying,
    ttsServiceRef,
    broadcastRematch: realtime.broadcastRematch,
    fairEndingState,
    startScore,
  });

  // When fair ending resolves a winner, end the leg (scoring client only - spectators must not trigger this)
  const fairEndingWinnerId = fairEndingState.winnerId;
  const fairEndingResolvedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isSpectatorMode) return;
    if (fairEndingWinnerId && !matchWinnerId && fairEndingResolvedRef.current !== fairEndingWinnerId) {
      fairEndingResolvedRef.current = fairEndingWinnerId;
      void endLegAndMaybeMatch(fairEndingWinnerId);
    }
  }, [isSpectatorMode, fairEndingWinnerId, matchWinnerId, endLegAndMaybeMatch]);

  // Toggle spectator mode
  const toggleSpectatorMode = useCallback(() => {
    const newSpectatorMode = !isSpectatorMode;
    setIsSpectatorMode(newSpectatorMode);
    
    // Update URL without page reload
    const url = new URL(window.location.href);
    if (newSpectatorMode) {
      url.searchParams.set('spectator', 'true');
    } else {
      url.searchParams.delete('spectator');
    }
    window.history.replaceState({}, '', url.toString());
  }, [isSpectatorMode]);

  const backToGames = useCallback(() => {
    router.push('/games');
  }, [router]);


  if (loading) return <div className="p-4">Loading…</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;
  if (!match || !currentLeg) return <div className="p-4">No leg available</div>;
  if (match.bull_off && (match.bull_off.phase === 'throwing' || (bullOffHandoffPending && !bullOffTransitionReady)) && !match.ended_early && !matchWinnerId) return (
    <BullOffRound matchId={matchId} state={match.bull_off} players={players} spectator={isSpectatorMode}
      hardware={Boolean(match.scolia_board_id)} reload={async () => { await loadMatchOnly(); }}
      commentaryEnabled={commentaryEnabled} commentaryStatus={realtimeCommentaryStatus} toggleCommentary={toggleQuickCommentary}
      commentary={currentCommentary ?? ''} toggleSpectator={toggleSpectatorMode} />
  );
  const matchUrl = origin ? `${origin}/match/${matchId}` : '';

  const rematchPanel = (matchWinnerId || match.ended_early) && !match.tournament_match_id ? (
    <RematchPanel players={orderPlayers} gameLabel={`${match.start_score} ${match.finish === 'double_out' ? 'double out' : 'single out'}`}
      minPlayers={2} showTrigger={isSpectatorMode || Boolean(match.ended_early)} open={rematchOpen} onOpenChange={setRematchOpen} onStart={startRematch} />
  ) : null;

  // Spectator Mode View
  if (isSpectatorMode) {
    return (
      <>
        {rematchPanel}
        <SpectatorView
          rematchOpen={rematchOpen}
          onRematch={!match.tournament_match_id ? () => setRematchOpen(true) : undefined}
          celebration={celebration}
          realtimeConnectionStatus={realtime.connectionStatus}
          realtimeIsConnected={realtime.isConnected}
          spectatorLoading={spectatorLoading}
          matchUrl={matchUrl}
          match={match}
          orderPlayers={orderPlayers}
          spectatorCurrentPlayer={spectatorCurrentPlayer}
          turns={turns}
          turnsByLeg={turnsByLeg}
          currentLegId={currentLeg?.id}
          startScore={startScore}
          finishRule={finishRule}
          turnThrowCounts={turnThrowCounts}
          getAvgForPlayer={getAvgForPlayer}
          legs={legs}
          players={players}
          playerById={playerById}
          matchWinnerId={matchWinnerId}
          onHome={() => router.push('/')}
          onToggleSpectatorMode={toggleSpectatorMode}
          commentaryEnabled={commentaryEnabled}
          realtimeCommentaryStatus={realtimeCommentaryStatus}
          onToggleQuickCommentary={toggleQuickCommentary}
          audioEnabled={audioEnabled}
          voice={voice}
          personaId={personaId}
          onCommentaryEnabledChange={handleCommentaryEnabledChange}
          onAudioEnabledChange={handleAudioEnabledChange}
          onVoiceChange={setVoice}
          onPersonaChange={handlePersonaChange}
          currentCommentary={currentCommentary}
          commentaryTranscriptLog={commentaryTranscriptLog}
          onClearCommentaryTranscriptLog={clearCommentaryTranscriptLog}
          commentaryLoading={commentaryLoading}
          commentaryPlaying={commentaryPlaying}
          onSkipCommentary={skipCommentary}
          onToggleMute={() => setAudioEnabled(!audioEnabled)}
          queueLength={ttsServiceRef.current.getQueueLength()}
          activePersona={activePersona}
          eloChanges={eloChanges}
          eloChangesLoading={eloChangesLoading}
          fairEndingState={fairEndingState}
          dartIQWorkerEvidence={dartIQ.workerEvidence}
          hasPersonalDartIQEvidence={dartIQ.hasPersonalProfiles}
          isHistoryView={historyParam}
          onBackToGames={backToGames}
        />
        <RealtimeDebugPanel
          matchId={matchId}
          connectionStatus={realtime.connectionStatus}
          isSpectatorMode={true}
          enabled={debugRealtime}
        />
        <PerfDebugPanel matchId={matchId} enabled={debugPerf} />
      </>
    );
  }

  return (
    <>
      {rematchPanel}
      <MatchScoringView
        realtimeConnectionStatus={realtime.connectionStatus}
        currentPlayer={currentPlayer}
        getScoreForPlayer={getScoreForPlayer}
        localTurn={localTurn}
        turns={turns}
        turnThrowCounts={turnThrowCounts}
        matchWinnerId={matchWinnerId}
        onBoardClick={handleBoardClick}
        onUndoLastThrow={undoLastThrow}
        onOpenEditModal={openEditModal}
        onOpenEditPlayersModal={openEditPlayersModal}
        onToggleSpectatorMode={toggleSpectatorMode}
        endGameDialogOpen={endGameDialogOpen}
        onEndGameDialogOpenChange={setEndGameDialogOpen}
        endGameLoading={endGameLoading}
        onEndGameEarly={endGameEarly}
        pauseLoading={pauseLoading}
        onTogglePause={togglePause}
        rematchLoading={rematchLoading}
        onStartRematch={() => setRematchOpen(true)}
        editOpen={editOpen}
        onEditOpenChange={setEditOpen}
        editingThrows={editingThrows}
        playerById={playerById}
        selectedThrowId={selectedThrowId}
        onSelectThrow={(throwId) => setSelectedThrowId(throwId)}
        onUpdateThrow={updateSelectedThrow}
        editPlayersOpen={editPlayersOpen}
        onEditPlayersOpenChange={setEditPlayersOpen}
        canEditPlayers={canEditPlayers}
        canReorderPlayers={canReorderPlayers}
        players={players}
        availablePlayers={availablePlayers}
        newPlayerName={newPlayerName}
        onNewPlayerNameChange={setNewPlayerName}
        onAddNewPlayer={addNewPlayer}
        onAddExistingPlayer={addPlayerToMatch}
        onRemovePlayer={removePlayerFromMatch}
        onMovePlayerUp={movePlayerUp}
        onMovePlayerDown={movePlayerDown}
        match={match}
        orderPlayers={orderPlayers}
        turnsByLeg={turnsByLeg}
        legs={legs}
        currentLeg={currentLeg}
        getAvgForPlayer={getAvgForPlayer}
        finishRule={finishRule}
        eloChanges={eloChanges}
        eloChangesLoading={eloChangesLoading}
        fairEndingState={fairEndingState}
        isTournamentMatch={Boolean(match?.tournament_match_id)}
        tournamentId={tournamentId}
      />
      <RealtimeDebugPanel
        matchId={matchId}
        connectionStatus={realtime.connectionStatus}
        isSpectatorMode={false}
        enabled={debugRealtime}
      />
      <PerfDebugPanel matchId={matchId} enabled={debugPerf} />
    </>
  );
}
