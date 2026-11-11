import ReactEChartsCore from 'echarts-for-react/lib/core';
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { MetricKey } from '../../../types/training';
import type { Viewport } from '../../data/downsampling/downsample';
import type { ChartView } from '../../data/integrity/analyzeRun';
import { METRIC_LABEL } from '../../runs/labels';
import { echarts } from '../echarts';
import { useElementWidth } from '../hooks/useElementWidth';
import { usePrefersDark } from '../hooks/usePrefersDark';
import { budgetForWidth, buildChartModel, GRID } from '../model/chartModel';
import { buildEChartsOption, DARK_THEME, LIGHT_THEME } from '../model/echartsOption';
import { describeHover, hoverHtml, hoverLines } from '../model/hover';
import { pixelToStep } from '../model/viewport';
import { chartSummaryText } from '../model/summaryText';
import { ChartAccessibilitySummary } from './ChartAccessibilitySummary';
import { ChartStatus } from './ChartStatus';

export const CHART_HEIGHT = 260;
/** A drag narrower than this (px) is treated as a click, not a zoom. */
const MIN_DRAG_PX = 6;

/** Axis value from ECharts axis-trigger tooltip params (an array of items with `axisValue`). */
function axisValueOf(params: unknown): number | null {
  const first: unknown = Array.isArray(params) ? params[0] : params;
  if (typeof first === 'object' && first !== null && 'axisValue' in first) {
    const v = Number(first.axisValue);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/**
 * One metric chart over the shared viewport.
 * - Point budget follows the measured width (4 per pixel column).
 * - Downsampling reruns only when the run, viewport or width changes; hover and
 *   drag only read the existing model.
 * - Drag across the plot to zoom into that step range (applied on release).
 */
export function TrainingMetricChart({
  view,
  metric,
  viewport,
  onViewportChange,
}: {
  view: ChartView;
  metric: MetricKey;
  viewport: Viewport;
  onViewportChange: (vp: Viewport) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const budget = budgetForWidth(width);
  const dark = usePrefersDark();
  const plotWidth = Math.max(1, width - GRID.left - GRID.right);

  /**
   * Step under the cursor, set in the capture phase (before ECharts handles the
   * event). ECharts' axis tooltip reports the *nearest data point's* x as
   * `axisValue`, which hides gaps and invalid stretches away from plotted points,
   * so the tooltip uses the real cursor position. A ref: no re-render on hover.
   */
  const cursorStepRef = useRef<number | null>(null);

  const model = useMemo(() => buildChartModel(view, metric, viewport, budget), [view, metric, viewport, budget]);
  const option = useMemo(() => {
    const stepsPerPixel = (viewport.maxStep - viewport.minStep) / plotWidth;
    const formatter = (params: unknown) => {
      const step = cursorStepRef.current ?? axisValueOf(params);
      if (step === null) return '';
      return hoverHtml(hoverLines(model, describeHover(model, step, Math.max(0.5, stepsPerPixel * 4))));
    };
    return buildEChartsOption(model, dark ? DARK_THEME : LIGHT_THEME, formatter);
  }, [model, dark, viewport, plotWidth]);

  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);
  const localX = (e: PointerEvent<HTMLDivElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left;
  const clampToPlot = (x: number) => Math.min(width - GRID.right, Math.max(GRID.left, x));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const x = localX(e);
    if (x < GRID.left || x > width - GRID.right) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ x0: x, x1: x });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) setDrag({ x0: drag.x0, x1: clampToPlot(localX(e)) });
  };
  const trackCursor = (e: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    cursorStepRef.current = pixelToStep(x, GRID.left, plotWidth, viewport);
  };
  const onPointerUp = () => {
    if (!drag) return;
    const left = Math.min(drag.x0, drag.x1);
    const right = Math.max(drag.x0, drag.x1);
    setDrag(null);
    if (right - left < MIN_DRAG_PX) return;
    onViewportChange({
      minStep: pixelToStep(left, GRID.left, plotWidth, viewport),
      maxStep: pixelToStep(right, GRID.left, plotWidth, viewport),
    });
  };

  const headingId = `chart-${metric}-heading`;
  const { result, yBounds } = model;
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-2 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      {/* "… chart" keeps the region name distinct from the metric summary card of the same metric. */}
      <h3 id={headingId} className="font-semibold">
        {METRIC_LABEL[metric]} chart
      </h3>
      <ChartStatus model={model} />
      <div
        ref={containerRef}
        role="img"
        aria-label={chartSummaryText(model)}
        data-testid={`metric-chart-${metric}`}
        data-x-min={viewport.minStep}
        data-x-max={viewport.maxStep}
        data-y-min={yBounds?.min}
        data-y-max={yBounds?.max}
        data-budget={budget}
        data-width={width}
        data-input={result.inputCount}
        data-plotted={result.outputCount}
        data-segments={result.segments.length}
        className="relative w-full cursor-crosshair select-none"
        style={{ height: CHART_HEIGHT }}
        onPointerMoveCapture={trackCursor}
        onMouseMoveCapture={trackCursor}
        onPointerLeave={() => {
          cursorStepRef.current = null;
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDrag(null);
        }}
      >
        <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate opts={{ renderer: 'svg' }} style={{ height: CHART_HEIGHT, width: '100%' }} />
        {drag && Math.abs(drag.x1 - drag.x0) >= 1 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute border-x border-sky-600 bg-sky-500/15"
            style={{ left: Math.min(drag.x0, drag.x1), width: Math.abs(drag.x1 - drag.x0), top: GRID.top, bottom: GRID.bottom }}
          />
        )}
      </div>
      <ChartAccessibilitySummary model={model} />
    </section>
  );
}
