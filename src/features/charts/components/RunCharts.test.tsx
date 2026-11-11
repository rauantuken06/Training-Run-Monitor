import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureRun, pt } from '../../../test/integrityTestUtils';
import { renderRoute } from '../../../test/renderRoute';
import { analyzeRun } from '../../data/integrity/analyzeRun';
import { budgetForWidth, GRID } from '../model/chartModel';
import { RunCharts } from './RunCharts';

const width = vi.hoisted(() => ({ value: 1_000 }));
vi.mock('../hooks/useElementWidth', () => ({ useElementWidth: () => width.value, FALLBACK_WIDTH: 640 }));

beforeEach(() => {
  width.value = 1_000;
});

const METRICS = ['loss', 'lr', 'grad_norm'] as const;
const chart = (metric: string) => screen.getByTestId(`metric-chart-${metric}`);
const xRange = (metric: string) => [Number(chart(metric).dataset.xMin), Number(chart(metric).dataset.xMax)];
async function openRun(id: string) {
  const r = renderRoute(`/runs/${id}`);
  await screen.findByTestId('metric-chart-loss', {}, { timeout: 5_000 });
  return r;
}

describe('RunCharts on real runs', () => {
  it('renders three titled charts with text summaries over the full step range', async () => {
    await openRun('run-11');
    for (const name of ['Loss chart', 'Learning rate chart', 'Gradient norm chart']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    for (const m of METRICS) expect(xRange(m)).toEqual([0, 19_990]);
    expect(chart('loss')).toHaveAccessibleName(/^Loss chart, steps 0 to 19,990: all 1,997 observations plotted\. Minimum .+ at step [\d,]+; maximum .+ at step [\d,]+\.$/);
    expect(screen.getByText('Showing steps 0–19,990 (full run)')).toBeInTheDocument();
  });

  it('zooms, pans and resets all three charts together with the keyboard', async () => {
    const { user } = await openRun('run-01');
    screen.getByRole('button', { name: 'Zoom in' }).focus();
    await user.keyboard('{Enter}');
    for (const m of METRICS) expect(xRange(m)).toEqual([4_998, 14_993]);
    expect(screen.getByText('Showing steps 4,998–14,993 of 0–19,990')).toBeInTheDocument();

    screen.getByRole('button', { name: 'Pan right →' }).focus();
    await user.keyboard(' ');
    for (const m of METRICS) expect(xRange(m)).toEqual([7_497, 17_492]);

    screen.getByRole('button', { name: 'Reset zoom' }).focus();
    await user.keyboard('{Enter}');
    for (const m of METRICS) expect(xRange(m)).toEqual([0, 19_990]);
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '← Pan left' })).toBeDisabled();
  });

  it('zooms to an exact range typed into the form, and rejects invalid ranges', async () => {
    const { user } = await openRun('run-01');
    await user.type(screen.getByLabelText('From step'), '5,000');
    await user.type(screen.getByLabelText('To step'), '1000');
    await user.click(screen.getByRole('button', { name: 'Apply range' }));
    expect(screen.getByRole('alert')).toHaveTextContent('"From" must be smaller than "To".');
    expect(xRange('loss')).toEqual([0, 19_990]);

    await user.clear(screen.getByLabelText('To step'));
    await user.type(screen.getByLabelText('To step'), '6000{Enter}');
    for (const m of METRICS) expect(xRange(m)).toEqual([5_000, 6_000]);
  });

  it('regression: rejects locale-ambiguous input ("5.000") instead of zooming to step 5', async () => {
    const { user } = await openRun('run-01');
    await user.type(screen.getByLabelText('From step'), '5.000');
    await user.type(screen.getByLabelText('To step'), '6.000{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('From: "5.000": steps are whole numbers; write 5000 or 5,000 (not 5.000).');
    expect(xRange('loss')).toEqual([0, 19_990]);
  });

  it('regression: trims a partly outside range (with a note) and rejects a range without data', async () => {
    const { user } = await openRun('run-01');
    await user.type(screen.getByLabelText('From step'), '19000');
    await user.type(screen.getByLabelText('To step'), '25000{Enter}');
    for (const m of METRICS) expect(xRange(m)).toEqual([19_000, 19_990]);
    expect(screen.getByText("Adjusted to steps 19,000–19,990: this run's data covers 0–19,990.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText('From step'));
    await user.clear(screen.getByLabelText('To step'));
    await user.type(screen.getByLabelText('From step'), '30000');
    await user.type(screen.getByLabelText('To step'), '40000{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('No data in steps 30,000–40,000; this run has steps 0–19,990.');
    expect(xRange('loss')).toEqual([19_000, 19_990]); // unchanged, not silently moved
  });

  it('zooms to a dragged pixel range (applied on release) and ignores tiny drags', async () => {
    await openRun('run-01');
    const plotWidth = width.value - GRID.left - GRID.right;
    const stepAt = (x: number) => ((x - GRID.left) / plotWidth) * 19_990;
    const el = chart('loss');

    fireEvent.pointerDown(el, { clientX: 300, button: 0, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(el, { clientX: 303, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerUp(el, { clientX: 303, pointerId: 1, pointerType: 'mouse' });
    expect(xRange('loss')).toEqual([0, 19_990]);

    fireEvent.pointerDown(el, { clientX: 300, button: 0, pointerId: 1, pointerType: 'mouse' });
    fireEvent.pointerMove(el, { clientX: 400, pointerId: 1, pointerType: 'mouse' });
    expect(xRange('loss')).toEqual([0, 19_990]); // nothing changes until release
    fireEvent.pointerUp(el, { clientX: 400, pointerId: 1, pointerType: 'mouse' });
    const expected = [Math.round(stepAt(300)), Math.round(stepAt(300)) + Math.round(stepAt(400) - stepAt(300))];
    for (const m of METRICS) expect(xRange(m)).toEqual(expected);
  });

  it('shows visible warnings on charts with anomalies', async () => {
    await openRun('run-12');
    const loss = screen.getByRole('list', { name: 'Loss chart warnings' });
    expect(loss).toHaveTextContent('600 invalid loss values in view (600 NaN)');
    expect(screen.queryByRole('list', { name: 'Learning rate chart warnings' })).not.toBeInTheDocument();
  });

  it('warns about gaps and conflicting duplicates', async () => {
    const { unmount } = await openRun('run-17');
    expect(screen.getByRole('list', { name: 'Loss chart warnings' })).toHaveTextContent('301 missing steps in 3 ranges');
    expect(chart('loss').dataset.segments).toBe('4');
    unmount();
    const { user } = await openRun('run-15');
    const warnings = () => screen.getByRole('list', { name: 'Loss chart warnings' });
    expect(warnings()).toHaveTextContent('50 steps were logged more than once with different loss values');
    // Full range: the hidden copies lie inside the plotted min/max, so no "outside" warning.
    expect(warnings()).not.toHaveTextContent(/hidden duplicate value/);

    // One-step view of a conflicting step: the plotted extrema are the displayed copy,
    // so the differing hidden copy is necessarily outside them and must be reported.
    await user.type(screen.getByLabelText('From step'), '8200');
    await user.type(screen.getByLabelText('To step'), '8201{Enter}');
    expect(xRange('loss')).toEqual([8_200, 8_201]);
    expect(warnings()).toHaveTextContent('1 step was logged more than once');
    expect(warnings()).toHaveTextContent(/1 hidden duplicate value lies outside the plotted range \(.+ at step 8,200\)/);
  });

  it.each([390, 820, 1_280])('uses a width-driven point budget (%i px)', async (w) => {
    width.value = w;
    await openRun('run-05');
    expect(Number(chart('loss').dataset.budget)).toBe(budgetForWidth(w));
    expect(Number(chart('loss').dataset.plotted)).toBeLessThanOrEqual(budgetForWidth(w));
  });

  it('starts a newly opened run at its full range, with its own data', async () => {
    const { user, router } = await openRun('run-01');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(xRange('loss')).toEqual([4_998, 14_993]);

    await act(() => router.navigate('/runs/run-12'));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'nan-loss-fp16-overflow' })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Loss chart warnings' })).toBeInTheDocument();
    });
    expect(xRange('loss')).toEqual([0, 19_990]);
    expect(chart('loss').dataset.input).toBe('1400');
  });
});

describe('RunCharts edge cases', () => {
  it('explains an all-invalid metric instead of drawing it', () => {
    const run = fixtureRun([pt(0, Number.NaN), pt(10, Infinity), pt(20, null)]);
    render(<RunCharts view={analyzeRun(run).view} />);
    const warnings = screen.getByRole('list', { name: 'Loss chart warnings' });
    expect(within(warnings).getByText(/No finite loss values in this range/)).toBeInTheDocument();
    expect(warnings).toHaveTextContent('3 invalid loss values in view (1 NaN, 1 +Infinity, 1 not recorded (null))');
    expect(chart('loss').dataset.plotted).toBe('0');
    expect(chart('loss')).toHaveAccessibleName('Loss chart, steps 0 to 20: no finite values to plot.');
  });

  it('says there is nothing to chart for a run without placeable records', () => {
    render(<RunCharts view={analyzeRun(fixtureRun([])).view} />);
    expect(screen.getByText(/nothing to chart/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
  });
});
