import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BullersLeaderboard } from './BullersLeaderboard';
vi.mock('@/components/PlayerAvatarById', () => ({ PlayerAvatarById: () => null }));
afterEach(cleanup);
it('shows measured averages with inch marks, sample size and misses', () => {
  render(<BullersLeaderboard loading={false} error={false} entries={[{ player_id: 'a', display_name: 'Ada', average_inches: '1.23456', measured_darts: 4, misses: 1, bull_offs: 3 }]} />);
  expect(screen.getByText('Top 10 Bullers')).toBeInTheDocument();
  expect(screen.getByLabelText('1.23 inches average')).toHaveTextContent('1.23″');
  expect(screen.getByText('4 measured darts · 1 miss')).toBeInTheDocument();
  expect(screen.getByText(/misses excluded from average/)).toBeInTheDocument();
});
it('distinguishes an empty board from a loading failure', () => {
  const { rerender } = render(<BullersLeaderboard entries={[]} loading error={false} />);
  expect(screen.getByText('Loading bullers…')).toBeInTheDocument();
  rerender(<BullersLeaderboard entries={[]} loading={false} error={false} />);
  expect(screen.getByText('No measured bull-off darts yet.')).toBeInTheDocument();
  rerender(<BullersLeaderboard entries={[]} loading={false} error />);
  expect(screen.getByText('Could not load bullers. Please refresh to retry.')).toBeInTheDocument();
});
