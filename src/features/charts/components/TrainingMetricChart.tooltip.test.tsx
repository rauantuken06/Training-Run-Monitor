/**
 * The ECharts wrapper is replaced by a stub that records the option it receives,
 * so the real tooltip formatter can be called with ECharts-shaped params.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { loadFrozenRun } from '../../../test/integrityTestUtils';
import { analyzeRun } from '../../data/integrity/analyzeRun';
import * as downsampling from '../../data/downsampling/downsample';
import { GRID } from '../model/chartModel';
import { TrainingMetricChart } from './TrainingMetricChart';

const captured = vi.hoisted(() => ({ options: [] as { tooltip: { formatter: (p: unknown) => string } }[] }));
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props: { option: { tooltip: { formatter: (p: unknown) => string } } }) => {
    captured.options.push(props.option);
    return <div data-testid="echarts-stub" />;
  },
}));
vi.mock('../hooks/useElementWidth', () => ({ useElementWidth: () => 1_000, FALLBACK_WIDTH: 640 }));
vi.mock('../../data/downsampling/downsample', async (importOriginal) => {
  const actual = await importOriginal<typeof downsampling>();
  return { ...actual, downsampleMetric: vi.fn(actual.downsampleMetric) };
});

const VIEWPORT = { minStep: 0, maxStep: 19_990 };
const PLOT_WIDTH = 1_000 - GRID.left - GRID.right;
const xForStep = (step: number) => GRID.left + (step / 19_990) * PLOT_WIDTH;
const lastFormatter = () => {
  const option = captured.options.at(-1);
  if (!option) throw new Error('no option rendered');
  return option.tooltip.formatter;
};

function renderChart(id: string) {
  const view = analyzeRun(loadFrozenRun(id)).view;
  render(<TrainingMetricChart view={view} metric="loss" viewport={VIEWPORT} onViewportChange={() => undefined} />);
  return screen.getByTestId('metric-chart-loss');
}

describe('tooltip', () => {
  it('describes the cursor position, not ECharts’ nearest data x (regression: gaps were missed)', () => {
    const el = renderChart('run-17');
    // ECharts reports the nearest data point (4,000) as axisValue while the cursor is inside the gap.
    fireEvent.pointerMove(el, { clientX: xForStep(3_500) });
    const html = lastFormatter()([{ axisValue: 4_000 }]);
    expect(html).toContain('Missing steps 3,000–3,990 (100 not recorded). The line is broken here.');
  });

  it('falls back to the axis value when the cursor position is unknown', () => {
    const el = renderChart('run-09');
    fireEvent.pointerLeave(el);
    const html = lastFormatter()([{ axisValue: 19_990 }]);
    expect(html).toMatch(/^<strong>Step 19,990<\/strong><br\/>Loss: 102\.47 \(exact 102\.47\d+\)$/);
  });

  it('shows exact values and the duplicate warning for a conflicting step', () => {
    const el = renderChart('run-15');
    fireEvent.pointerMove(el, { clientX: xForStep(8_200) });
    const html = lastFormatter()([{ axisValue: 8_200 }]);
    expect(html).toMatch(/Step logged 2× with different values/);
  });

  it('never re-runs downsampling on hover or pointer movement', () => {
    const el = renderChart('run-01');
    const calls = vi.mocked(downsampling.downsampleMetric).mock.calls.length;
    const renders = captured.options.length;
    for (let x = 100; x < 900; x += 7) fireEvent.pointerMove(el, { clientX: x });
    for (let i = 0; i < 20; i++) lastFormatter()([{ axisValue: i * 1_000 }]);
    expect(vi.mocked(downsampling.downsampleMetric).mock.calls.length).toBe(calls);
    expect(captured.options.length).toBe(renders); // no re-render, no new option
  });
});
