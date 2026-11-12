import type { LineSeriesOption, MarkAreaComponentOption, MarkLineComponentOption, MarkPointComponentOption } from 'echarts';
import type { InvalidRun } from '../../data/downsampling/downsample';
import { formatCount, formatFinite } from '../../runs/format';
import { METRIC_LABEL } from '../../runs/labels';
import type { MetricChartOption } from '../echarts';
import { axisLabelDigits, GRID, type ChartModel } from './chartModel';

export interface ChartTheme {
  readonly line: string;
  readonly text: string;
  readonly axis: string;
  readonly split: string;
  readonly invalid: string;
  readonly invalidBand: string;
  readonly gapBand: string;
  readonly conflict: string;
}

export const LIGHT_THEME: ChartTheme = {
  line: '#0369a1',
  text: '#475569',
  // Axis lines are graphical objects needed to read the chart (WCAG 1.4.11 needs ≥ 3:1).
  // Was #94a3b8 (2.56:1 on white); slate-500 gives 4.76:1. Found in the Task 09 audit.
  axis: '#64748b',
  split: '#e2e8f0',
  invalid: '#b91c1c',
  invalidBand: 'rgba(220, 38, 38, 0.14)',
  gapBand: 'rgba(100, 116, 139, 0.18)',
  conflict: '#b45309',
};

export const DARK_THEME: ChartTheme = {
  line: '#38bdf8',
  text: '#cbd5e1',
  axis: '#64748b',
  split: '#1e293b',
  invalid: '#fca5a5',
  invalidBand: 'rgba(248, 113, 113, 0.22)',
  gapBand: 'rgba(148, 163, 184, 0.22)',
  conflict: '#fbbf24',
};

/** At most this many markers of each kind are drawn; the status panel reports the rest. */
export const MAX_MARKERS = 100;
/** Marker labels are shown only when there are few markers, so they stay readable. */
const MAX_LABELLED_MARKERS = 24;

type MarkAreaItem = NonNullable<MarkAreaComponentOption['data']>[number];
type MarkLineItem = NonNullable<MarkLineComponentOption['data']>[number];
type MarkPointItem = NonNullable<MarkPointComponentOption['data']>[number];

/** Short, non-color marker text for an invalid run. */
export function invalidRunLabel(run: InvalidRun): string {
  const parts = [
    run.kinds.nan > 0 ? 'NaN' : null,
    run.kinds.positive_infinity > 0 ? '+Inf' : null,
    run.kinds.negative_infinity > 0 ? '-Inf' : null,
    run.kinds.missing > 0 ? 'null' : null,
  ].filter((p): p is string => p !== null);
  return run.count > 1 ? `${parts.join('/')} ×${formatCount(run.count)}` : parts.join('/');
}

/**
 * ECharts option for one metric chart. Truthfulness settings are explicit:
 * - one line series per downsampled segment, so lines never cross a gap or an invalid value
 * - `smooth: false`, no `sampling`, `connectNulls: false`, no animation
 * - x-axis = the viewport (steps), y-axis = exact extrema plus padding (never clips them)
 * - invalid values, gaps and conflicting duplicates are drawn as labelled markers
 *   from the downsampler's reports, not from the sampled points
 */
export function buildEChartsOption(
  model: ChartModel,
  theme: ChartTheme,
  tooltipFormatter: (params: unknown) => string,
): MetricChartOption {
  const { viewport, result, yBounds } = model;
  const clampX = (x: number) => Math.min(viewport.maxStep, Math.max(viewport.minStep, x));
  const label = METRIC_LABEL[model.metric];
  const yDigits = axisLabelDigits(yBounds);

  const lineSeries: LineSeriesOption[] = model.seriesData.map((data, i) => ({
    type: 'line',
    id: `segment-${i}`,
    name: label,
    data: data.map((xy) => [xy[0], xy[1]]),
    smooth: false,
    connectNulls: false,
    // A one-point segment has no line to draw, so its point is shown as a symbol.
    showSymbol: data.length === 1,
    symbol: 'circle',
    symbolSize: 5,
    clip: true,
    animation: false,
    lineStyle: { color: theme.line, width: 1.25 },
    itemStyle: { color: theme.line },
    emphasis: { disabled: true },
  }));

  const invalidRuns = result.invalidRuns.slice(0, MAX_MARKERS);
  const gaps = result.gaps.slice(0, MAX_MARKERS);
  const showLabels = invalidRuns.length + gaps.length <= MAX_LABELLED_MARKERS;
  const markLabel = (text: string, color: string) => ({
    show: showLabels,
    formatter: text,
    color,
    fontSize: 10,
    position: 'insideTop' as const,
  });

  const areas: MarkAreaItem[] = [];
  const lines: MarkLineItem[] = [];
  for (const run of invalidRuns) {
    if (run.startStep === run.endStep) {
      lines.push({
        xAxis: run.startStep,
        lineStyle: { color: theme.invalid, type: 'dashed', width: 1.5 },
        label: { show: showLabels, formatter: invalidRunLabel(run), color: theme.invalid, fontSize: 10, position: 'insideEndTop' },
      });
    } else {
      areas.push([
        { xAxis: clampX(run.startStep), itemStyle: { color: theme.invalidBand }, label: markLabel(invalidRunLabel(run), theme.invalid) },
        { xAxis: clampX(run.endStep) },
      ]);
    }
  }
  for (const gap of gaps) {
    areas.push([
      { xAxis: clampX(gap.afterStep), itemStyle: { color: theme.gapBand }, label: markLabel(`gap ×${formatCount(gap.missingCount)}`, theme.text) },
      { xAxis: clampX(gap.beforeStep) },
    ]);
  }

  // Conflicting duplicates are marked as a rug of ▲ along the bottom edge at their step,
  // so markers never cover the plotted values (tooltip and status give the values).
  const rugY = yBounds?.min ?? 0;
  const conflictPoints: MarkPointItem[] = result.conflicts
    .slice(0, MAX_MARKERS)
    .map((issue) => ({ name: `duplicate step ${issue.step}`, coord: [issue.step, rugY], value: 'dup' }));

  const markerSeries: LineSeriesOption = {
    type: 'line',
    id: 'markers',
    name: 'markers',
    data: [],
    silent: true,
    animation: false,
    markArea: { silent: true, data: areas },
    markLine: { silent: true, symbol: ['none', 'none'], animation: false, data: lines },
    markPoint: {
      silent: true,
      animation: false,
      symbol: 'triangle',
      symbolSize: 7,
      symbolOffset: [0, -4],
      itemStyle: { color: theme.conflict },
      label: { show: false },
      data: conflictPoints,
    },
  };

  return {
    animation: false,
    // 'none': the plot area is exactly GRID. ECharts 6's default ('auto') shrinks it to fit
    // labels, which shifted the plot by ~16 px in Chrome and broke the pixel → step mapping.
    grid: { ...GRID, outerBoundsMode: 'none' },
    xAxis: {
      type: 'value',
      min: viewport.minStep,
      max: viewport.maxStep,
      minInterval: 1,
      axisLabel: { color: theme.text, hideOverlap: true, formatter: (v: number) => formatCount(v) },
      axisLine: { lineStyle: { color: theme.axis } },
      splitLine: { show: false },
      // No axis name: it was clipped at the plot edge. The chart section states "x is the training step".
    },
    yAxis: {
      type: 'value',
      show: yBounds !== null,
      min: yBounds?.min ?? 0,
      max: yBounds?.max ?? 1,
      // Padded bounds are not data values, so only regular ticks are labelled.
      axisLabel: { color: theme.text, hideOverlap: true, showMinLabel: false, showMaxLabel: false, formatter: (v: number) => formatFinite(v, yDigits) },
      axisLine: { show: true, lineStyle: { color: theme.axis } },
      splitLine: { lineStyle: { color: theme.split } },
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'line', snap: false },
      formatter: tooltipFormatter,
    },
    series: [...lineSeries, markerSeries],
  };
}
