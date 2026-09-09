/**
 * MatchClient Component Tests
 *
 * This test file focuses on testing the externally visible behavior of MatchClient.
 * Internal state management tests have been temporarily removed pending component stabilization.
 *
 * TODO: Add tests for:
 * - Player rotation on turn completion
 * - Bust handling
 * - Score updates via realtime events
 * - Checkout suggestions display
 * - Turn history updates
 */

import React from 'react';
import { act, render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, beforeEach, beforeAll, it, expect } from 'vitest';
import {
  createTwoPlayerGameSetup,
  resetQueryLog,
  getQueryLog,
  createMockRouter,
  createMockRealtime,
  createMockSupabaseClient,
  TestQueryProvider,
  type MockDb,
} from '@/test-utils';

type MatchClientComponent = typeof import('./MatchClient').default;
let MatchClient: MatchClientComponent;

// Mock database state
let mockDb: MockDb;
let databaseReadGate: Promise<void> | null = null;
const clone = <T,>(value: T): T => structuredClone(value);

function resetMockDb() {
  mockDb = clone(createTwoPlayerGameSetup());
  resetQueryLog();
  databaseReadGate = null;
}

// Search params mock state
const searchParamsState = { value: '' };
const setSearchParams = (value: string) => {
  searchParamsState.value = value;
};

// Mock router
const mockRouter = createMockRouter();

// Mock realtime
const mockRealtime = createMockRealtime();

// Setup mocks
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: async () => { if (databaseReadGate) await databaseReadGate; return createMockSupabaseClient(mockDb); },
}));

vi.mock('@/lib/dartiq/tracker', () => ({
  DartIQTracker: class {
    update(input: { playerIds: string[]; startScore: number; legs: Array<{ id: string; leg_number: number; starting_player_id: string }> }) {
      const currentLeg = input.legs.at(-1)!;
      return {
        state: {
          legId: currentLeg.id,
          legNumber: currentLeg.leg_number,
          currentPlayerId: currentLeg.starting_player_id,
          currentVisitStartScore: input.startScore,
          dartsRemainingInTurn: 3,
          scores: Object.fromEntries(input.playerIds.map((id) => [id, input.startScore])),
          legsWon: Object.fromEntries(input.playerIds.map((id) => [id, 0])),
          fairEnding: null,
          projections: input.playerIds.map((id) => ({
            id,
            scoreRemaining: input.startScore,
            legsWon: 0,
            matchWinProbability: 1 / input.playerIds.length,
            legWinProbability: 1 / input.playerIds.length,
            expectedVisitsRemaining: 8,
          })),
        },
        currentCheckoutProbability: 0,
        latestEvent: null,
        sequence: 0,
      };
    }
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

vi.mock('next/dynamic', async () => {
  const React = await import('react');

  return {
    default: (
      loader: () => Promise<unknown>,
      options?: {
        loading?: React.ComponentType;
      }
    ) => {
      const LazyComponent = React.lazy(async () => {
        const loaded = await loader();
        if (typeof loaded === 'function') {
          return { default: loaded as React.ComponentType };
        }
        if (
          loaded &&
          typeof loaded === 'object' &&
          'default' in (loaded as Record<string, unknown>) &&
          typeof (loaded as { default?: unknown }).default === 'function'
        ) {
          return { default: (loaded as { default: React.ComponentType }).default };
        }
        throw new Error('Unsupported dynamic import mock result');
      });

      const DynamicComponent = (props: Record<string, unknown>) => (
        <React.Suspense fallback={options?.loading ? React.createElement(options.loading) : null}>
          <LazyComponent {...props} />
        </React.Suspense>
      );
      DynamicComponent.displayName = 'MockNextDynamicComponent';
      return DynamicComponent;
    },
  };
});

vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => mockRealtime,
}));

vi.mock('@/components/Dartboard', () => ({
  default: () => <div data-testid="dartboard" />,
}));

vi.mock('@/components/MobileKeypad', () => ({
  default: () => <div data-testid="mobile-keypad" />,
}));

vi.mock('@/components/ScoreProgressChart', () => ({
  ScoreProgressChart: () => <div data-testid="score-chart" />,
}));

vi.mock('@/components/CommentaryDisplay', () => ({
  default: () => <div data-testid="commentary-display" />,
}));

vi.mock('@/components/CommentarySettings', () => ({
  default: () => <div data-testid="commentary-settings" />,
}));

vi.mock('@/lib/commentary/personas', () => ({
  resolvePersona: () => ({ id: 'chad', label: 'Chad' }),
}));

vi.mock('@/services/commentaryService', () => {
  return {
    generateCommentary: vi.fn().mockResolvedValue({ commentary: null }),
    generateMatchRecap: vi.fn().mockResolvedValue({ commentary: null }),
  };
});

const mockTts = {
  getSettings: () => ({ enabled: false, voice: 'onyx' }),
  updateSettings: vi.fn(),
  unlock: vi.fn(),
  queueCommentary: vi.fn().mockResolvedValue(undefined),
  getIsPlaying: () => false,
  getQueueLength: () => 0,
  skipCurrent: vi.fn(),
};

vi.mock('@/services/ttsService', () => ({
  getTTSService: () => mockTts,
  VoiceOption: undefined,
}));

vi.mock('@/utils/eloRating', () => ({
  updateMatchEloRatings: vi.fn(),
  shouldMatchBeRated: () => false,
}));

vi.mock('@/utils/eloRatingMultiplayer', () => ({
  updateMatchEloRatingsMultiplayer: vi.fn(),
  shouldMatchBeRatedMultiplayer: () => false,
}));

const commentaryTransport = vi.hoisted(() => ({
  connect: vi.fn(), close: vi.fn(), publishBullOff: vi.fn(),
}));
vi.mock('@/services/realtimeCommentaryService', () => ({
  RealtimeCommentaryService: class {
    callbacks: { onStatus?: (status: string) => void };
    constructor(callbacks: { onStatus?: (status: string) => void }) { this.callbacks = callbacks; }
    async connect() { commentaryTransport.connect(); this.callbacks.onStatus?.('ready'); }
    async close() { commentaryTransport.close(); this.callbacks.onStatus?.('idle'); }
    async dispose() { await this.close(); }
    async unlock() {}
    skip() {}
    observeMatchDart() {}
    correct() {}
    getStatus() { return 'ready'; }
    publishBullOff(brief: string, opening: boolean) { commentaryTransport.publishBullOff(brief, opening); return true; }
  },
}));

window.alert = vi.fn();
const createJsonResponse = (data: unknown, ok: boolean = true, status: number = 200) =>
  Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  } as Response);

describe('MatchClient', () => {
  beforeAll(async () => {
    const matchClientModule = await import('./MatchClient');
    MatchClient = matchClientModule.default;
  });

  beforeEach(() => {
    cleanup();
    resetMockDb();
    vi.clearAllMocks();
    setSearchParams('');
    // Reset mockRealtime to default connected state
    mockRealtime.connectionStatus = 'connected';
    mockRealtime.isConnected = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'POST').toUpperCase();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;

      if (url.includes('/api/matches/') && url.includes('/throws') && method === 'DELETE' && body?.turnId) {
        mockDb.throws = mockDb.throws.filter(
          (t) => !(t.turn_id === body.turnId && t.dart_index === body.dartIndex)
        );
        return createJsonResponse({ ok: true });
      }

      if (url.includes('/api/matches/') && url.includes('/throws/') && method === 'DELETE') {
        const throwId = url.split('/throws/')[1]!;
        mockDb.throws = mockDb.throws.filter((t) => t.id !== throwId);
        return createJsonResponse({ ok: true });
      }

      if (url.includes('/api/matches/') && url.includes('/turns/') && method === 'PATCH') {
        const turnId = url.split('/turns/')[1]!;
        mockDb.turns = mockDb.turns.map((t) =>
          t.id === turnId ? { ...t, total_scored: body.totalScored, busted: body.busted } : t
        );
        return createJsonResponse({ ok: true });
      }

      if (url.includes('/api/matches/') && url.includes('/turns/') && method === 'DELETE') {
        const turnId = url.split('/turns/')[1]!;
        mockDb.turns = mockDb.turns.filter((t) => t.id !== turnId);
        mockDb.throws = mockDb.throws.filter((t) => t.turn_id !== turnId);
        return createJsonResponse({ ok: true });
      }

      return createJsonResponse({ ok: true });
    }));
  });

  describe('basic rendering', () => {
    it('renders player names', async () => {
      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);

      // Wait for the component to load and display player names
      const playerCards = await screen.findAllByText('Player One');
      expect(playerCards.length).toBeGreaterThan(0);

      const player2Cards = await screen.findAllByText('Player Two');
      expect(player2Cards.length).toBeGreaterThan(0);

      view.unmount();
    });

    it('renders dartboard and mobile keypad components', async () => {
      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);

      // Wait for component to load
      await screen.findAllByText('Player One');

      expect(screen.getByTestId('dartboard')).toBeDefined();
      expect(screen.getByTestId('mobile-keypad')).toBeDefined();

      view.unmount();
    });
  });

  describe('spectator mode', () => {
    it.each([[false, false], [true, false], [true, true]])('hands off to spectator X01 without reconnecting commentary (enabled=%s, first dart=%s)', async (withCommentary, firstDart) => {
      const { createBullOff, recordBullOffShot, finishBullOffTakeout } = await import('@/lib/match/bullOff');
      vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
      setSearchParams(withCommentary ? 'spectator=true&commentary=true' : 'spectator=true');
      mockDb.turns = [];
      mockDb.throws = [];
      let state = createBullOff(['player-1', 'player-2']);
      state = finishBullOffTakeout(recordBullOffShot(state, { playerId: 'player-1', distanceMm: 152.4 }));
      state = recordBullOffShot(state, { playerId: 'player-2', distanceMm: 25.4 });
      Object.assign(mockDb.matches[0]!, { bull_off: state });
      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);
      await screen.findByRole('heading', { name: 'Bull-off' });
      expect(screen.queryByText('Live Match')).toBeNull();

      const connectionCount = commentaryTransport.connect.mock.calls.length;
      const closeCount = commentaryTransport.close.mock.calls.length;
      let releaseReads!: () => void;
      databaseReadGate = new Promise<void>(resolve => { releaseReads = resolve; });
      const completed = finishBullOffTakeout(state);
      Object.assign(mockDb.matches[0]!, { bull_off: completed });
      // The match event arrives while the browser still has the original order.
      await act(async () => { window.dispatchEvent(new CustomEvent('supabase-matches-change', { detail: { new: clone(mockDb.matches[0]) } })); });
      expect(screen.getByRole('heading', { name: 'Bull-off' })).toBeInTheDocument();
      expect(screen.queryByText('Live Match')).toBeNull();
      expect(screen.queryByText('Loading…')).toBeNull();
      expect(commentaryTransport.publishBullOff).not.toHaveBeenCalled();

      mockDb.match_players.forEach(row => { row.play_order = completed.order.indexOf(row.player_id); });
      mockDb.legs[0]!.starting_player_id = 'player-2';
      if (firstDart) {
        mockDb.turns.push({ id: 'first-x01', leg_id: 'leg-1', player_id: 'player-2', turn_number: 1, total_scored: 20, busted: false, tiebreak_round: null });
        mockDb.throws.push({ id: 'first-dart', turn_id: 'first-x01', dart_index: 1, segment: 'S20', scored: 20, match_id: 'match-1' });
      }
      await act(async () => { databaseReadGate = null; releaseReads(); });
      await screen.findByText('Live Match', undefined, { timeout: 5000 });
      expect(screen.queryByRole('heading', { name: 'Bull-off' })).toBeNull();
      const scores = screen.getByRole('list', { name: 'Live player scores' });
      const tiles = within(scores).getAllByRole('listitem');
      expect(tiles[0]).toHaveTextContent('Player Two');
      expect(tiles[0]).toHaveAttribute('aria-current', 'true');
      expect(tiles[1]).toHaveTextContent('Player One');
      expect(tiles[0]).toHaveAttribute('data-score', firstDart ? '481' : '501');
      expect(tiles[1]).toHaveAttribute('data-score', '501');
      expect(mockDb.turns).toHaveLength(firstDart ? 1 : 0);
      expect(mockDb.throws).toHaveLength(firstDart ? 1 : 0);
      expect(mockRouter.push).not.toHaveBeenCalled();
      expect(commentaryTransport.connect).toHaveBeenCalledTimes(connectionCount);
      expect(commentaryTransport.close).toHaveBeenCalledTimes(closeCount);
      if (withCommentary && !firstDart) {
        expect(connectionCount).toBeGreaterThan(0);
        expect(commentaryTransport.publishBullOff).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('First to throw: Player Two.'), true);
        expect(commentaryTransport.publishBullOff.mock.calls[0][0]).toContain('Every player starts at 501');
      } else expect(commentaryTransport.publishBullOff).not.toHaveBeenCalled();
      view.unmount();
      vi.unstubAllGlobals();
    });

    it('boots directly into spectator mode from URL params on first render', async () => {
      setSearchParams('spectator=true');
      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);

      await screen.findByText('Live Match', undefined, { timeout: 5_000 });
      expect(screen.queryByText('Undo dart')).toBeNull();

      view.unmount();
    });

    it('avoids extra throws queries during spectator initial load', async () => {
      setSearchParams('spectator=true');
      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);

      await screen.findByText('Live Match', undefined, { timeout: 5_000 });

      const logSnapshot = getQueryLog();
      const throwSelects = logSnapshot.filter(
        (entry) => entry.table === 'throws' && entry.operation === 'select'
      );
      expect(throwSelects.length, JSON.stringify(logSnapshot)).toBe(0);
      view.unmount();
    });

    it('renders spectator view even when realtime is disconnected', async () => {
      setSearchParams('spectator=true');
      mockRealtime.connectionStatus = 'connecting';
      mockRealtime.isConnected = false;

      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);

      const spectatorCards = await screen.findAllByText('Player One');
      expect(spectatorCards.length).toBeGreaterThan(0);
      expect(screen.queryByText('Loading…')).toBeNull();
      view.unmount();
    });

    it('shows Live Match indicator in spectator mode', async () => {
      setSearchParams('spectator=true');
      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);

      const liveIndicator = await screen.findByText('Live Match', undefined, { timeout: 5_000 });
      expect(liveIndicator).toBeDefined();

      view.unmount();
    });

    it('renders completed-game links as a read-only stats view', async () => {
      setSearchParams('spectator=true&history=true');
      mockDb.matches[0]!.legs_to_win = 1;
      mockDb.legs[0]!.winner_player_id = 'player-1';
      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);

      expect(await screen.findByRole('heading', { name: 'Match Stats' })).toBeInTheDocument();
      expect(screen.getByText('Champion')).toBeInTheDocument();
      expect(screen.getByText('Final Leg Score Progress')).toBeInTheDocument();
      expect(screen.queryByText('Live Match')).not.toBeInTheDocument();
      expect(screen.queryByText('Undo dart')).not.toBeInTheDocument();

      view.unmount();
    });
  });

  describe('turn rotation (game state)', () => {
    it('shows the next player after a completed 3-dart turn (even without realtime events)', async () => {
      // Setup: Player One has completed a full 3-dart turn, so it should now be Player Two's turn.
      mockDb.turns = [
        {
          id: 'turn-1',
          leg_id: 'leg-1',
          player_id: 'player-1',
          turn_number: 1,
          total_scored: 60,
          busted: false,
        },
      ];
      mockDb.throws = [
        { id: 'throw-1', turn_id: 'turn-1', dart_index: 1, segment: 'S20', scored: 20, match_id: 'match-1' },
        { id: 'throw-2', turn_id: 'turn-1', dart_index: 2, segment: 'S20', scored: 20, match_id: 'match-1' },
        { id: 'throw-3', turn_id: 'turn-1', dart_index: 3, segment: 'S20', scored: 20, match_id: 'match-1' },
      ];

      // Make sure we don't rely on realtime updates to derive throw counts.
      mockRealtime.isConnected = false;
      mockRealtime.connectionStatus = 'offline';

      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);

      // Wait for main UI to render
      await screen.findAllByText('Undo dart');

      // Current-player badge should reflect Player Two (start score 501)
      const badges = await screen.findAllByText('501 pts');
      expect(badges.length).toBeGreaterThan(0);
      for (const badge of badges) {
        expect(badge.parentElement?.textContent).toContain('Player Two');
      }

      view.unmount();
    });

    it('switches back to the previous player after undo makes the last turn incomplete', async () => {
      // Setup: Player One has completed a full 3-dart turn, so it should now be Player Two's turn.
      mockDb.turns = [
        {
          id: 'turn-1',
          leg_id: 'leg-1',
          player_id: 'player-1',
          turn_number: 1,
          total_scored: 60,
          busted: false,
        },
      ];
      mockDb.throws = [
        { id: 'throw-1', turn_id: 'turn-1', dart_index: 1, segment: 'S20', scored: 20, match_id: 'match-1' },
        { id: 'throw-2', turn_id: 'turn-1', dart_index: 2, segment: 'S20', scored: 20, match_id: 'match-1' },
        { id: 'throw-3', turn_id: 'turn-1', dart_index: 3, segment: 'S20', scored: 20, match_id: 'match-1' },
      ];

      // Make sure we don't rely on realtime updates to derive throw counts.
      mockRealtime.isConnected = false;
      mockRealtime.connectionStatus = 'offline';

      const user = userEvent.setup();
      const view = render(<TestQueryProvider><MatchClient matchId="match-1" /></TestQueryProvider>);

      // Initially: it's Player Two with full start score.
      await screen.findAllByText('Undo dart');
      await screen.findAllByText('501 pts');

      // Undo last dart: Player One's turn becomes incomplete (2 darts), so turn should switch back.
      const undoButtons = screen.getAllByText('Undo dart');
      await user.click(undoButtons[0]!);

      const badges = await screen.findAllByText('461 pts');
      expect(badges.length).toBeGreaterThan(0);
      for (const badge of badges) {
        expect(badge.parentElement?.textContent).toContain('Player One');
      }

      view.unmount();
    });
  });
});
