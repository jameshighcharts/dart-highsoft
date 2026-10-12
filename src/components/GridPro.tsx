"use client";

import { useEffect, useRef, useState, type RefObject } from 'react';
import Grid from '@highcharts/grid-pro/es-modules/masters/grid-pro.src';
import type GridInstance from '@highcharts/grid-pro/es-modules/Grid/Core/Grid';
import type { GridOptions } from '@highcharts/grid-pro-react';
import '@highcharts/grid-pro/css/grid-pro.css';

/**
 * Grid Pro updates are async. Each waits for the one before it, and teardown waits for them all,
 * because destroying a grid while an update is running throws inside Grid Pro.
 */
function queueUpdate(
  pendingWork: RefObject<Promise<void>>,
  renderedOptions: RefObject<GridOptions | null>,
  grid: GridInstance,
  next: GridOptions,
) {
  renderedOptions.current = next;
  pendingWork.current = pendingWork.current
    .then(() => grid.update(next, true))
    .catch((error: unknown) => console.error('Grid update failed:', error));
}

/** Resolves once every update queued so far has finished. */
const whenUpdatesSettle = (pendingWork: RefObject<Promise<void>>) => pendingWork.current;

/**
 * Renders a Highcharts Grid Pro grid and keeps it in sync with `options`, showing `placeholder`
 * until the grid has been built so the space it will take stays reserved.
 *
 * Replaces the `Grid` component from @highcharts/grid-pro-react 3.2.0, which renders every grid
 * twice on mount: its options effect queues the mount's own options as "pending" while the async
 * init runs, and the init then applies them again with a full `update`. Each render rebuilds every
 * cell, and a sparkline cell is a whole Highcharts chart.
 */
export function GridPro({ options, placeholder }: { options: GridOptions; placeholder?: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridInstance | null>(null);
  const renderedOptions = useRef<GridOptions | null>(null);
  const pendingWork = useRef<Promise<void>>(Promise.resolve());
  const latestOptions = useRef(options);
  const [built, setBuilt] = useState(false);
  latestOptions.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const create = async () => {
      // Building the grid is one long task. Start it after the next paint so the rest of the page
      // shows first instead of waiting for the grid.
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      if (disposed) return;
      const initialOptions = latestOptions.current;
      const grid = await Grid.grid(container, initialOptions, true);
      if (disposed) {
        grid.destroy();
        return;
      }
      gridRef.current = grid;
      renderedOptions.current = initialOptions;
      setBuilt(true);
      // Options that changed while the grid was being created.
      if (latestOptions.current !== initialOptions) {
        queueUpdate(pendingWork, renderedOptions, grid, latestOptions.current);
      }
    };
    const creating = create().catch((error: unknown) => console.error('Grid creation failed:', error));
    return () => {
      disposed = true;
      const grid = gridRef.current;
      gridRef.current = null;
      renderedOptions.current = null;
      void creating.then(() => whenUpdatesSettle(pendingWork)).then(() => grid?.destroy());
    };
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || renderedOptions.current === options) return;
    queueUpdate(pendingWork, renderedOptions, grid, options);
  }, [options]);

  return (
    <>
      {!built && placeholder}
      <div ref={containerRef} />
    </>
  );
}
