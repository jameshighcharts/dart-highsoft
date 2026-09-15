// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HighdartsSheet } from './HighdartsSheet';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const source = () => screen.getByTitle('Highdarts 2026 Google Sheet').getAttribute('src');

it('requests a fresh published iframe on manual and timed refreshes', () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  render(<HighdartsSheet />);
  const original = source();
  expect(original).toContain('/pubhtml?widget=true&headers=false&refresh=');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh sheet' }));
  const manual = source();
  expect(manual).not.toBe(original);
  act(() => vi.advanceTimersByTime(59_999));
  expect(source()).toBe(manual);
  act(() => vi.advanceTimersByTime(1));
  expect(source()).not.toBe(manual);
});

it('pauses when hidden, refreshes on return, and stops work when unmounted', () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const removeListener = vi.spyOn(document, 'removeEventListener');
  const { unmount } = render(<HighdartsSheet />);
  const original = source();
  act(() => vi.advanceTimersByTime(120_000));
  expect(source()).toBe(original);
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(source()).not.toBe(original);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
});
