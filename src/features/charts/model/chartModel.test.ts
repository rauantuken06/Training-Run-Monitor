import { beforeAll, describe, expect, it } from 'vitest';
import { loadFrozenRun } from '../../../test/integrityTestUtils';
import type { MetricKey, TrainingRun } from '../../../types/training';
import { LARGE_RUN_SPIKE } from '../../data/catalog/runCatalog';
import { analyzeRun, type ChartView } from '../../data/integrity/analyzeRun';
import { budgetForWidth, buildChartModel, GRID, MAX_BUDGET, MIN_BUDGET, yBoundsFor } from './chartModel';

const views = new Map<string, { run: TrainingRun; view: ChartView }>();
function get(id: string) {
  let entry = views.get(id);
  if (!entry) {
    const run = loadFrozenRun(id);
    entry = { run, view: analyzeRun(run).view };
    views.set(id, entry);
  }
  return entry;
}
const FULL = { minStep: 0, maxStep: 19_990 };

describe('budgetForWidth', () => {
  it('gives 4 points per plot pixel column, clamped', () => {
    expect(budgetForWidth(1280)).toBe(4 * (1280 - GRID.left - GRID.right));
    expect(budgetForWidth(390)).toBe(4 * (390 - GRID.left - GRID.right));
    expect(budgetForWidth(0)).toBe(MIN_BUDGET);
    expect(budgetForWidth(100_000)).toBe(MAX_BUDGET);
    expect(budgetForWidth(1280)).toBeGreaterThan(budgetForWidth(390));
  });
});

describe('yBoundsFor', () => {
  it.each([
    [1, 2],
    [-5, -1],
    [0.25, 0.25],
    [0, 0],
    [3e-5, 3e-4],
    [-1.7976931348623157e308, 1.7976931348623157e308],
    [1.7976931348623157e308, 1.7976931348623157e308],
  ])('contains [%s, %s] and stays finite', (min, max) => {
    const b = yBoundsFor(min, max);
    expect(b.min).toBeLessThanOrEqual(min);
    expect(b.max).toBeGreaterThanOrEqual(max);
    expect(Number.isFinite(b.min) && Number.isFinite(b.max)).toBe(true);
    expect(b.max).toBeGreaterThan(b.min);
  });
});

describe('buildChartModel on real runs', () => {
  it.each(['run-01', 'run-09', 'run-11', 'run-15', 'run-17', 'run-19'])('%s: every plotted coordinate is an exact raw (step, value)', (id) => {
    const { run, view } = get(id);
    for (const metric of ['loss', 'lr', 'grad_norm'] as MetricKey[]) {
      for (const budget of [16, 200, 4_000]) {
        const model = buildChartModel(view, metric, FULL, budget);
        const flat = model.seriesData.flat();
        expect(flat).toHaveLength(model.result.outputCount);
        const mismatches = model.result.points.filter((p, i) => {
          const xy = flat[i];
          const raw = run.points[p.sourceIndex];
          return !xy || xy[0] !== p.step || !Object.is(xy[1], p.value) || raw?.step !== p.step || !Object.is(raw[metric], p.value);
        });
        expect(mismatches).toEqual([]);
        // Steps strictly ascending across all series.
        expect(flat.every((xy, i) => i === 0 || xy[0] > (flat[i - 1]?.[0] ?? Infinity))).toBe(true);
      }
    }
  });

  it('separates segments at invalid values and gaps (one series per segment)', () => {
    expect(buildChartModel(get('run-11').view, 'loss', FULL, 4_000).seriesData).toHaveLength(4);
    expect(buildChartModel(get('run-17').view, 'loss', FULL, 4_000).seriesData).toHaveLength(4);
    expect(buildChartModel(get('run-01').view, 'loss', FULL, 4_000).seriesData).toHaveLength(1);
    // Even at a tiny budget the segments are not merged.
    const tiny = buildChartModel(get('run-11').view, 'loss', FULL, 2);
    expect(tiny.seriesData).toHaveLength(4);
    expect(tiny.result.warnings.some((w) => w.kind === 'budget_exceeded')).toBe(true);
  });

  it('y-bounds contain the exact viewport extrema', () => {
    const model = buildChartModel(get('run-09').view, 'loss', FULL, 400);
    const values = model.seriesData.flat().map((xy) => xy[1]);
    expect(model.yBounds?.min).toBeLessThanOrEqual(Math.min(...values));
    expect(model.yBounds?.max).toBeGreaterThanOrEqual(Math.max(...values));
    expect(Math.max(...values)).toBe(model.result.extrema.max?.value);
  });

  it('has no line and no y-bounds when nothing finite is visible', () => {
    const model = buildChartModel(get('run-12').view, 'loss', { minStep: 15_000, maxStep: 16_000 }, 400);
    expect(model.seriesData).toEqual([]);
    expect(model.yBounds).toBeNull();
    expect(model.result.invalidRuns.reduce((n, r) => n + r.count, 0)).toBe(101);
  });
});

describe('million-point run: spike preserved in what the chart draws', () => {
  let view: ChartView;
  beforeAll(() => {
    view = get('run-20').view;
  });
  const hasSpike = (data: readonly (readonly (readonly [number, number])[])[]) =>
    data.some((s) => s.some(([x, y]) => x === LARGE_RUN_SPIKE.step && y === LARGE_RUN_SPIKE.value));

  it.each([390, 820, 1280, 1920])('full range at %i px wide', (width) => {
    const model = buildChartModel(view, 'loss', { minStep: 0, maxStep: 999_999 }, budgetForWidth(width));
    expect(hasSpike(model.seriesData)).toBe(true);
    expect(model.result.outputCount).toBeLessThanOrEqual(budgetForWidth(width));
    expect(model.yBounds?.max).toBeGreaterThanOrEqual(LARGE_RUN_SPIKE.value);
  });

  it('after zooming in around the spike, at many widths and offsets', () => {
    for (const span of [500_000, 50_000, 5_000, 300, 10, 0]) {
      for (const offset of [0, 0.1, 0.5, 0.9, 1]) {
        const minStep = Math.round(LARGE_RUN_SPIKE.step - span * offset);
        const model = buildChartModel(view, 'loss', { minStep, maxStep: minStep + span }, budgetForWidth(800));
        expect(hasSpike(model.seriesData), `span ${span} offset ${offset}`).toBe(true);
        expect(model.yBounds?.max).toBeGreaterThanOrEqual(LARGE_RUN_SPIKE.value);
      }
    }
  });

  it('a viewport next to the spike neither draws it nor scales for it', () => {
    const model = buildChartModel(view, 'loss', { minStep: LARGE_RUN_SPIKE.step + 1, maxStep: LARGE_RUN_SPIKE.step + 5_000 }, 1_000);
    expect(hasSpike(model.seriesData)).toBe(false);
    expect(model.yBounds?.max).toBeLessThan(5);
  });
});
