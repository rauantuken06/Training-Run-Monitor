/**
 * Tree-shaken ECharts setup: only the pieces the metric charts use.
 * The SVG renderer is used so the rendered geometry is inspectable in the DOM
 * (the browser tests measure where the line actually is drawn).
 */
import { LineChart, type LineSeriesOption } from 'echarts/charts';
import {
  GridComponent,
  type GridComponentOption,
  MarkAreaComponent,
  type MarkAreaComponentOption,
  MarkLineComponent,
  type MarkLineComponentOption,
  MarkPointComponent,
  type MarkPointComponentOption,
  TooltipComponent,
  type TooltipComponentOption,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([LineChart, GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, SVGRenderer]);

export type MetricChartOption = echarts.ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | MarkAreaComponentOption
  | MarkLineComponentOption
  | MarkPointComponentOption
>;

export { echarts };
