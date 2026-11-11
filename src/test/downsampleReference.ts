/**
 * Independent reference for downsampling tests. Works from the raw points only
 * (own dedupe, own viewport filter, own gap check), and does not use the
 * integrity engine or the downsampler, so results can be compared against it.
 */
import type { DownsampleResult, Viewport } from '../features/data/downsampling/downsample';
import type { MetricKey, StepSampling, TrainingPoint } from '../types/training';

export interface RefEntry {
  readonly step: number;
  readonly sourceIndex: number;
  readonly value: number | null;
}

const validStep = (s: number) => Number.isInteger(s) && s >= 0;
const isFiniteValue = (v: number | null): v is number => v !== null && Number.isFinite(v);

/** Displayed entries (last recorded per valid step) inside the viewport, ascending. */
export function referenceVisible(
  points: readonly TrainingPoint[],
  metric: MetricKey,
  viewport: Viewport,
): RefEntry[] {
  const lastByStep = new Map<number, number>();
  points.forEach((p, i) => {
    if (validStep(p.step)) lastByStep.set(p.step, i);
  });
  return [...lastByStep.entries()]
    .filter(([step]) => step >= viewport.minStep && step <= viewport.maxStep)
    .sort((a, b) => a[0] - b[0])
    .map(([step, sourceIndex]) => ({ step, sourceIndex, value: (points[sourceIndex] as TrainingPoint)[metric] }));
}

/** Grid steps strictly between `a` and `b` that have no record (fixed sampling only). */
export function missingGridStepsBetween(
  allSteps: ReadonlySet<number>,
  origin: number,
  sampling: StepSampling,
  a: number,
  b: number,
): number {
  if (sampling.kind !== 'fixed') return 0;
  const iv = sampling.interval;
  let missing = 0;
  const firstK = Math.floor((a - origin) / iv) + 1;
  for (let s = origin + firstK * iv; s < b; s += iv) if (!allSteps.has(s)) missing++;
  return missing;
}

/**
 * Check a downsampling result against the reference. Returns human-readable
 * violations; an empty list means every invariant holds.
 */
export function checkDownsample(
  points: readonly TrainingPoint[],
  sampling: StepSampling,
  metric: MetricKey,
  viewport: Viewport,
  budget: number,
  result: DownsampleResult,
): string[] {
  const v: string[] = [];
  const visible = referenceVisible(points, metric, viewport);
  const byStep = new Map(visible.map((e) => [e.step, e]));
  const allSteps = new Set(points.map((p) => p.step).filter(validStep));
  let origin = Infinity;
  for (const s of allSteps) if (s < origin) origin = s;

  // 1. No invented points: each is the displayed record for its step, with the exact raw value.
  for (const p of result.points) {
    const raw = points[p.sourceIndex];
    const ref = byStep.get(p.step);
    if (!raw || raw.step !== p.step || !Object.is(raw[metric], p.value)) v.push(`point ${p.step} does not match raw record ${p.sourceIndex}`);
    if (!ref || ref.sourceIndex !== p.sourceIndex) v.push(`point ${p.step} is not the displayed record`);
    if (p.step < viewport.minStep || p.step > viewport.maxStep) v.push(`point ${p.step} outside viewport`);
    if (!Number.isFinite(p.value)) v.push(`non-finite plotted value at ${p.step}`);
  }

  // 2. Strictly ascending steps.
  for (let i = 1; i < result.points.length; i++) {
    if ((result.points[i]?.step ?? 0) <= (result.points[i - 1]?.step ?? 0)) v.push(`not ascending at output ${i}`);
  }

  // 3. Exact viewport extrema are plotted.
  const finite = visible.filter((e) => isFiniteValue(e.value)).map((e) => e.value as number);
  if (finite.length === 0) {
    if (result.points.length > 0 || result.extrema.min || result.extrema.max) v.push('points or extrema without finite data');
  } else {
    const refMin = finite.reduce((a, b) => Math.min(a, b));
    const refMax = finite.reduce((a, b) => Math.max(a, b));
    if (!Object.is(result.extrema.min?.value, refMin)) v.push(`min ${result.extrema.min?.value} != reference ${refMin}`);
    if (!Object.is(result.extrema.max?.value, refMax)) v.push(`max ${result.extrema.max?.value} != reference ${refMax}`);
    if (!result.points.some((p) => Object.is(p.value, refMin))) v.push('minimum not plotted');
    if (!result.points.some((p) => Object.is(p.value, refMax))) v.push('maximum not plotted');
  }

  // 4. Continuity: within a segment, nothing invalid or missing lies between consecutive points.
  //    Between segments, there is always a reason to break.
  // Sorted steps of non-finite visible entries; binary search for "any strictly between a and b".
  const nonFiniteSteps = visible.filter((e) => !isFiniteValue(e.value)).map((e) => e.step);
  const nonFiniteBetween = (a: number, b: number) => {
    let lo = 0;
    let hi = nonFiniteSteps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((nonFiniteSteps[mid] ?? 0) > a) hi = mid;
      else lo = mid + 1;
    }
    return lo < nonFiniteSteps.length && (nonFiniteSteps[lo] ?? Infinity) < b;
  };
  const breakBetween = (a: number, b: number) =>
    nonFiniteBetween(a, b) || missingGridStepsBetween(allSteps, origin, sampling, a, b) > 0;
  result.segments.forEach((seg, k) => {
    if (seg.start > seg.end) v.push(`empty segment ${k}`);
    for (let i = seg.start; i < seg.end; i++) {
      const a = result.points[i]?.step ?? 0;
      const b = result.points[i + 1]?.step ?? 0;
      if (breakBetween(a, b)) v.push(`segment ${k} falsely connects ${a} → ${b}`);
    }
    const next = result.segments[k + 1];
    if (next) {
      const a = result.points[seg.end]?.step ?? 0;
      const b = result.points[next.start]?.step ?? 0;
      if (!breakBetween(a, b)) v.push(`segments ${k}/${k + 1} split without a reason between ${a} and ${b}`);
    }
  });
  const coveredPoints = result.segments.reduce((n, s) => n + s.end - s.start + 1, 0);
  if (coveredPoints !== result.points.length) v.push('segments do not cover exactly all points');

  // 5. Every reference finite run keeps its first and last visible point.
  const plotted = new Set(result.points.map((p) => p.step));
  let runStart: RefEntry | null = null;
  let prev: RefEntry | null = null;
  const closeRun = () => {
    if (runStart && prev && (!plotted.has(runStart.step) || !plotted.has(prev.step))) {
      v.push(`run ${runStart.step}..${prev.step} lost an endpoint`);
    }
  };
  for (const e of visible) {
    const ok = isFiniteValue(e.value);
    if (ok && runStart && prev && missingGridStepsBetween(allSteps, origin, sampling, prev.step, e.step) === 0) {
      prev = e;
      continue;
    }
    closeRun();
    runStart = ok ? e : null;
    prev = ok ? e : null;
  }
  closeRun();

  // 6. Counts and budget.
  if (result.visibleCount !== visible.length) v.push(`visibleCount ${result.visibleCount} != ${visible.length}`);
  if (result.inputCount !== finite.length) v.push(`inputCount ${result.inputCount} != ${finite.length}`);
  if (result.outputCount !== result.points.length) v.push('outputCount mismatch');
  if (result.reduced !== result.outputCount < result.inputCount) v.push('reduced flag wrong');
  const exceeded = result.warnings.some((w) => w.kind === 'budget_exceeded');
  if (!exceeded && result.outputCount > budget) v.push(`output ${result.outputCount} > budget ${budget} without warning`);
  if (exceeded && result.outputCount > 2 * result.segments.length + 2) v.push('budget exceeded by more than endpoints + extrema');

  // 7. Invalid samples are all reported, by kind.
  const nonFinite = visible.filter((e) => !isFiniteValue(e.value));
  const reported = result.invalidRuns.reduce((n, r) => n + r.count, 0);
  if (reported !== nonFinite.length) v.push(`invalid runs report ${reported}, reference ${nonFinite.length}`);
  const kindSum = (k: 'nan' | 'positive_infinity' | 'negative_infinity' | 'missing') =>
    result.invalidRuns.reduce((n, r) => n + r.kinds[k], 0);
  const refKind = {
    nan: nonFinite.filter((e) => e.value !== null && Number.isNaN(e.value)).length,
    positive_infinity: nonFinite.filter((e) => e.value === Infinity).length,
    negative_infinity: nonFinite.filter((e) => e.value === -Infinity).length,
    missing: nonFinite.filter((e) => e.value === null).length,
  };
  for (const k of ['nan', 'positive_infinity', 'negative_infinity', 'missing'] as const) {
    if (kindSum(k) !== refKind[k]) v.push(`invalid ${k}: ${kindSum(k)} != ${refKind[k]}`);
  }
  return v;
}
