"use client";

import { useQuery } from '@tanstack/react-query';
import { BullersLeaderboard } from '@/components/leaderboard/BullersLeaderboard';
import { leaderboardListsQuery } from '@/lib/queries/leaderboardData';
import { LeaderboardSection, EloLeaderboardItem, PlayerSummaryItem, GameModeLeaderboardItem } from '@/components/leaderboard';
import { PlayerAvatarById } from '@/components/PlayerAvatarById';
import {
  bullersQuery,
  gameModeLeadersQuery,
  highestCheckoutsQuery,
  quickestLegsQuery,
  topRoundScoresQuery,
} from '@/lib/queries/leaderboards';
import { medal, formatLeaderboardDate } from '@/utils/leaderboard';
import { GAME_MODE_INFO, GAME_MODE_ORDER } from '@/lib/games/labels';

export default function LeaderboardsPage() {
  const lists = useQuery(leaderboardListsQuery(10));
  const { leaders = [], avgLeaders = [], eloLeaders = [], eloMultiLeaders = [] } = lists.data ?? {};
  const loading = lists.isLoading;
  const bullers = useQuery(bullersQuery());
  const topRoundScores = useQuery(topRoundScoresQuery());
  const highestCheckouts = useQuery(highestCheckoutsQuery());
  const quickestLegs = useQuery(quickestLegsQuery());
  const gameModeLeaders = useQuery(gameModeLeadersQuery());

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Leaderboards</h1>
        <p className="text-muted-foreground">Comprehensive rankings and achievements across all game modes</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <LeaderboardSection
          title="Top 10 Multiplayer Elo Ratings"
          loading={loading}
          emptyMessage="No multiplayer Elo ratings yet."
          emptySubMessage="Complete some 3+ player matches to see rankings!"
          isEmpty={eloMultiLeaders.length === 0}
        >
          {eloMultiLeaders.map((entry, idx) => (
            <EloLeaderboardItem key={entry.player_id} entry={entry} index={idx} />
          ))}
        </LeaderboardSection>

        <LeaderboardSection
          title="Top 10 Match Winners"
          loading={loading}
          emptyMessage="No matches recorded yet."
          isEmpty={leaders.length === 0}
        >
          {leaders.map((row, idx) => (
            <PlayerSummaryItem key={row.player_id} entry={row} index={idx} primaryMetric="wins" />
          ))}
        </LeaderboardSection>

        <LeaderboardSection
          title="Top 10 by Average Score"
          loading={loading}
          emptyMessage="No average scores to display yet."
          isEmpty={avgLeaders.length === 0}
        >
          {avgLeaders.map((row, idx) => (
            <PlayerSummaryItem key={row.player_id} entry={row} index={idx} primaryMetric="avg" />
          ))}
        </LeaderboardSection>

        <LeaderboardSection
          title="Top 10 Elo Ratings"
          loading={loading}
          emptyMessage="No Elo ratings yet."
          emptySubMessage="Complete some 1v1 matches to see Elo rankings!"
          isEmpty={eloLeaders.length === 0}
        >
          {eloLeaders.map((entry, idx) => (
            <EloLeaderboardItem key={entry.player_id} entry={entry} index={idx} />
          ))}
        </LeaderboardSection>

        <BullersLeaderboard entries={bullers.data ?? []} loading={bullers.isPending} error={bullers.isError && !bullers.data} />

        {/* Top 10 Round Scores of All Time */}
        <LeaderboardSection
          title="Top 10 Round Scores of All Time"
          loading={topRoundScores.isPending}
          loadingLabel="Loading top scores..."
          emptyMessage="No round scores recorded yet."
          isEmpty={!topRoundScores.data?.length}
        >
          {topRoundScores.data?.map((score, idx) => (
            <li key={score.id} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-8 text-lg text-center">{medal(idx)}</span>
                <PlayerAvatarById playerId={score.player_id} name={score.display_name} size="sm" />
                <div>
                  <div className="font-medium">{score.display_name}</div>
                  <div className="text-xs text-muted-foreground">{formatLeaderboardDate(score.created_at)}</div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="font-mono tabular-nums text-2xl font-bold text-primary">{score.total_scored}</div>
                {score.total_scored === 180 && <span className="text-lg">🎯</span>}
                {score.total_scored >= 140 && score.total_scored < 180 && <span className="text-lg">🔥</span>}
              </div>
            </li>
          ))}
        </LeaderboardSection>

        {/* Highest Checkouts */}
        <LeaderboardSection
          title="Highest Checkouts"
          loading={highestCheckouts.isPending}
          loadingLabel="Loading checkouts..."
          emptyMessage="No checkouts recorded yet."
          isEmpty={!highestCheckouts.data?.length}
        >
          {highestCheckouts.data?.map((score, idx) => (
            <li key={`${score.player_id}-${score.date}`} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-8 text-lg text-center">{medal(idx)}</span>
                <PlayerAvatarById playerId={score.player_id} name={score.display_name} size="sm" />
                <div>
                  <div className="font-medium">{score.display_name}</div>
                  <div className="text-xs text-muted-foreground">{formatLeaderboardDate(score.date)}</div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="font-mono tabular-nums text-2xl font-bold">{score.score}</div>
                  <div className="text-xs text-muted-foreground">{score.darts_used} darts</div>
                </div>
                {score.score >= 100 && <span className="text-lg">🚀</span>}
              </div>
            </li>
          ))}
        </LeaderboardSection>

        {/* Quickest Legs (Double Out) */}
        <LeaderboardSection
          title="Quickest Legs (Double Out)"
          loading={quickestLegs.isPending}
          loadingLabel="Loading quickest legs..."
          emptyMessage="No double-out legs recorded yet."
          isEmpty={!quickestLegs.data?.double.length}
        >
          {quickestLegs.data?.double.map((leg, idx) => (
            <li key={`${leg.player_id}-${leg.date}`} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-8 text-lg text-center">{medal(idx)}</span>
                <PlayerAvatarById playerId={leg.player_id} name={leg.display_name} size="sm" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{leg.display_name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-medium ${
                      leg.start_score === '501' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                      leg.start_score === '301' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}>
                      {leg.start_score}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{formatLeaderboardDate(leg.date)}</div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="font-mono tabular-nums text-2xl font-bold text-blue-600 dark:text-blue-400">{leg.dart_count}</div>
                  <div className="text-xs text-muted-foreground">darts</div>
                </div>
              </div>
            </li>
          ))}
        </LeaderboardSection>

        {/* Quickest Legs (Single Out) */}
        <LeaderboardSection
          title="Quickest Legs (Single Out)"
          loading={quickestLegs.isPending}
          loadingLabel="Loading quickest legs..."
          emptyMessage="No single-out legs recorded yet."
          isEmpty={!quickestLegs.data?.single.length}
        >
          {quickestLegs.data?.single.map((leg, idx) => (
            <li key={`${leg.player_id}-${leg.date}`} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-8 text-lg text-center">{medal(idx)}</span>
                <PlayerAvatarById playerId={leg.player_id} name={leg.display_name} size="sm" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{leg.display_name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-medium ${
                      leg.start_score === '501' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                      leg.start_score === '301' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}>
                      {leg.start_score}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{formatLeaderboardDate(leg.date)}</div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="font-mono tabular-nums text-2xl font-bold text-green-600 dark:text-green-400">{leg.dart_count}</div>
                  <div className="text-xs text-muted-foreground">darts</div>
                </div>
              </div>
            </li>
          ))}
        </LeaderboardSection>
      </div>

      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Game modes</h2>
        <div className="grid md:grid-cols-2 gap-6">
          {GAME_MODE_ORDER.map((mode) => {
            const info = GAME_MODE_INFO[mode];
            const entries = gameModeLeaders.data?.[mode] ?? [];
            return (
              <LeaderboardSection
                key={mode}
                title={`Top 10 ${info.name}`}
                loading={gameModeLeaders.isPending}
                loadingLabel={`Loading ${info.name} leaderboard...`}
                emptyMessage={`No ${info.name} games yet`}
                isEmpty={entries.length === 0}
              >
                {entries.map((entry, idx) => (
                  <GameModeLeaderboardItem key={entry.player_id} entry={entry} mode={mode} index={idx} />
                ))}
              </LeaderboardSection>
            );
          })}
        </div>
      </div>
    </div>
  );
}
