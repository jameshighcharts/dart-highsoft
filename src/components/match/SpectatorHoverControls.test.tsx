import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPECTATOR_CONTROLS_IDLE_MS, SpectatorHoverControls, SpectatorUndoDartButton } from './SpectatorHoverControls';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const controls = () => screen.getByTestId('spectator-hover-controls');
const exitButton = () => screen.getByRole('button', { name: 'Exit spectator mode' });

describe('spectator hover controls', () => {
  it('stays hidden until the pointer moves, then hides after idling', () => {
    render(<SpectatorHoverControls onExit={() => {}} />);
    expect(controls().dataset.visible).toBe('false');
    fireEvent.pointerMove(window);
    expect(controls().dataset.visible).toBe('true');
    act(() => { vi.advanceTimersByTime(SPECTATOR_CONTROLS_IDLE_MS); });
    expect(controls().dataset.visible).toBe('false');
  });

  it('reveals on touch', () => {
    render(<SpectatorHoverControls onExit={() => {}} />);
    fireEvent.pointerDown(window);
    expect(controls().dataset.visible).toBe('true');
  });

  it('stays visible while hovered and exits spectator mode on click', () => {
    const onExit = vi.fn();
    render(<SpectatorHoverControls onExit={onExit} />);
    fireEvent.pointerMove(window);
    fireEvent.pointerEnter(screen.getByRole('toolbar'));
    act(() => { vi.advanceTimersByTime(SPECTATOR_CONTROLS_IDLE_MS * 2); });
    expect(controls().dataset.visible).toBe('true');
    fireEvent.click(exitButton());
    expect(onExit).toHaveBeenCalledOnce();
    fireEvent.pointerLeave(screen.getByRole('toolbar'));
    act(() => { vi.advanceTimersByTime(SPECTATOR_CONTROLS_IDLE_MS); });
    expect(controls().dataset.visible).toBe('false');
  });

  it('renders extra actions next to the exit button', () => {
    render(<SpectatorHoverControls onExit={() => {}}><button type="button">Undo dart</button></SpectatorHoverControls>);
    expect(screen.getByRole('button', { name: 'Undo dart' }).parentElement).toBe(screen.getByRole('toolbar'));
  });

  it('undoes one dart at a time', async () => {
    let finish = () => {};
    const onUndo = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<SpectatorUndoDartButton onUndo={onUndo} />);
    const undo = screen.getByRole('button', { name: 'Undo dart' });
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledOnce();
    expect(undo).toBeDisabled();
    expect(screen.getByText('Undoing…')).toBeTruthy();
    await act(async () => { finish(); });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(2);
  });

  it('cannot undo when disabled', () => {
    const onUndo = vi.fn(async () => {});
    render(<SpectatorUndoDartButton onUndo={onUndo} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo dart' }));
    expect(onUndo).not.toHaveBeenCalled();
  });
});
