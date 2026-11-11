/**
 * Performance instrumentation (User Timing). `timed(name, fn)` runs `fn` and
 * records a `trm:<name>` measure, which shows up in Chrome Performance traces
 * and in `performance.getEntriesByType('measure')`. It changes no behaviour:
 * the cost is two `performance.now()` calls and one `performance.measure`.
 * Added before the Task 08 baseline, so baseline and optimized builds carry
 * identical instrumentation.
 */
export function timed<T>(name: string, fn: () => T): T {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    try {
      performance.measure(`trm:${name}`, { start, end: performance.now() });
    } catch {
      // Environments without User Timing Level 3 (some test DOMs): skip the measure.
    }
  }
}
