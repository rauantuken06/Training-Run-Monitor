import { describeValue, formatCount } from '../../runs/format';
import { METRIC_LABEL } from '../../runs/labels';
import type { ChartModel } from '../model/chartModel';
import { MAX_MARKERS } from '../model/echartsOption';

/**
 * Visible warnings for one chart, from the downsampler's reports over the whole
 * viewport (not just the plotted points), so no anomaly disappears because it
 * was not sampled.
 */
export function ChartStatus({ model }: { model: ChartModel }) {
  const { result } = model;
  const metric = METRIC_LABEL[model.metric].toLowerCase();
  const items: { key: string; text: string }[] = [];

  for (const w of result.warnings) {
    switch (w.kind) {
      case 'budget_exceeded':
        items.push({
          key: 'budget',
          text: `Too many separate line pieces (${formatCount(w.segmentCount)}) for the point budget of ${formatCount(w.budget)}: each piece is reduced to its endpoints plus the overall minimum and maximum (${formatCount(w.required)} points). Zoom in for detail.`,
        });
        break;
      case 'invalid_values': {
        const k = result.invalidRuns.reduce(
          (acc, r) => ({ nan: acc.nan + r.kinds.nan, pos: acc.pos + r.kinds.positive_infinity, neg: acc.neg + r.kinds.negative_infinity, missing: acc.missing + r.kinds.missing }),
          { nan: 0, pos: 0, neg: 0, missing: 0 },
        );
        const parts = [
          k.nan ? `${formatCount(k.nan)} NaN` : '',
          k.pos ? `${formatCount(k.pos)} +Infinity` : '',
          k.neg ? `${formatCount(k.neg)} -Infinity` : '',
          k.missing ? `${formatCount(k.missing)} not recorded (null)` : '',
        ].filter(Boolean);
        items.push({
          key: 'invalid',
          text: `${formatCount(w.count)} invalid ${metric} value${w.count === 1 ? '' : 's'} in view (${parts.join(', ')}). They have no numeric value, so they are not plotted. Red bands or dashed lines labelled NaN, +Inf, -Inf or null mark where they are, and the line is broken there.`,
        });
        break;
      }
      case 'missing_steps':
        items.push({
          key: 'gaps',
          text: `${formatCount(w.missingStepCount)} missing step${w.missingStepCount === 1 ? '' : 's'} in ${formatCount(w.gapCount)} range${w.gapCount === 1 ? '' : 's'}. The line is broken there (grey bands labelled "gap").`,
        });
        break;
      case 'conflicting_duplicates':
        items.push({
          key: 'conflicts',
          text: `${formatCount(w.count)} step${w.count === 1 ? ' was' : 's were'} logged more than once with different ${metric} values. The last recorded value is plotted; ▲ along the bottom edge marks each such step. Hover for all values.`,
        });
        break;
      case 'hidden_duplicate_outside_extrema':
        // Summarized below, to avoid one line per record.
        break;
    }
  }

  const hidden = result.warnings.filter((w) => w.kind === 'hidden_duplicate_outside_extrema');
  if (hidden.length > 0) {
    const examples = hidden
      .slice(0, 3)
      .map((w) => `${describeValue(w.value).text} at step ${formatCount(w.step)}`)
      .join('; ');
    items.push({
      key: 'hidden',
      text: `${formatCount(hidden.length)} hidden duplicate value${hidden.length === 1 ? ' lies' : 's lie'} outside the plotted range (${examples}${hidden.length > 3 ? '; …' : ''}). They are not drawn; see Data quality.`,
    });
  }

  const capped = [
    result.invalidRuns.length > MAX_MARKERS ? `${formatCount(result.invalidRuns.length)} invalid stretches` : '',
    result.gaps.length > MAX_MARKERS ? `${formatCount(result.gaps.length)} gaps` : '',
    result.conflicts.length > MAX_MARKERS ? `${formatCount(result.conflicts.length)} conflicting duplicates` : '',
  ].filter(Boolean);
  if (capped.length > 0) {
    items.push({ key: 'capped', text: `Only the first ${MAX_MARKERS} markers of each kind are drawn (${capped.join(', ')} in view); the counts above are complete.` });
  }
  if (result.inputCount === 0) {
    items.push({ key: 'empty', text: `No finite ${metric} values in this range, so there is no line to draw.` });
  }

  if (items.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs" aria-label={`${METRIC_LABEL[model.metric]} chart warnings`}>
      {items.map((item) => (
        <li key={item.key} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <strong>Warning:</strong> {item.text}
        </li>
      ))}
    </ul>
  );
}
