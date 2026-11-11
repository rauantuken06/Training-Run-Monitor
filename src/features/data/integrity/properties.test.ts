/**
 * Randomized property tests. Inputs come from a seeded PRNG, so every run checks
 * the same cases and any failure is reproducible from its case number.
 * Each invariant is checked against an independent brute-force oracle, not
 * against the engine's own helpers.
 */
import { describe, expect, it } from 'vitest';
import { freezePoints } from '../../../test/integrityTestUtils';
import type { MetricKey, MetricValue, StepSampling, TrainingPoint } from '../../../types/training';
import { createGaussian, mulberry32, type Rng } from '../generators/random';
import { analyzeRun, stepAt, valueAt } from './analyzeRun';

const METRICS: readonly MetricKey[] = ['loss', 'lr', 'grad_norm'];
const CASES = 400;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

function randomValue(rng: Rng, gaussian: () => number): MetricValue {
  const r = rng();
  if (r < 0.08) return Number.NaN;
  if (r < 0.12) return Number.POSITIVE_INFINITY;
  if (r < 0.15) return Number.NEGATIVE_INFINITY;
  if (r < 0.22) return null;
  if (r < 0.25) return 0;
  return gaussian() * 3;
}

function randomCase(seed: number): { points: TrainingPoint[]; sampling: StepSampling } {
  const rng = mulberry32(seed);
  const gaussian = createGaussian(rng);
  const interval = pick(rng, [1, 5, 10]);
  const sampling: StepSampling = rng() < 0.2 ? { kind: 'irregular' } : { kind: 'fixed', interval };
  const n = Math.floor(rng() * 60);
  const value = () => randomValue(rng, gaussian);

  const points: TrainingPoint[] = [];
  let step = Math.floor(rng() * 5) * interval;
  for (let i = 0; i < n; i++) {
    const r = rng();
    if (r < 0.05) points.push({ step: pick(rng, [Number.NaN, -interval, 2.5, Infinity]), loss: value(), lr: value(), grad_norm: value() });
    else if (r < 0.15 && points.length > 0) {
      const source = pick(rng, points);
      points.push(rng() < 0.5 ? { ...source } : { step: source.step, loss: value(), lr: value(), grad_norm: value() });
    } else {
      step += interval * (rng() < 0.15 ? 2 + Math.floor(rng() * 4) : 1);
      if (rng() < 0.05) step += 1; // occasional off-grid step
      points.push({ step, loss: value(), lr: value(), grad_norm: value() });
    }
  }
  // Shuffle a few slices to create out-of-order records.
  for (let k = 0; k < 2 && points.length > 4; k++) {
    if (rng() < 0.5) continue;
    const a = Math.floor(rng() * (points.length - 2));
    const len = 1 + Math.floor(rng() * 3);
    points.splice(Math.floor(rng() * (points.length - len)), 0, ...points.splice(a, len));
  }
  return { points, sampling };
}

const validStep = (s: number) => Number.isInteger(s) && s >= 0;

const BATCH = 50;
const batches = Array.from({ length: CASES / BATCH }, (_, b) => b * BATCH);

describe(`integrity invariants over ${CASES} random runs`, () => {
  it.each(batches)('hold for cases %i..+49', (firstCase) => {
    for (let c = firstCase; c < firstCase + BATCH; c++) {
      const { points: raw, sampling } = randomCase(9_000 + c);
      const snapshot = raw.map((p) => ({ ...p }));
      const points = freezePoints(raw);
      const label = `case ${c}`;
      const r = analyzeRun({ id: label, sampling, points });
      const { view, diagnostics, summaries } = r;
      const len = view.displayIndex.length;

      // 1. Input unchanged (frozen, and equal to a snapshot taken beforehand).
      expect(points, label).toEqual(snapshot);

      // 2. Display steps are strictly ascending, and are exactly the distinct valid steps.
      const shown = Array.from({ length: len }, (_, p) => stepAt(view, p));
      const distinct = [...new Set(points.map((p) => p.step).filter(validStep))].sort((a, b) => a - b);
      expect(shown, label).toEqual(distinct);

      // 3. Each displayed record is the last recorded one for its step.
      const lastIndexOfStep = new Map<number, number>();
      points.forEach((q, i) => lastIndexOfStep.set(q.step, i));
      expect(Array.from(view.displayIndex), label).toEqual(shown.map((s) => lastIndexOfStep.get(s)));

      // 4. Duplicates and conflicts match brute force.
      const byStep = new Map<number, TrainingPoint[]>();
      for (const p of points) if (validStep(p.step)) byStep.set(p.step, [...(byStep.get(p.step) ?? []), p]);
      const dupGroups = [...byStep.values()].filter((g) => g.length > 1);
      expect(diagnostics.duplicateStepCount, label).toBe(dupGroups.length);
      const conflicting = dupGroups.filter((g) => METRICS.some((m) => g.some((p) => !Object.is(p[m], g[0]?.[m]))));
      expect(diagnostics.conflictingDuplicateCount, label).toBe(conflicting.length);

      // 5. Unsorted records match brute force.
      let descents = 0;
      let prev: number | null = null;
      for (const p of points) {
        if (!validStep(p.step)) continue;
        if (prev !== null && p.step < prev) descents++;
        prev = p.step;
      }
      expect(diagnostics.issueCounts.unsorted_step, label).toBe(descents);
      expect(diagnostics.isSorted, label).toBe(descents === 0);

      // 6. Missing steps match a brute-force grid scan.
      let expectedMissing = 0;
      if (sampling.kind === 'fixed' && distinct.length > 0) {
        const present = new Set(distinct);
        const origin = distinct[0] as number;
        const end = distinct[distinct.length - 1] as number;
        for (let s = origin; s <= end; s += sampling.interval) if (!present.has(s)) expectedMissing++;
      }
      expect(diagnostics.missingStepCount, label).toBe(expectedMissing);

      // 7. Counts, min and max match brute force; non-finite values never leak into min/max.
      for (const m of METRICS) {
        const values = points.map((p) => p[m]);
        const s = summaries[m];
        expect(s.counts, label).toEqual({
          finite: values.filter((v) => v !== null && Number.isFinite(v)).length,
          nan: values.filter((v) => v !== null && Number.isNaN(v)).length,
          positiveInfinity: values.filter((v) => v === Infinity).length,
          negativeInfinity: values.filter((v) => v === -Infinity).length,
          missing: values.filter((v) => v === null).length,
        });
        const placeable = points.filter((p) => validStep(p.step)).map((p) => p[m]).filter((v): v is number => v !== null && Number.isFinite(v));
        expect(s.min?.value ?? null, label).toBe(placeable.length ? Math.min(...placeable) : null);
        expect(s.max?.value ?? null, label).toBe(placeable.length ? Math.max(...placeable) : null);
        expect(s.endsNonFinite, label).toBe(len > 0 && !Number.isFinite(valueAt(view, m, len - 1)));
      }

      // 8. Segments cover exactly the finite displayed positions, never cross a gap, and are maximal.
      const gapAfter = new Set(view.gaps.map((g) => g.afterPosition));
      for (const m of METRICS) {
        const covered: number[] = [];
        const violations: string[] = [];
        const segs = view.metrics[m].segments;
        for (const { start, end } of segs) {
          for (let p = start; p <= end; p++) {
            covered.push(p);
            if (p < end && gapAfter.has(p)) violations.push(`crosses gap after ${p}`);
          }
        }
        for (let k = 1; k < segs.length; k++) {
          const before = segs[k - 1]?.end ?? 0;
          const after = segs[k]?.start ?? 0;
          if (!(after > before + 1 || gapAfter.has(before))) violations.push(`not maximal at ${before}`);
        }
        const finitePositions = shown.map((_, p) => p).filter((p) => Number.isFinite(valueAt(view, m, p)));
        expect(covered, `${label} ${m}`).toEqual(finitePositions);
        expect(violations, `${label} ${m}`).toEqual([]);
      }

      // 9. Deterministic.
      expect(analyzeRun({ id: label, sampling, points }), label).toEqual(r);
    }
  });
});
