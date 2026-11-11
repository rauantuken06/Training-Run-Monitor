/**
 * Task 07 reliability audit: stale data, request races and error handling on the
 * real pages, with real data. Requests complete only when the test says so, in a
 * chosen order. This simulates out-of-order completion; it does not prove the
 * behaviour of a real network.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createControlledRepository } from '../../../test/controlledRepository';
import { renderRoute } from '../../../test/renderRoute';
import type { TrainingRun } from '../../../types/training';
import { createRunRepository, type RunRepository } from '../../data/repository/runRepository';

const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
const lossCardLast = () => {
  const card = screen.getByRole('region', { name: 'Loss' });
  return within(card).getByText('Last recorded', { selector: 'dt' }).parentElement?.querySelector('data')?.value;
};
async function ready() {
  await screen.findByRole('heading', { name: 'Data quality' });
}
async function pending(c: ReturnType<typeof createControlledRepository>, id: string) {
  await waitFor(() => {
    expect(c.isPending(id)).toBe(true);
  });
}

describe('request races: A → B → C', () => {
  it('responses arriving C, B, A: only C is ever shown', async () => {
    const c = createControlledRepository();
    const { router } = renderRoute('/runs/run-01', { repository: c.repository }); // A
    await pending(c, 'run-01');
    await act(() => router.navigate('/runs/run-12')); // B
    await pending(c, 'run-12');
    await act(() => router.navigate('/runs/run-15')); // C
    await pending(c, 'run-15');

    await act(() => c.resolve('run-15'));
    await ready();
    await act(() => c.resolve('run-12'));
    await act(() => c.resolve('run-01'));

    expect(heading()).toBe('duplicate-steps-multi-rank-logging');
    expect(screen.getByTestId('quality-duplicates')).toHaveTextContent('51');
    expect(screen.getByTestId('quality-invalid-values')).toHaveTextContent('None'); // nothing from run-12's NaNs
    expect(await screen.findByRole('list', { name: 'Loss chart warnings' })).toHaveTextContent('50 steps were logged more than once');
    expect(screen.getByRole('list', { name: 'Loss chart warnings' })).not.toHaveTextContent('NaN');
    expect(screen.getByTestId('metric-chart-loss').dataset.input).toBe('2000');
  });

  it('responses arriving A, B before C: C keeps loading and shows nothing of A or B', async () => {
    const c = createControlledRepository();
    const { router } = renderRoute('/runs/run-01', { repository: c.repository });
    await pending(c, 'run-01');
    await act(() => router.navigate('/runs/run-12'));
    await pending(c, 'run-12');
    await act(() => router.navigate('/runs/run-15'));
    await pending(c, 'run-15');

    await act(() => c.resolve('run-01'));
    await act(() => c.resolve('run-12'));
    expect(heading()).toBe('duplicate-steps-multi-rank-logging');
    expect(screen.getByRole('status')).toHaveTextContent('Loading 2,051 observations');
    expect(screen.queryByRole('heading', { name: 'Data quality' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart-loss')).not.toBeInTheDocument();

    await act(() => c.resolve('run-15'));
    await ready();
    expect(screen.getByTestId('quality-duplicates')).toHaveTextContent('50 conflicting');
  });

  it('a failure of a superseded request never appears on the current run', async () => {
    const c = createControlledRepository();
    const { router } = renderRoute('/runs/run-01', { repository: c.repository });
    await pending(c, 'run-01');
    await act(() => router.navigate('/runs/run-15'));
    await pending(c, 'run-15');
    act(() => {
      c.reject('run-01', new Error('old request failed'));
    });
    await act(() => c.resolve('run-15'));
    await ready();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/old request failed/)).not.toBeInTheDocument();
  });

  it('unmounting before the response arrives is safe (no React errors)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const c = createControlledRepository();
    const { unmount } = renderRoute('/runs/run-01', { repository: c.repository });
    await pending(c, 'run-01');
    unmount();
    await act(() => c.resolve('run-01'));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('stale data and caching', () => {
  it('a new run object for the same ID is analyzed afresh (no stale cached analysis)', async () => {
    // The catalog is immutable; an "update" is simulated by returning a new object on the second request.
    const base = createRunRepository();
    let calls = 0;
    const repository: RunRepository = {
      ...base,
      getRun: async (id) => {
        const run = (await base.getRun(id)) as TrainingRun;
        calls++;
        if (calls === 1) return run;
        return { ...run, points: run.points.map((p) => (p.step === 19_990 ? { ...p, loss: 9.75 } : p)) };
      },
    };
    const { router } = renderRoute('/runs/run-01', { repository });
    await ready();
    const before = lossCardLast();
    await act(() => router.navigate('/'));
    await act(() => router.navigate('/runs/run-01'));
    await ready();
    expect(before).not.toBe('9.75');
    expect(lossCardLast()).toBe('9.75');
  });

  it('re-opening a run reuses the same data and shows identical numbers', async () => {
    const { router } = renderRoute('/runs/run-12');
    await ready();
    const first = [lossCardLast(), screen.getByTestId('quality-overview').textContent];
    await act(() => router.navigate('/'));
    await act(() => router.navigate('/runs/run-12'));
    await ready();
    expect([lossCardLast(), screen.getByTestId('quality-overview').textContent]).toEqual(first);
  });

  it('switching from a loaded run to an unknown ID leaves nothing of the previous run', async () => {
    const { router } = renderRoute('/runs/run-12');
    await ready();
    await act(() => router.navigate('/runs/does-not-exist'));
    expect(heading()).toBe('Run not found');
    expect(screen.queryByRole('heading', { name: 'Data quality' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart-loss')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('a failed load after a successful run shows the error, not the previous run’s data', async () => {
    const c = createControlledRepository();
    const { router } = renderRoute('/runs/run-12', { repository: c.repository });
    await pending(c, 'run-12');
    await act(() => c.resolve('run-12'));
    await ready();
    await act(() => router.navigate('/runs/run-01'));
    await pending(c, 'run-01');
    act(() => {
      c.reject('run-01', new Error('disk unavailable'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('disk unavailable');
    expect(heading()).toBe('baseline-350m-lr3e-4');
    expect(screen.queryByRole('heading', { name: 'Data quality' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('metric-chart-loss')).not.toBeInTheDocument();
    expect(screen.getAllByText('No chart: the run data could not be loaded.')).toHaveLength(3);
  });
});

describe('summaries vs zoomed charts', () => {
  it('zooming changes the chart view, never the whole-run summaries or diagnostics', async () => {
    const { user } = renderRoute('/runs/run-12');
    await ready();
    const before = {
      last: lossCardLast(),
      overview: screen.getByTestId('quality-overview').textContent,
      invalid: screen.getByTestId('quality-invalid-values').textContent,
    };
    expect(await screen.findByRole('list', { name: 'Loss chart warnings' })).toHaveTextContent('600 invalid loss values');

    await user.type(screen.getByLabelText('From step'), '0');
    await user.type(screen.getByLabelText('To step'), '5000{Enter}');
    expect(screen.getByTestId('metric-chart-loss').dataset.xMax).toBe('5000');
    // The zoomed view has no NaN, so the chart warning goes away...
    expect(screen.queryByRole('list', { name: 'Loss chart warnings' })).not.toBeInTheDocument();
    // ...but the whole-run numbers, including the NaN ending, stay exactly as they were.
    expect({
      last: lossCardLast(),
      overview: screen.getByTestId('quality-overview').textContent,
      invalid: screen.getByTestId('quality-invalid-values').textContent,
    }).toEqual(before);
    expect(before.last).toBe('NaN');
    expect(screen.getByText(/Whole run:/)).toBeInTheDocument();
  });
});
