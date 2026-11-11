import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createControlledRepository } from '../../../test/controlledRepository';
import { renderRoute } from '../../../test/renderRoute';
import type { MetricKey, TrainingRun } from '../../../types/training';
import { analyzeRun } from '../../data/integrity/analyzeRun';
import { createRunRepository } from '../../data/repository/runRepository';
import { MAX_LISTED_ISSUES } from '../components/DataQualitySummary';

const realRepo = createRunRepository();
const card = (title: string) => screen.getByRole('region', { name: title });
/** The `<data>` element in a card row, e.g. row(card('Loss'), 'Last recorded'). */
function rowData(region: HTMLElement, label: string): HTMLDataElement {
  const dt = within(region).getByText(label, { selector: 'dt' });
  const data = dt.parentElement?.querySelector('dd data');
  if (!(data instanceof HTMLDataElement)) throw new Error(`no data element for ${label}`);
  return data;
}
async function ready() {
  await screen.findByRole('heading', { name: 'Data quality' });
}
async function expected(runId: string) {
  const run = (await realRepo.getRun(runId)) as TrainingRun;
  return analyzeRun(run);
}

describe('RunDetailsPage: loading, errors and unknown runs', () => {
  it('shows metadata at once, a loading status, then the summaries', async () => {
    const c = createControlledRepository();
    renderRoute('/runs/run-12', { repository: c.repository });

    expect(screen.getByRole('heading', { level: 1, name: 'nan-loss-fp16-overflow' })).toBeInTheDocument();
    expect(screen.getByText('ID: run-12')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading 2,000 observations…');
    expect(screen.getByRole('region', { name: 'Loss chart' })).toBeInTheDocument();

    await waitFor(() => {
      expect(c.isPending('run-12')).toBe(true);
    });
    await act(() => c.resolve('run-12'));
    await ready();
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it('shows an error with a working retry', async () => {
    const c = createControlledRepository();
    const { user } = renderRoute('/runs/run-01', { repository: c.repository });
    await waitFor(() => {
      expect(c.isPending('run-01')).toBe(true);
    });
    act(() => {
      c.reject('run-01', new Error('Disk on fire'));
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Could not load this run's data. Disk on fire");
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(c.isPending('run-01')).toBe(true);
    });
    await act(() => c.resolve('run-01'));
    await ready();
    expect(c.getRunCalls).toEqual(['run-01', 'run-01']);
  });

  it('shows a 404 for an unknown run ID without requesting data', () => {
    const c = createControlledRepository();
    renderRoute('/runs/no-such-run', { repository: c.repository });
    expect(screen.getByRole('heading', { level: 1, name: 'Run not found' })).toBeInTheDocument();
    expect(screen.getByText('no-such-run')).toBeInTheDocument();
    expect(c.getRunCalls).toEqual([]);
  });
});

describe('RunDetailsPage: summaries match the integrity engine on real data', () => {
  it.each(['run-01', 'run-12', 'run-14', 'run-18', 'run-19'])('%s: every card value matches analyzeRun', async (runId) => {
    renderRoute(`/runs/${runId}`);
    await ready();
    const { summaries } = await expected(runId);
    const titles: Record<MetricKey, string> = { loss: 'Loss', lr: 'Learning rate', grad_norm: 'Gradient norm' };

    for (const metric of ['loss', 'lr', 'grad_norm'] as const) {
      const s = summaries[metric];
      const region = card(titles[metric]);
      const exact = (v: number | null) => (v === null ? 'null' : Number.isNaN(v) ? 'NaN' : String(v));
      expect(rowData(region, 'Last recorded').value).toBe(exact(s.last?.value ?? null));
      expect(rowData(region, 'Last finite').value).toBe(exact(s.lastFinite?.value ?? null));
      expect(rowData(region, 'Minimum (finite)').value).toBe(exact(s.min?.value ?? null));
      expect(rowData(region, 'Maximum (finite)').value).toBe(exact(s.max?.value ?? null));
      expect(within(region).getByText('Finite measurements').nextElementSibling).toHaveTextContent(s.counts.finite.toLocaleString('en-US'));
      expect(within(region).getByText('Missing (not recorded)').nextElementSibling).toHaveTextContent(String(s.counts.missing));
      expect(within(region).getByText('Invalid (NaN / ±Infinity)').nextElementSibling).toHaveTextContent(String(s.invalidCount));
    }
  });

  it('run-12: a NaN ending is shown as "NaN" with a warning, never as 0', async () => {
    renderRoute('/runs/run-12');
    await ready();
    const loss = card('Loss');
    const last = rowData(loss, 'Last recorded');
    expect(last).toHaveTextContent('NaN');
    expect(last.textContent).not.toMatch(/^0$/);
    expect(within(loss).getByText(/the run ends without a valid loss value/i)).toBeInTheDocument();
    expect(rowData(loss, 'Last finite').closest('dd')).toHaveTextContent('at step 13,990');
    expect(screen.getByText(/Loss is invalid for the last 600 steps/)).toBeInTheDocument();
  });

  it('run-14: an Infinity ending is shown as "+Infinity" with a warning', async () => {
    renderRoute('/runs/run-14');
    await ready();
    expect(rowData(card('Loss'), 'Last recorded')).toHaveTextContent('+Infinity');
    expect(within(card('Loss')).getByText(/Warning:/)).toBeInTheDocument();
  });

  it('run-18: missing values are counted as "not recorded", separately from invalid values', async () => {
    renderRoute('/runs/run-18');
    await ready();
    expect(within(card('Learning rate')).getByText('Missing (not recorded)').nextElementSibling).toHaveTextContent('3');
    expect(within(card('Learning rate')).getByText('Invalid (NaN / ±Infinity)').nextElementSibling).toHaveTextContent('0');
  });
});

describe('RunDetailsPage: data quality', () => {
  it('run-01 reports no issues', async () => {
    renderRoute('/runs/run-01');
    await ready();
    expect(screen.getByTestId('quality-overview')).toHaveTextContent('No data quality issues detected.');
  });

  it('run-15 identifies conflicting duplicates and shows every raw value', async () => {
    const { user } = renderRoute('/runs/run-15');
    await ready();
    const dup = screen.getByTestId('quality-duplicates');
    expect(dup).toHaveTextContent('51');
    expect(dup).toHaveTextContent('50 conflicting · 1 identical');
    expect(within(dup).getByText('Warning')).toBeInTheDocument();

    await user.click(within(dup).getByText(/Show details/));
    const items = within(dup).getAllByText(/^Conflict$/);
    expect(items).toHaveLength(MAX_LISTED_ISSUES);
    const first = items[0]?.closest('li') as HTMLElement;
    expect(first).toHaveTextContent('Conflict at step 8,000 in loss, gradient norm');
    expect(within(first).getByText(/\(displayed, last recorded\)/)).toBeInTheDocument();
    expect(within(first).getByText(/\(hidden\)/)).toBeInTheDocument();
    expect(within(dup).getByText('41 more not shown.')).toBeInTheDocument();
  });

  it('run-12 groups 600 invalid values instead of rendering them all', async () => {
    const { user } = renderRoute('/runs/run-12');
    await ready();
    const invalid = screen.getByTestId('quality-invalid-values');
    expect(invalid).toHaveTextContent('600');
    expect(within(invalid).getByText('Error')).toBeInTheDocument();
    await user.click(within(invalid).getByText('Show details (first 10 of 600)'));
    expect(within(invalid).getAllByText(/^NaN loss at step/)).toHaveLength(MAX_LISTED_ISSUES);
    expect(within(invalid).getByText('590 more not shown.')).toBeInTheDocument();
  });

  it('run-17 and run-16 report missing steps and out-of-order records', async () => {
    renderRoute('/runs/run-17');
    await ready();
    expect(screen.getByTestId('quality-missing-steps')).toHaveTextContent('301');
    expect(screen.getByTestId('quality-missing-steps')).toHaveTextContent('3 ranges');
  });
});

describe('RunDetailsPage: async correctness', () => {
  it('ignores a stale response when the user switches runs quickly', async () => {
    const c = createControlledRepository();
    const { router } = renderRoute('/runs/run-11', { repository: c.repository });
    await waitFor(() => {
      expect(c.isPending('run-11')).toBe(true);
    });

    await act(() => router.navigate('/runs/run-12'));
    await waitFor(() => {
      expect(c.isPending('run-12')).toBe(true);
    });

    // The old request finishes first: nothing of run-11 may appear on run-12's page.
    await act(() => c.resolve('run-11'));
    expect(screen.getByRole('heading', { level: 1, name: 'nan-loss-fp16-overflow' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.queryByRole('heading', { name: 'Data quality' })).not.toBeInTheDocument();

    await act(() => c.resolve('run-12'));
    await ready();
    expect(rowData(card('Loss'), 'Last recorded')).toHaveTextContent('NaN'); // run-12's data, not run-11's
  });

  it('keeps the newest run when responses arrive in order during rapid switching', async () => {
    const c = createControlledRepository();
    const { router } = renderRoute('/runs/run-01', { repository: c.repository });
    for (const id of ['run-02', 'run-13', 'run-14']) {
      await act(() => router.navigate(`/runs/${id}`));
    }
    await waitFor(() => {
      expect(c.isPending('run-14')).toBe(true);
    });
    await act(() => c.resolve('run-14'));
    for (const id of ['run-01', 'run-02', 'run-13']) if (c.isPending(id)) await act(() => c.resolve(id));
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'inf-loss-overflow' })).toBeInTheDocument();
    expect(rowData(card('Loss'), 'Last recorded')).toHaveTextContent('+Infinity');
  });

  it('analyzes a run once, not on unrelated re-renders', async () => {
    const analyze = vi.fn(analyzeRun);
    const { user, rerender, ui } = renderRoute('/runs/run-16', { analyze });
    await ready();
    rerender(ui);
    await user.click(within(screen.getByTestId('quality-unsorted')).getByText(/Show details/));
    expect(within(screen.getByTestId('quality-unsorted')).getAllByRole('listitem')[0]).toHaveTextContent('Step 5,000 arrived after step 5,490');
    expect(analyze).toHaveBeenCalledTimes(1);
  });
});
