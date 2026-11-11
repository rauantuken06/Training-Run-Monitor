import type { MetricKey, MetricValue, ValueKind } from '../../../types/training';

export const METRIC_KEYS: readonly MetricKey[] = ['loss', 'lr', 'grad_norm'];

/**
 * Classify a recorded metric value. This is the only place the engine decides
 * what "valid" means: a value is valid only if it is a finite number.
 * `null` (not recorded) and `NaN` (recorded but invalid) are never merged.
 */
export function classifyValue(value: MetricValue): ValueKind {
  if (value === null) return 'missing';
  if (Number.isNaN(value)) return 'nan';
  if (value === Number.POSITIVE_INFINITY) return 'positive_infinity';
  if (value === Number.NEGATIVE_INFINITY) return 'negative_infinity';
  return 'finite';
}

/** A step can be placed on the axis only if it is a finite, non-negative integer. */
export function isValidStep(step: number): boolean {
  return Number.isInteger(step) && step >= 0;
}
