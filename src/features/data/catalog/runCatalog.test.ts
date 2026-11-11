import { describe, expect, it } from 'vitest';
import type { RunScenario } from '../../../types/training';
import { DATASET_SEED, deriveSeed } from '../generators/random';
import type { StepRange } from '../generators/runDefinition';
import { LARGE_RUN_ID, LARGE_RUN_SPIKE, RUN_DEFINITIONS } from './runCatalog';

const ALL_SCENARIOS: readonly RunScenario[] = [
  'healthy',
  'noisy',
  'plateau',
  'diverging',
  'nan_loss',
  'infinite_loss',
  'duplicate_steps',
  'unsorted_steps',
  'missing_steps',
  'missing_values',
  'large_dataset',
  'loss_spike',
];

describe('run catalog', () => {
  it('defines exactly 20 runs', () => {
    expect(RUN_DEFINITIONS).toHaveLength(20);
  });

  it('gives every run a unique, stable, URL-safe ID and a unique name', () => {
    const ids = RUN_DEFINITIONS.map((d) => d.metadata.id);
    expect(new Set(ids).size).toBe(20);
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => `run-${String(i + 1).padStart(2, '0')}`));
    expect(new Set(RUN_DEFINITIONS.map((d) => d.metadata.name)).size).toBe(20);
  });

  it('gives every run complete metadata', () => {
    for (const { metadata } of RUN_DEFINITIONS) {
      expect(metadata.name.length).toBeGreaterThan(0);
      expect(metadata.description.length).toBeGreaterThan(0);
      expect(metadata.scenarios.length).toBeGreaterThan(0);
      expect(new Date(metadata.createdAt).toISOString()).toBe(metadata.createdAt);
      expect(Object.keys(metadata.config).length).toBeGreaterThan(0);
    }
  });

  it('covers every scenario at least once', () => {
    const covered = new Set(RUN_DEFINITIONS.flatMap((d) => d.metadata.scenarios));
    expect([...covered].sort()).toEqual([...ALL_SCENARIOS].sort());
  });

  it('derives a distinct seed per run from the dataset seed and run ID', () => {
    for (const def of RUN_DEFINITIONS) {
      expect(def.seed).toBe(deriveSeed(DATASET_SEED, def.metadata.id));
    }
    expect(new Set(RUN_DEFINITIONS.map((d) => d.seed)).size).toBe(20);
  });

  it('places every anomaly step on its run grid, without overlapping ranges', () => {
    for (const def of RUN_DEFINITIONS) {
      const { anomalies, stepInterval, length } = def;
      const lastStep = (length - 1) * stepInterval;
      const onGrid = (step: number) =>
        Number.isInteger(step / stepInterval) && step >= 0 && step <= lastStep;

      const singleSteps = [
        ...(anomalies.valueOverrides ?? []).map((o) => o.step),
        ...(anomalies.valueTails ?? []).map((t) => t.fromStep),
        ...(anomalies.delayedBlocks ?? []).map((b) => b.afterStep),
      ];
      const ranges: StepRange[] = [
        ...(anomalies.gaps ?? []),
        ...(anomalies.duplicates ?? []),
        ...(anomalies.delayedBlocks ?? []),
      ];

      for (const step of singleSteps) expect(onGrid(step), `${def.metadata.id} step ${step}`).toBe(true);
      for (const r of ranges) {
        expect(onGrid(r.fromStep) && onGrid(r.toStep) && r.fromStep <= r.toStep).toBe(true);
      }
      const sorted = [...ranges].sort((a, b) => a.fromStep - b.fromStep);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (prev && cur) expect(cur.fromStep, def.metadata.id).toBeGreaterThan(prev.toStep);
      }
    }
  });

  it('has exactly one million-point run, with its spike near the midpoint', () => {
    const large = RUN_DEFINITIONS.filter((d) => d.length >= 1_000_000);
    expect(large.map((d) => d.metadata.id)).toEqual([LARGE_RUN_ID]);
    expect(large[0]?.length).toBe(1_000_000);
    expect(large[0]?.stepInterval).toBe(1);
    expect(Math.abs(LARGE_RUN_SPIKE.step - 500_000)).toBeLessThan(10_000);
  });

  it('puts the spike on a step no common stride would sample', () => {
    for (const stride of [2, 4, 5, 8, 10, 16, 100, 1_000]) {
      expect(LARGE_RUN_SPIKE.step % stride).not.toBe(0);
    }
  });
});
