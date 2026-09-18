/** @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}} */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompassTvButton } from './CompassTvButton';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

let fullscreenElement: Element | null;
const requestFullscreen = vi.fn(async () => { fullscreenElement = document.documentElement; });
const exitFullscreen = vi.fn(async () => { fullscreenElement = null; });

beforeEach(() => {
  fullscreenElement = null;
  requestFullscreen.mockClear();
  exitFullscreen.mockClear();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });
});
afterEach(cleanup);

it('loads Compass only on demand and returns to the same results', async () => {
  const user = userEvent.setup();
  render(<><h1>Match results</h1><CompassTvButton /></>);
  expect(screen.queryByTitle('Compass TV slideshow')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Compass TV' }));
  expect(screen.getByTitle('Compass TV slideshow')).toHaveAttribute('src', 'https://compass.highsoftlabs.com/tv');
  expect(requestFullscreen).toHaveBeenCalledOnce();
  const iframe = screen.getByTitle('Compass TV slideshow');
  await user.click(screen.getByRole('button', { name: 'Reload slideshow' }));
  expect(screen.getByTitle('Compass TV slideshow')).not.toBe(iframe);
  await user.click(screen.getByRole('button', { name: 'Back to darts' }));
  expect(exitFullscreen).toHaveBeenCalledOnce();
  expect(screen.queryByTitle('Compass TV slideshow')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Match results' })).toBeVisible();
});

it('still opens and closes when the browser refuses fullscreen', async () => {
  requestFullscreen.mockRejectedValueOnce(new Error('Fullscreen denied'));
  const user = userEvent.setup();
  render(<CompassTvButton />);
  await user.click(screen.getByRole('button', { name: 'Compass TV' }));
  expect(screen.getByTitle('Compass TV slideshow')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open Compass' })).toHaveAttribute('target', '_blank');
  await user.click(screen.getByRole('button', { name: 'Back to darts' }));
  expect(exitFullscreen).not.toHaveBeenCalled();
});

it('preserves fullscreen that was active before opening Compass', async () => {
  fullscreenElement = document.documentElement;
  const user = userEvent.setup();
  render(<CompassTvButton />);
  await user.click(screen.getByRole('button', { name: 'Compass TV' }));
  await user.click(screen.getByRole('button', { name: 'Back to darts' }));
  expect(requestFullscreen).not.toHaveBeenCalled();
  expect(exitFullscreen).not.toHaveBeenCalled();
});

it('releases its fullscreen when navigating away', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<CompassTvButton />);
  await user.click(screen.getByRole('button', { name: 'Compass TV' }));
  unmount();
  expect(exitFullscreen).toHaveBeenCalledOnce();
});

it('releases a delayed fullscreen request after the slideshow closes', async () => {
  let resolveRequest: () => void = () => {};
  requestFullscreen.mockImplementationOnce(() => new Promise<void>(resolve => {
    resolveRequest = () => { fullscreenElement = document.documentElement; resolve(); };
  }));
  const user = userEvent.setup();
  render(<CompassTvButton />);
  await user.click(screen.getByRole('button', { name: 'Compass TV' }));
  await user.click(screen.getByRole('button', { name: 'Back to darts' }));
  resolveRequest();
  await waitFor(() => expect(exitFullscreen).toHaveBeenCalledOnce());
});

it('opens from the winner dialog and restores that dialog on return', async () => {
  const user = userEvent.setup();
  render(<Dialog defaultOpen><DialogContent aria-describedby={undefined}>
    <DialogTitle>Match Winner</DialogTitle><CompassTvButton />
  </DialogContent></Dialog>);
  await user.click(screen.getByRole('button', { name: 'Compass TV' }));
  expect(screen.getByRole('dialog', { name: 'Compass TV slideshow' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Back to darts' }));
  expect(screen.getByRole('dialog', { name: 'Match Winner' })).toBeVisible();
});
