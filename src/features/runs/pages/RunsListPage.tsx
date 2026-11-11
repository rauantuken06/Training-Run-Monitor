import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { RunFilters } from '../components/RunFilters';
import { RunsTable } from '../components/RunsTable';
import { useRunData } from '../data/runDataContext';
import { formatCount } from '../format';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  applyQuery,
  DEFAULT_QUERY,
  parseQuery,
  queryToParams,
  type RunListQuery,
  type SortKey,
} from '../runListQuery';

/**
 * Runs dashboard. Uses metadata only (`listRuns`): no run's points are loaded
 * or analyzed here. Search, filters and sort live in the URL.
 */
export function RunsListPage() {
  useDocumentTitle('Runs');
  const { repository } = useRunData();
  const runs = useMemo(() => repository.listRuns(), [repository]);
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseQuery(params), [params]);
  const visible = useMemo(() => applyQuery(runs, query), [runs, query]);

  const update = (patch: Partial<RunListQuery>) => {
    setParams(queryToParams({ ...query, ...patch }), { replace: true });
  };
  const clearFilters = () => {
    update({ search: DEFAULT_QUERY.search, status: DEFAULT_QUERY.status, quality: DEFAULT_QUERY.quality });
  };
  const sortBy = (key: SortKey) => {
    update(
      query.sort === key
        ? { direction: query.direction === 'asc' ? 'desc' : 'asc' }
        : { sort: key, direction: 'asc' },
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Training runs</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Run metadata only. Metrics and detected data quality are computed when you open a run.
        </p>
      </div>

      <RunFilters query={query} onChange={update} onClear={clearFilters} />

      <p role="status" aria-live="polite" className="text-sm text-slate-700 dark:text-slate-300">
        Showing {formatCount(visible.length)} of {formatCount(runs.length)} runs
      </p>

      {runs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-600 dark:border-slate-700 dark:text-slate-400">
          No training runs are available.
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
          <h2 className="font-medium">No runs match your filters</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Try a different search term, or clear the filters.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <RunsTable runs={visible} query={query} onSort={sortBy} />
      )}
    </div>
  );
}
