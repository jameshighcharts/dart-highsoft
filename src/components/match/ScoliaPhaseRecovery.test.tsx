import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoliaPhaseRecovery, ScoliaTakeoutRecovery } from './ScoliaPhaseRecovery';
import { SCOLIA_STUCK_TAKEOUT_MS } from '@/lib/scolia/availability';
const board = vi.hoisted(() => ({ phase: 'Throw' as string | null, changedAt: null as string | null, upsert: (() => {}) as (value: { boardId: string; boardPhase: string; boardPhaseChangedAt?: string }) => void }));
vi.mock('@/lib/supabaseClient', () => ({ getSupabaseClient: async () => ({ from: () => {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { board_phase: board.phase, board_phase_changed_at: board.changedAt }, error: null }) };
  return query;
} }) }));
vi.mock('@/hooks/useScoliaBoardRealtime', () => ({ useScoliaBoardRealtime: (handlers: { onUpsert: typeof board.upsert }) => { board.upsert = handlers.onUpsert; } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

describe('stuck takeout recovery', () => {
  afterEach(() => { vi.useRealTimers(); });
  const renderRecovery = async () => { await act(async () => { render(<ScoliaTakeoutRecovery matchId="match" boardId="board" />); }); };

  it.each(['Throw', null])('never prompts in phase %s', async phase => {
    vi.useFakeTimers();
    board.phase = phase;
    await renderRecovery();
    await act(async () => { vi.advanceTimersByTime(SCOLIA_STUCK_TAKEOUT_MS * 2); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('waits out a normal dart removal before prompting', async () => {
    vi.useFakeTimers();
    board.phase = 'Takeout';
    await renderRecovery();
    await act(async () => { vi.advanceTimersByTime(SCOLIA_STUCK_TAKEOUT_MS - 1000); });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('prompts at once when the match starts on a board already stuck in Takeout', async () => {
    vi.useFakeTimers();
    board.phase = 'Takeout';
    board.changedAt = '2026-09-27T10:00:00Z';
    await act(async () => { render(<ScoliaTakeoutRecovery matchId="match" boardId="board" matchCreatedAt="2026-09-27T10:05:00Z" />); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    board.changedAt = null;
  });

  it('never prompts once the match has started, even for a long or left-over takeout', async () => {
    vi.useFakeTimers();
    board.phase = 'Takeout';
    board.changedAt = '2026-09-27T10:00:00Z';
    await act(async () => { render(<ScoliaTakeoutRecovery matchId="match" boardId="board" matchCreatedAt="2026-09-27T10:05:00Z" matchStarted />); });
    await act(async () => { vi.advanceTimersByTime(SCOLIA_STUCK_TAKEOUT_MS * 3); });
    expect(screen.queryByRole('dialog')).toBeNull();
    board.changedAt = null;
  });

  it('closes when the board leaves Takeout and restarts the clock on the next takeout', async () => {
    vi.useFakeTimers();
    board.phase = 'Takeout';
    await renderRecovery();
    await act(async () => { vi.advanceTimersByTime(SCOLIA_STUCK_TAKEOUT_MS); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    act(() => board.upsert({ boardId: 'board', boardPhase: 'Throw', boardPhaseChangedAt: 't1' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => board.upsert({ boardId: 'board', boardPhase: 'Takeout', boardPhaseChangedAt: 't2' }));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('requires the empty-board action and waits for the reported Throw phase', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ commandId: 'reset' }, 202))
      .mockResolvedValueOnce(response({ status: 'acknowledged', phase: 'Throw' }));
    vi.stubGlobal('fetch', fetch);
    const onPhase = vi.fn();
    render(<ScoliaPhaseRecovery matchId="match" onPhase={onPhase} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Board is empty — reset' }));
    await waitFor(() => expect(onPhase).toHaveBeenCalledWith('Throw'));
    expect(fetch.mock.calls[0][1].method).toBe('POST');
  });

  it('keeps a refused reset visible and allows retry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ commandId: 'reset' }, 202))
      .mockResolvedValueOnce(response({ status: 'refused', phase: 'Takeout', error: 'Board not Ready' }));
    vi.stubGlobal('fetch', fetch);
    const onPhase = vi.fn();
    render(<ScoliaPhaseRecovery matchId="match" onPhase={onPhase} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Board is empty — reset' })));
    expect(await screen.findByRole('alert')).toHaveTextContent('Board not Ready');
    expect(screen.getByRole('button', { name: 'Board is empty — reset' })).toBeEnabled();
    expect(onPhase).not.toHaveBeenCalled();
  });
});
