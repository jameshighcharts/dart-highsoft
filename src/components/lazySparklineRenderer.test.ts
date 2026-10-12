import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { charts } = vi.hoisted(() => ({ charts: [] as Array<{ parent: HTMLElement; destroy: ReturnType<typeof vi.fn> }> }));
vi.mock('@highcharts/grid-pro/es-modules/Grid/Pro/CellRendering/ContentTypes/SparklineContent', () => ({
  default: class {
    destroy = vi.fn();
    update = vi.fn();
    constructor(_cell: unknown, _renderer: unknown, parent: HTMLElement) { charts.push({ parent, destroy: this.destroy }); }
  },
}));

import { LazySparklineRenderer } from './lazySparklineRenderer';

const nextFrame = () => vi.advanceTimersByTimeAsync(20);

function cellWith(value: unknown) {
  const htmlElement = document.createElement('td');
  document.body.appendChild(htmlElement);
  return { value, htmlElement } as never;
}
const renderer = () => new LazySparklineRenderer({
  options: { cells: { renderer: { type: 'lazySparkline', chartOptions: () => ({ chart: { height: 34 } }) } } },
} as never);

beforeEach(() => {
  charts.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it('reserves the chart height at once and draws the chart after paint', async () => {
  const cell = cellWith('1,2,3') as { htmlElement: HTMLElement };
  renderer().render(cell as never);
  const slot = cell.htmlElement.firstElementChild as HTMLElement;
  expect(slot.style.height).toBe('34px');
  expect(charts).toHaveLength(0);
  await nextFrame();
  expect(charts).toHaveLength(1);
  expect(charts[0].parent).toBe(slot);
});

it('never draws a chart for a cell destroyed before its turn', async () => {
  const cell = cellWith('1,2,3') as { htmlElement: HTMLElement };
  const content = renderer().render(cell as never);
  content.destroy();
  await nextFrame();
  expect(charts).toHaveLength(0);
  expect(cell.htmlElement.childElementCount).toBe(0);
});

it('destroys a drawn chart with its cell and skips cells without a value', async () => {
  const content = renderer().render(cellWith('1,2,3'));
  renderer().render(cellWith(null));
  await nextFrame();
  expect(charts).toHaveLength(1);
  content.destroy();
  expect(charts[0].destroy).toHaveBeenCalledTimes(1);
});
