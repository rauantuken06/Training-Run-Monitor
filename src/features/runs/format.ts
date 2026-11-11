import type { MetricValue, ValueKind } from '../../types/training';

/**
 * Display formatting. Formatting only changes how a value is *shown*. The exact
 * raw value is always returned alongside (`exact`), so components can expose it
 * (e.g. in a `<data value>` attribute or a tooltip).
 */

export interface DescribedValue {
  /** Human-readable text. Never "0" for NaN, ±Infinity or a missing value. */
  readonly text: string;
  readonly kind: ValueKind;
  /** Exact JavaScript representation of the raw value. */
  readonly exact: string;
}

const countFormat = new Intl.NumberFormat('en-US');

/** Integer counts and steps, with digit grouping: 1000000 → "1,000,000". */
export function formatCount(n: number): string {
  return countFormat.format(n);
}

function trimZeros(text: string): string {
  const [mantissa = '', exponent] = text.split('e');
  const trimmed = mantissa.includes('.') ? mantissa.replace(/\.?0+$/, '') : mantissa;
  return exponent === undefined ? trimmed : `${trimmed}e${exponent.replace(/^\+/, '')}`;
}

/**
 * Finite numbers at 5 significant digits. Values below 1e-3 or at least 1e5 in
 * magnitude use scientific notation, so small learning rates stay readable.
 */
export function formatFinite(value: number): string {
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e-3 && magnitude < 1e5) return trimZeros(value.toPrecision(5));
  return trimZeros(value.toExponential(4));
}

export function describeValue(value: MetricValue): DescribedValue {
  if (value === null) return { text: 'Not recorded', kind: 'missing', exact: 'null' };
  if (Number.isNaN(value)) return { text: 'NaN', kind: 'nan', exact: 'NaN' };
  if (value === Number.POSITIVE_INFINITY) return { text: '+Infinity', kind: 'positive_infinity', exact: 'Infinity' };
  if (value === Number.NEGATIVE_INFINITY) return { text: '-Infinity', kind: 'negative_infinity', exact: '-Infinity' };
  return { text: formatFinite(value), kind: 'finite', exact: Object.is(value, -0) ? '-0' : String(value) };
}

const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** ISO timestamp → "Oct 1, 2026" (UTC, so output does not depend on the viewer's time zone). */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
