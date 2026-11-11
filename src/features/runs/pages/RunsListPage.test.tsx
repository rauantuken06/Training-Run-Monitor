import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createControlledRepository } from '../../../test/controlledRepository';
import { renderRoute } from '../../../test/renderRoute';
import { RUN_DEFINITIONS } from '../../data/catalog/runCatalog';

/** IDs of the rows currently shown, in order (read from the rendered table). */
function shownIds(): string[] {
  const table = screen.queryByRole('table');
  if (!table) return [];
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getByText(/^run-\d{2}$/).textContent ?? '');
}
const status = () => screen.getByText(/^Showing \d+ of \d+ runs$/);

describe('RunsListPage', () => {
  it('shows all 20 runs from metadata, without loading any run points', () => {
    const controlled = createControlledRepository();
    const getRun = vi.spyOn(controlled.repository, 'getRun');
    renderRoute('/', { repository: controlled.repository });

    expect(shownIds()).toEqual(RUN_DEFINITIONS.map((d) => d.metadata.id));
    for (const d of RUN_DEFINITIONS) expect(screen.getByRole('link', { name: d.metadata.name })).toBeInTheDocument();
    expect(status()).toHaveTextContent('Showing 20 of 20 runs');
    expect(getRun).not.toHaveBeenCalled();
  });

  it('displays status as text, the type, declared anomalies and the exact point count', () => {
    renderRoute('/');
    const row = screen.getByRole('link', { name: 'large-1m-steps-loss-spike' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('Completed')).toBeInTheDocument();
    expect(within(row).getByText('1M points')).toBeInTheDocument();
    expect(within(row).getByText('Loss spike')).toBeInTheDocument();
    expect(within(row).getByText('None declared')).toBeInTheDocument();
    expect(within(row).getByText('1,000,000')).toBeInTheDocument();

    const corrupted = screen.getByRole('link', { name: 'corrupted-log-mixed-anomalies' }).closest('tr') as HTMLElement;
    const anomalies = within(corrupted).getByRole('list', { name: 'Declared anomalies' });
    expect(within(anomalies).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'NaN loss', 'Infinite loss', 'Missing values', 'Missing steps', 'Duplicate steps', 'Unsorted steps',
    ]);
    expect(within(corrupted).getByText('Failed')).toBeInTheDocument();
  });

  it('searches by name and by ID', async () => {
    const { user } = renderRoute('/');
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'plateau');
    expect(shownIds()).toEqual(['run-07', 'run-08']);
    expect(status()).toHaveTextContent('Showing 2 of 20 runs');

    await user.clear(screen.getByRole('searchbox', { name: 'Search' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'RUN-1');
    expect(shownIds()).toEqual(['run-10', 'run-11', 'run-12', 'run-13', 'run-14', 'run-15', 'run-16', 'run-17', 'run-18', 'run-19']);
  });

  it('sorts by point count, name and status', async () => {
    const { user } = renderRoute('/');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'points');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Order' }), 'desc');
    expect(shownIds().slice(0, 3)).toEqual(['run-20', 'run-03', 'run-15']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Order' }), 'asc');
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('link')[0]?.textContent ?? '');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'status');
    const statuses = screen.getAllByRole('row').slice(1).map((r) => within(r).getByText(/^(Completed|Failed|Running|Stopped)$/).textContent);
    expect([...new Set(statuses)]).toEqual(['Completed', 'Failed', 'Running', 'Stopped']);
  });

  it('sorts from column headers with the keyboard and exposes aria-sort', async () => {
    const { user } = renderRoute('/');
    const pointsHeader = screen.getByRole('columnheader', { name: /Points/ });
    expect(pointsHeader).toHaveAttribute('aria-sort', 'none');

    within(pointsHeader).getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('columnheader', { name: /Points/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(shownIds()[0]).toBe('run-04');

    await user.keyboard(' ');
    expect(screen.getByRole('columnheader', { name: /Points/ })).toHaveAttribute('aria-sort', 'descending');
    expect(shownIds()[0]).toBe('run-20');
  });

  it('filters by status, by data quality, and by both with search', async () => {
    const { user } = renderRoute('/');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'failed');
    expect(shownIds()).toEqual(['run-09', 'run-12', 'run-14', 'run-19']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Data quality' }), 'nan_loss');
    expect(shownIds()).toEqual(['run-12', 'run-19']);

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'fp16');
    expect(shownIds()).toEqual(['run-12']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'all');
    await user.clear(screen.getByRole('searchbox', { name: 'Search' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Data quality' }), 'clean');
    expect(shownIds()).toHaveLength(11);
  });

  it('shows an empty state and clears all filters', async () => {
    const { user } = renderRoute('/');
    const clearButtons = () => screen.getAllByRole('button', { name: 'Clear filters' });
    expect(clearButtons()[0]).toBeDisabled();

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzz');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No runs match your filters' })).toBeInTheDocument();
    expect(status()).toHaveTextContent('Showing 0 of 20 runs');

    await user.click(clearButtons()[1] as HTMLElement);
    expect(shownIds()).toHaveLength(20);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
  });

  it('keeps filters in the URL and restores them via the back link', async () => {
    const { user, router } = renderRoute('/');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'failed');
    expect(router.state.location.search).toBe('?status=failed');

    await user.click(screen.getByRole('link', { name: 'nan-loss-fp16-overflow' }));
    expect(router.state.location.pathname).toBe('/runs/run-12');
    await user.click(screen.getByRole('link', { name: /All runs/ }));
    expect(router.state.location.search).toBe('?status=failed');
    expect(shownIds()).toEqual(['run-09', 'run-12', 'run-14', 'run-19']);
  });

  it('is keyboard operable: tab order through the filters, Enter on a run link', async () => {
    const { user, router } = renderRoute('/');
    screen.getByRole('searchbox', { name: 'Search' }).focus();
    await user.keyboard('nan-loss-iso');
    for (const name of ['Status', 'Data quality', 'Sort by', 'Order']) {
      await user.tab();
      expect(screen.getByRole('combobox', { name })).toHaveFocus();
    }
    expect(shownIds()).toEqual(['run-11']);

    screen.getByRole('link', { name: 'nan-loss-isolated' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/runs/run-11');
    });
  });

  it('shows an empty state when the repository has no runs', () => {
    const controlled = createControlledRepository();
    renderRoute('/', { repository: { ...controlled.repository, listRuns: () => [] } });
    expect(screen.getByText('No training runs are available.')).toBeInTheDocument();
  });
});
