import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GridOptions } from '@highcharts/grid-pro-react';

const { grid } = vi.hoisted(() => ({ grid: vi.fn() }));
vi.mock('@highcharts/grid-pro/es-modules/masters/grid-pro.src', () => ({ default: { grid } }));
vi.mock('@highcharts/grid-pro/css/grid-pro.css', () => ({}));

import { GridPro } from './GridPro';

const instance = { update: vi.fn(async () => {}), destroy: vi.fn() };
const optionsA = { columns: [{ id: 'a' }] } as GridOptions;
const optionsB = { columns: [{ id: 'b' }] } as GridOptions;

/** Lets the deferred build (next frame + task) and the async grid creation finish. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

beforeEach(() => {
  vi.clearAllMocks();
  grid.mockImplementation(async () => instance);
});
afterEach(cleanup);

it('builds the grid once with the mount options instead of re-applying them', async () => {
  render(<GridPro options={optionsA} />);
  await settle();
  expect(grid).toHaveBeenCalledTimes(1);
  expect(grid.mock.calls[0][1]).toBe(optionsA);
  expect(instance.update).not.toHaveBeenCalled();
});

it('updates only when the options change', async () => {
  const { rerender } = render(<GridPro options={optionsA} />);
  await settle();
  rerender(<GridPro options={optionsA} />);
  expect(instance.update).not.toHaveBeenCalled();
  rerender(<GridPro options={optionsB} />);
  await settle();
  expect(instance.update).toHaveBeenCalledWith(optionsB, true);
});

it('builds with the latest options when they change before the build starts', async () => {
  const { rerender } = render(<GridPro options={optionsA} />);
  rerender(<GridPro options={optionsB} />);
  await settle();
  expect(grid).toHaveBeenCalledTimes(1);
  expect(grid.mock.calls[0][1]).toBe(optionsB);
  expect(instance.update).not.toHaveBeenCalled();
});

it('never builds a grid after unmounting, and destroys one that finishes building late', async () => {
  const early = render(<GridPro options={optionsA} />);
  early.unmount();
  await settle();
  expect(grid).not.toHaveBeenCalled();

  let finish: (value: typeof instance) => void = () => {};
  grid.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const late = render(<GridPro options={optionsA} />);
  await settle();
  late.unmount();
  await act(async () => { finish(instance); });
  expect(instance.destroy).toHaveBeenCalledTimes(1);
});

it('shows the placeholder until the grid is built', async () => {
  const view = render(<GridPro options={optionsA} placeholder={<p>Reserved</p>} />);
  expect(view.getByText('Reserved')).toBeInTheDocument();
  await settle();
  expect(view.queryByText('Reserved')).not.toBeInTheDocument();
});

it('waits for a running update before destroying the grid', async () => {
  let finishUpdate: () => void = () => {};
  instance.update.mockImplementationOnce(() => new Promise<void>((resolve) => { finishUpdate = resolve; }));
  const view = render(<GridPro options={optionsA} />);
  await settle();
  view.rerender(<GridPro options={optionsB} />);
  view.unmount();
  await settle();
  expect(instance.destroy).not.toHaveBeenCalled();
  await act(async () => { finishUpdate(); });
  expect(instance.destroy).toHaveBeenCalledTimes(1);
});
