/**
 * Task 08 regression tests for redundant chart work (measured in Chrome traces):
 * each chart downsampled twice on mount (guessed width, then real width), and
 * "Reset zoom" re-downsampled the full range although that model already existed.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFrozenRun } from '../../../test/integrityTestUtils';
import * as downsampling from '../../data/downsampling/downsample';
import { analyzeRun } from '../../data/integrity/analyzeRun';
import { buildChartModelCached, MODEL_CACHE_SIZE } from '../model/chartModel';
import { RunCharts } from './RunCharts';

vi.mock('../../data/downsampling/downsample', async (importOriginal) => {
  const actual = await importOriginal<typeof downsampling>();
  return { ...actual, downsampleMetric: vi.fn(actual.downsampleMetric) };
});
const calls = () => vi.mocked(downsampling.downsampleMetric).mock.calls;

beforeEach(() => {
  vi.mocked(downsampling.downsampleMetric).mockClear();
});

describe('chart work on mount and zoom', () => {
  it('downsamples each chart once when it first renders, for its real width', () => {
    // A real layout width that differs from the 640 px fallback, as in a browser (Chrome: 1,182 px).
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1_000, 260));
    render(<RunCharts view={analyzeRun(loadFrozenRun('run-01')).view} />);
    expect(screen.getByTestId('metric-chart-loss')).toHaveAttribute('data-width', '1000');
    expect(calls().map((c) => [c[1], c[3]])).toEqual([
      ['loss', 3_552],
      ['lr', 3_552],
      ['grad_norm', 3_552],
    ]); // one call per chart, with the budget for 1,000 px (4 × 888 plot px)
    rect.mockRestore();
  });

  it('"Reset zoom" reuses the full-range models; a new viewport is computed', async () => {
    const user = userEvent.setup();
    render(<RunCharts view={analyzeRun(loadFrozenRun('run-12')).view} />);
    expect(calls()).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(calls()).toHaveLength(6); // new viewport: computed
    await user.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(calls()).toHaveLength(6); // full range again: reused
    expect(screen.getByRole('list', { name: 'Loss chart warnings' })).toHaveTextContent('600 invalid loss values');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(calls()).toHaveLength(6); // that half viewport is cached too
  });
});

describe('buildChartModelCached', () => {
  const view = analyzeRun(loadFrozenRun('run-11')).view;
  const FULL = { minStep: 0, maxStep: 19_990 };

  it('returns the same model for the same view, metric, viewport and budget', () => {
    const a = buildChartModelCached(view, 'loss', FULL, 400);
    expect(buildChartModelCached(view, 'loss', { ...FULL }, 400)).toBe(a);
    expect(buildChartModelCached(view, 'lr', FULL, 400)).not.toBe(a);
    expect(buildChartModelCached(view, 'loss', FULL, 404)).not.toBe(a);
    expect(buildChartModelCached(analyzeRun(loadFrozenRun('run-11')).view, 'loss', FULL, 400)).not.toBe(a); // another view object
  });

  it(`keeps at most ${MODEL_CACHE_SIZE} models per view`, () => {
    const fresh = analyzeRun(loadFrozenRun('run-01')).view;
    const first = buildChartModelCached(fresh, 'loss', { minStep: 0, maxStep: 100 }, 64);
    for (let i = 1; i <= MODEL_CACHE_SIZE; i++) buildChartModelCached(fresh, 'loss', { minStep: 0, maxStep: 100 + i * 10 }, 64);
    vi.mocked(downsampling.downsampleMetric).mockClear();
    expect(buildChartModelCached(fresh, 'loss', { minStep: 0, maxStep: 100 }, 64)).not.toBe(first); // evicted, recomputed
    expect(calls()).toHaveLength(1);
  });
});
