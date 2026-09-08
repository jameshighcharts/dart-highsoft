import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectedPlayerLineup } from './SelectedPlayerLineup';
const player = { id: 'alice', display_name: 'Alice' };
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: false })); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('updates selection immediately while keeping the removed avatar for its exit', () => {
  const remove = vi.fn();
  const { rerender } = render(<SelectedPlayerLineup players={[player]} onRemove={remove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Alice' }));
  expect(remove).toHaveBeenCalledWith('alice');
  rerender(<SelectedPlayerLineup players={[]} onRemove={remove} />);
  expect(screen.getByRole('button', { hidden: true })).toBeDisabled();
  expect(screen.getByRole('button', { hidden: true })).toHaveClass('exiting-lineup-avatar');
  act(() => { vi.advanceTimersByTime(320); });
  expect(screen.queryByRole('button', { hidden: true })).toBeNull();
  expect(screen.getByText('Choose your lineup')).toBeInTheDocument();
});
it('cancels pending removal if the player is selected again during the exit', () => {
  const { rerender } = render(<SelectedPlayerLineup players={[player]} onRemove={vi.fn()} />);
  rerender(<SelectedPlayerLineup players={[]} onRemove={vi.fn()} />);
  act(() => { vi.advanceTimersByTime(100); });
  rerender(<SelectedPlayerLineup players={[player]} onRemove={vi.fn()} />);
  act(() => { vi.advanceTimersByTime(500); });
  expect(screen.getByRole('button', { name: 'Remove Alice' })).toBeEnabled();
});
it('removes immediately when reduced motion is enabled', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const { rerender } = render(<SelectedPlayerLineup players={[player]} onRemove={vi.fn()} />);
  rerender(<SelectedPlayerLineup players={[]} onRemove={vi.fn()} />);
  expect(screen.queryByRole('button', { hidden: true })).toBeNull();
});
