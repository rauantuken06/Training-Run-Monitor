/**
 * P. Randomized comparison against the independent brute-force reference.
 * Seeded, so every run checks the same cases; failures name their case.
 */
import { describe, expect, it } from 'vitest';
import { checkDownsample } from '../../../test/downsampleReference';
import { freezePoints } from '../../../test/integrityTestUtils';
import type { MetricKey, MetricValue, StepSampling, TrainingPoint } from '../../../types/training';
import { createGaussian, mulberry32, type Rng } from '../generators/random';
import { analyzeRun } from '../integrity/analyzeRun';
import { downsampleMetric } from './downsample';

const CASES = 300;
const BATCH = 50;
const METRICS: readonly MetricKey[] = ['loss', 'lr', 'grad_norm'];

const pick = <T,>(rng: Rng, items: readonly T[]) => items[Math.floor(rng() * items.length)] as T;

function randomValue(rng: Rng, g: () => number): MetricValue {
  const r = rng();
  if (r < 0.04) return Number.NaN;
  if (r < 0.06) return Infinity;
  if (r < 0.08) return -Infinity;
  if (r < 0.12) return null;
  if (r < 0.14) return 0;
  return g() * pick(rng, [1e-9, 1, 1e6]) + (rng() < 0.01 ? 1e3 : 0); // occasional spike
}

function randomCase(seed: number) {
  const rng = mulberry32(seed);
  const g = createGaussian(rng);
  const interval = pick(rng, [1, 3, 10]);
  const sampling: StepSampling = rng() < 0.25 ? { kind: 'irregular' } : { kind: 'fixed', interval };
  const n = Math.floor(rng() * 400);
  const points: TrainingPoint[] = [];
  let step = 0;
  for (let i = 0; i < n; i++) {
    if (rng() < 0.05 && points.length > 0) {
      const src = pick(rng, points);
      points.push(rng() < 0.5 ? { ...src } : { step: src.step, loss: randomValue(rng, g), lr: randomValue(rng, g), grad_norm: randomValue(rng, g) });
      continue;
    }
    step += interval * (rng() < 0.05 ? 2 + Math.floor(rng() * 6) : 1);
    points.push({ step, loss: randomValue(rng, g), lr: randomValue(rng, g), grad_norm: randomValue(rng, g) });
  }
  if (points.length > 6 && rng() < 0.3) points.splice(2, 0, ...points.splice(4, 2)); // out of order
  const lastStep = step;
  // A valid random viewport: sometimes fractional, sometimes very narrow, sometimes outside the data.
  const minStep = Math.floor(rng() * (lastStep + 20)) - 10 + (rng() < 0.3 ? 0.5 : 0);
  const width = Math.floor(rng() * (lastStep + 20)) * (rng() < 0.2 ? 0.01 : 1);
  return {
    points,
    sampling,
    viewport: { minStep, maxStep: minStep + width },
    budget: pick(rng, [1, 2, 3, 4, 5, 8, 13, 40, 100, 1_000]),
  };
}

describe(`P. downsampling vs brute-force reference over ${CASES} random runs`, () => {
  it.each(Array.from({ length: CASES / BATCH }, (_, k) => k * BATCH))('cases %i..+49', (first) => {
    const violations: string[] = [];
    for (let c = first; c < first + BATCH; c++) {
      const { points: raw, sampling, viewport, budget } = randomCase(77_000 + c);
      const points = freezePoints(raw);
      const view = analyzeRun({ id: `case-${c}`, sampling, points }).view;
      for (const metric of METRICS) {
        const result = downsampleMetric(view, metric, viewport, budget);
        for (const msg of checkDownsample(points, sampling, metric, viewport, budget, result)) {
          violations.push(`case ${c} ${metric} [${viewport.minStep}, ${viewport.maxStep}] budget ${budget}: ${msg}`);
        }
        // H. deterministic
        if (JSON.stringify(downsampleMetric(view, metric, viewport, budget)) !== JSON.stringify(result)) {
          violations.push(`case ${c} ${metric}: not deterministic`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
