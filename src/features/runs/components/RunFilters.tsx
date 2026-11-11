import type { ReactNode } from 'react';
import { SCENARIO_LABEL, STATUS_LABEL } from '../labels';
import {
  hasActiveFilters,
  QUALITY_FILTERS,
  SORT_KEYS,
  STATUS_FILTERS,
  type QualityFilter,
  type RunListQuery,
  type SortKey,
} from '../runListQuery';

const SORT_LABEL: Readonly<Record<SortKey, string>> = {
  id: 'Run ID',
  name: 'Name',
  status: 'Status',
  points: 'Point count',
};

function qualityLabel(q: QualityFilter): string {
  if (q === 'all') return 'All runs';
  if (q === 'clean') return 'No declared anomalies';
  if (q === 'any') return 'Any declared anomaly';
  return SCENARIO_LABEL[q];
}

const controlClass =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {children}
    </div>
  );
}

export function RunFilters({
  query,
  onChange,
  onClear,
}: {
  query: RunListQuery;
  onChange: (patch: Partial<RunListQuery>) => void;
  onClear: () => void;
}) {
  return (
    <form
      role="search"
      aria-label="Filter and sort runs"
      className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.4fr_1fr_1fr_auto] lg:items-end dark:border-slate-800 dark:bg-slate-900"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <Field id="run-search" label="Search">
        <input
          id="run-search"
          type="search"
          placeholder="Run name or ID"
          value={query.search}
          onChange={(e) => {
            onChange({ search: e.target.value });
          }}
          className={controlClass}
        />
      </Field>
      <Field id="run-status" label="Status">
        <select
          id="run-status"
          value={query.status}
          onChange={(e) => {
            onChange({ status: e.target.value as RunListQuery['status'] });
          }}
          className={controlClass}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="run-quality" label="Data quality">
        <select
          id="run-quality"
          value={query.quality}
          onChange={(e) => {
            onChange({ quality: e.target.value as QualityFilter });
          }}
          className={controlClass}
        >
          {QUALITY_FILTERS.map((q) => (
            <option key={q} value={q}>
              {qualityLabel(q)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="run-sort" label="Sort by">
        <select
          id="run-sort"
          value={query.sort}
          onChange={(e) => {
            onChange({ sort: e.target.value as SortKey });
          }}
          className={controlClass}
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="run-direction" label="Order">
        <select
          id="run-direction"
          value={query.direction}
          onChange={(e) => {
            onChange({ direction: e.target.value as RunListQuery['direction'] });
          }}
          className={controlClass}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </Field>
      <button
        type="button"
        onClick={onClear}
        disabled={!hasActiveFilters(query)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
      >
        Clear filters
      </button>
    </form>
  );
}
