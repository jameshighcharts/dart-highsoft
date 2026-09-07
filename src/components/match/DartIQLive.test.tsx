import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockPlayer } from '@/test-utils/factories';
import { DartIQTracker } from '@/lib/dartiq/tracker';
import { DartIQLive, WorkerDartIQLive } from './DartIQLive';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('DartIQLive next-dart forecast', () => {
  const players = [createMockPlayer({ id: 'a', display_name: 'Alice' }), createMockPlayer({ id: 'b', display_name: 'Bob' })];
  const snapshot = new DartIQTracker().update({
    playerIds: ['a', 'b'], startScore: 301, finishRule: 'double_out', legsToWin: 1,
    legs: [{ id: 'leg', match_id: 'match', leg_number: 1, starting_player_id: 'a', winner_player_id: null }],
    turnsByLeg: {},
  });
  const props = { orderPlayers: players, legsToWin: 1, matchWinnerId: null, snapshot, hasPersonalProfiles: false };

  it('paints urgent content before analysis and cancels superseded or unmounted work', () => {
    const instances: MockWorker[] = [];
    class MockWorker {
      onmessage?: (event: { data: { id: number; snapshot: typeof snapshot } }) => void;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() { instances.push(this); }
    }
    vi.stubGlobal('Worker', MockWorker);
    const update = vi.spyOn(DartIQTracker.prototype, 'update').mockReturnValue(snapshot);
    const input = { playerIds: ['a', 'b'], startScore: 301, finishRule: 'double_out' as const, legsToWin: 1, legs: [], turnsByLeg: {} };
    const evidence = { playerProfiles: [], playerOutcomes: [], populationOutcomes: [] };
    const view = render(<><span>dart painted</span><WorkerDartIQLive {...props} input={input} evidence={evidence} /></>);
    expect(screen.getByText('dart painted')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
    const corrected = { ...input, startScore: 501 };
    view.rerender(<><span>dart painted</span><WorkerDartIQLive {...props} input={corrected} evidence={evidence} /></>);
    expect(instances[0].postMessage).toHaveBeenCalledTimes(1);
    act(() => instances[0].onmessage?.({ data: { id: 1, snapshot } }));
    expect(instances[0].postMessage).toHaveBeenLastCalledWith({ id: 2, input: corrected });
    expect(screen.queryByText('Alice · next dart')).toBeNull();
    act(() => instances[0].onmessage?.({ data: { id: 2, snapshot } }));
    expect(update).not.toHaveBeenCalled();
    view.unmount();
    expect(instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('has no placeholder or warning while geometry is unavailable', () => {
    render(<DartIQLive {...props} />);
    expect(screen.queryByLabelText('Next dart landing forecast')).toBeNull();
  });

  it('keeps the same card and forecast space mounted between worker results', () => {
    let reply: (id: number) => void = () => {};
    const forecastSnapshot = { ...snapshot, nextDartForecast: {
      artifactId: 'geometry-1', segments: [{ segment: 'S20', probability: 1 }],
    } };
    class MockWorker {
      onmessage?: (event: { data: { id: number; snapshot: typeof snapshot } }) => void;
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() { reply = (id) => this.onmessage?.({ data: { id, snapshot: forecastSnapshot } }); }
    }
    vi.stubGlobal('Worker', MockWorker);
    const input = { playerIds: ['a', 'b'], startScore: 301, finishRule: 'double_out' as const, legsToWin: 1, legs: [], turnsByLeg: {} };
    const evidence = { playerProfiles: [], playerOutcomes: [], populationOutcomes: [] };
    const view = render(<WorkerDartIQLive {...props} input={input} evidence={evidence} />);
    act(() => reply(1));
    const card = screen.getByText('Live win probability').closest('[data-slot="card"]');
    const forecast = screen.getByLabelText('Next dart landing forecast');
    view.rerender(<WorkerDartIQLive {...props} input={{ ...input, startScore: 501 }} evidence={evidence} />);
    expect(screen.getByText('Live win probability').closest('[data-slot="card"]')).toBe(card);
    expect(screen.getByLabelText('Next dart landing forecast')).toBe(forecast);
    expect(forecast.classList.contains('invisible')).toBe(true);
    expect(forecast.getAttribute('aria-hidden')).toBe('true');
    expect(card?.parentElement?.getAttribute('aria-busy')).toBe('true');
    act(() => reply(2));
    expect(screen.getByText('Live win probability').closest('[data-slot="card"]')).toBe(card);
    expect(forecast.classList.contains('invisible')).toBe(false);
    expect(card?.parentElement?.getAttribute('aria-busy')).toBe('false');
    view.rerender(<WorkerDartIQLive {...props} input={input} evidence={{ ...evidence }} />);
    expect(screen.queryByText('Live win probability')).toBeNull();
  });

  it('shows likely landing segments and their actual probabilities', () => {
    render(<DartIQLive {...props} snapshot={{ ...snapshot, nextDartForecast: {
      artifactId: 'geometry-1', segments: [{ segment: 'S20', probability: 0.6 }, { segment: 'S5', probability: 0.25 }],
    } }} />);
    const forecast = screen.getByLabelText('Next dart landing forecast');
    expect(forecast.textContent).toContain('Alice · next dart');
    expect(forecast.textContent).toContain('S20 60%');
    expect(forecast.textContent).toContain('S5 25%');
  });

  it('hides a retained forecast after the match finishes', () => {
    render(<DartIQLive {...props} matchWinnerId="a" snapshot={{ ...snapshot, nextDartForecast: {
      artifactId: 'geometry-1', segments: [{ segment: 'S20', probability: 1 }],
    } }} />);
    expect(screen.queryByLabelText('Next dart landing forecast')).toBeNull();
  });
});
