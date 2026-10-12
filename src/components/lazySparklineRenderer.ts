import Globals from '@highcharts/grid-pro/es-modules/Grid/Core/Globals';
import type TableCell from '@highcharts/grid-pro/es-modules/Grid/Core/Table/Body/TableCell';
import type Column from '@highcharts/grid-pro/es-modules/Grid/Core/Table/Column';
import CellContentPro from '@highcharts/grid-pro/es-modules/Grid/Pro/CellRendering/CellContentPro';
import { CellRenderer, type CellRendererOptions } from '@highcharts/grid-pro/es-modules/Grid/Pro/CellRendering/CellRenderer';
import { registerRenderer } from '@highcharts/grid-pro/es-modules/Grid/Pro/CellRendering/CellRendererRegistry';
import SparklineContent from '@highcharts/grid-pro/es-modules/Grid/Pro/CellRendering/ContentTypes/SparklineContent';
import type SparklineRenderer from '@highcharts/grid-pro/es-modules/Grid/Pro/CellRendering/Renderers/SparklineRenderer';
import type { SparklineRendererOptions } from '@highcharts/grid-pro/es-modules/Grid/Pro/CellRendering/Renderers/SparklineRenderer';

import { createFrameQueue } from '@/lib/frameQueue';

/** Grid Pro's own sparkline height when the chart options set none. */
const DEFAULT_CHART_HEIGHT = 40;

/** Every lazy sparkline on the page shares one queue, so they draw a few per frame in total. */
const chartQueue = createFrameQueue();

export interface LazySparklineRendererOptions extends CellRendererOptions {
  type: 'lazySparkline';
  chartOptions?: SparklineRendererOptions['chartOptions'];
}

/**
 * A sparkline cell that shows at once with its height reserved and draws its chart a little later.
 *
 * Grid Pro's `sparkline` renderer creates a whole Highcharts chart inside each cell while the
 * grid renders, and each chart forces a layout, so the grid only appears after every chart is
 * drawn. Here the grid appears first and the charts follow in short batches after paint. A cell
 * destroyed before its turn (Grid Pro's hidden row-height measuring row, rows replaced by a sort
 * or filter) never draws its chart at all.
 */
class LazySparklineContent extends CellContentPro {
  private slot?: HTMLDivElement;
  private chart?: SparklineContent;
  private cancelDraw?: () => void;

  constructor(cell: TableCell, renderer: LazySparklineRenderer) {
    super(cell, renderer);
    this.add();
  }

  protected add(): void {
    const { cell } = this;
    if (cell.value === null || cell.value === undefined) return;
    const slot = document.createElement('div');
    slot.style.height = `${this.chartHeight()}px`;
    cell.htmlElement.classList.add(Globals.getClassName('noPadding'));
    cell.htmlElement.appendChild(slot);
    this.slot = slot;
    this.cancelDraw = chartQueue.add(() => {
      this.cancelDraw = undefined;
      // A detached cell has no width to size a chart by; it is redrawn when it is updated.
      if (!slot.isConnected) return;
      this.chart = new SparklineContent(cell, this.renderer as unknown as SparklineRenderer, slot);
    });
  }

  update(): void {
    if (this.chart) {
      this.chart.update();
      return;
    }
    this.destroy();
    this.add();
  }

  destroy(): void {
    this.cancelDraw?.();
    this.cancelDraw = undefined;
    this.chart?.destroy();
    this.chart = undefined;
    this.slot?.remove();
    this.slot = undefined;
    this.cell.htmlElement.classList.remove(Globals.getClassName('noPadding'));
  }

  private chartHeight(): number {
    const { chartOptions } = (this.renderer as LazySparklineRenderer).options;
    const options = typeof chartOptions === 'function'
      ? (chartOptions as (this: TableCell, value: unknown) => unknown).call(this.cell, this.cell.value)
      : chartOptions;
    const height = (options as { chart?: { height?: unknown } } | undefined)?.chart?.height;
    return typeof height === 'number' ? height : DEFAULT_CHART_HEIGHT;
  }
}

export class LazySparklineRenderer extends CellRenderer {
  options: LazySparklineRendererOptions;

  constructor(column: Column) {
    super(column);
    const configured = column.options.cells?.renderer as Partial<LazySparklineRendererOptions> | undefined;
    this.options = { ...configured, type: 'lazySparkline' };
  }

  render(cell: TableCell): LazySparklineContent {
    return new LazySparklineContent(cell, this);
  }
}

declare module '@highcharts/grid-pro/es-modules/Grid/Pro/CellRendering/CellRendererType' {
  interface CellRendererTypeRegistry {
    lazySparkline: typeof LazySparklineRenderer;
  }
}

registerRenderer('lazySparkline', LazySparklineRenderer);
