import type { MetricValue } from '../../../types/training';
import { describeValue } from '../format';

/**
 * A metric value as text. Finite values are shown at 5 significant digits; the
 * exact raw value is kept in the `<data value>` attribute and the tooltip.
 * Invalid values are spelled out (NaN, +Infinity, -Infinity, Not recorded) and
 * styled as warnings, never shown as 0.
 */
export function ValueText({ value }: { value: MetricValue }) {
  const d = describeValue(value);
  const invalid = d.kind !== 'finite';
  return (
    <data
      value={d.exact}
      title={invalid ? undefined : `Exact value: ${d.exact}`}
      data-kind={d.kind}
      className={`font-mono tabular-nums ${invalid ? 'font-semibold text-red-700 dark:text-red-300' : ''}`}
    >
      {d.text}
    </data>
  );
}
