import { describeValue, formatCount } from '../../runs/format';
import { METRIC_LABEL } from '../../runs/labels';
import type { ChartModel } from './chartModel';

/** One-sentence text description of what the chart shows (also used as its accessible name). */
export function chartSummaryText(model: ChartModel): string {
  const { result, viewport } = model;
  const label = METRIC_LABEL[model.metric];
  const range = `steps ${formatCount(viewport.minStep)} to ${formatCount(viewport.maxStep)}`;
  if (result.inputCount === 0) return `${label} chart, ${range}: no finite values to plot.`;
  const { min, max } = result.extrema;
  const extremes =
    min && max
      ? ` Minimum ${describeValue(min.value).text} at step ${formatCount(min.step)}; maximum ${describeValue(max.value).text} at step ${formatCount(max.step)}.`
      : '';
  const plotted = result.reduced
    ? `${formatCount(result.outputCount)} of ${formatCount(result.inputCount)} observations plotted (downsampled; minimum and maximum kept)`
    : `all ${formatCount(result.inputCount)} observations plotted`;
  return `${label} chart, ${range}: ${plotted}.${extremes}`;
}
