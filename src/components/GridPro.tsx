"use client";

import { useEffect, useRef } from 'react';
import Grid from '@highcharts/grid-pro/es-modules/masters/grid-pro.src';
import type GridInstance from '@highcharts/grid-pro/es-modules/Grid/Core/Grid';
import type { GridOptions } from '@highcharts/grid-pro-react';
import '@highcharts/grid-pro/css/grid-pro.css';

/**
 * Renders a Highcharts Grid Pro grid and keeps it in sync with `options`.
 *
 * Replaces the `Grid` component from @highcharts/grid-pro-react 3.2.0, which renders every grid
 * twice on mount: its options effect queues the mount's own options as "pending" while the async
 * init runs, and the init then applies them again with a full `update`. Each render rebuilds every
 * cell, and a sparkline cell is a whole Highcharts chart.
 */
export function GridPro({ options }: { options: GridOptions }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridInstance | null>(null);
  const renderedOptions = useRef<GridOptions | null>(null);
  const latestOptions = useRef(options);
  latestOptions.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const create = async () => {
      // Building the grid is one long task (every sparkline cell is a chart). Start it after the
      // next paint so the rest of the page shows first instead of waiting for the grid.
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
      // Options that changed while the grid was being created.
      if (latestOptions.current !== initialOptions) {
        renderedOptions.current = latestOptions.current;
        void grid.update(latestOptions.current, true);
      }
    };
    void create();
    return () => {
      disposed = true;
      gridRef.current?.destroy();
      gridRef.current = null;
      renderedOptions.current = null;
    };
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || renderedOptions.current === options) return;
    renderedOptions.current = options;
    void grid.update(options, true);
  }, [options]);

  return <div ref={containerRef} />;
}
