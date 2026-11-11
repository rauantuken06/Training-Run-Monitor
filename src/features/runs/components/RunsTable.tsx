import { Link, useLocation } from 'react-router';
import { paths } from '../../../app/paths';
import type { TrainingRunMetadata } from '../../../types/training';
import { formatCount, formatDate } from '../format';
import { SCENARIO_LABEL } from '../labels';
import { ANOMALY_SCENARIOS, declaredAnomalies, type RunListQuery, type SortKey } from '../runListQuery';
import { RunStatusBadge } from './RunStatusBadge';

const BEHAVIOUR_SCENARIOS = (s: string) => !(ANOMALY_SCENARIOS as readonly string[]).includes(s);

function Tag({ children, tone }: { children: string; tone: 'neutral' | 'warning' }) {
  const style =
    tone === 'warning'
      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
      : 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
  return <li className={`rounded border px-1.5 py-0.5 text-xs whitespace-nowrap ${style}`}>{children}</li>;
}

function SortHeader({
  label,
  sortKey,
  query,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  query: RunListQuery;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = query.sort === sortKey;
  const ariaSort = active ? (query.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" aria-sort={ariaSort} className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => {
          onSort(sortKey);
        }}
        className="inline-flex items-center gap-1 rounded hover:underline"
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          {active ? (query.direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
        <span className="sr-only">
          {active ? `, sorted ${ariaSort}. Activate to reverse.` : ', activate to sort.'}
        </span>
      </button>
    </th>
  );
}

export function RunsTable({
  runs,
  query,
  onSort,
}: {
  runs: readonly TrainingRunMetadata[];
  query: RunListQuery;
  onSort: (key: SortKey) => void;
}) {
  const location = useLocation();
  return (
    <div
      role="region"
      aria-labelledby="runs-table-caption"
      tabIndex={0}
      // `relative`: the containing block for the sr-only (absolutely positioned) sort hints,
      // so the scroll region clips them instead of widening the page on small screens.
      className="relative overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <caption id="runs-table-caption" className="sr-only">
          Training runs. Data quality shows the anomalies declared in run metadata; detected issues are shown on each run's page.
        </caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
          <tr>
            <SortHeader label="Run" sortKey="name" query={query} onSort={onSort} />
            <SortHeader label="Status" sortKey="status" query={query} onSort={onSort} />
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Type
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Declared data quality
            </th>
            <SortHeader label="Points" sortKey="points" query={query} onSort={onSort} align="right" />
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Created (UTC)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {runs.map((run) => {
            const anomalies = declaredAnomalies(run);
            return (
              <tr key={run.id} className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <th scope="row" className="px-3 py-2.5 text-left font-normal">
                  <Link
                    to={paths.runDetails(run.id)}
                    state={{ listSearch: location.search }}
                    className="rounded font-medium text-sky-800 underline-offset-2 hover:underline dark:text-sky-300"
                  >
                    {run.name}
                  </Link>
                  <div className="font-mono text-xs text-slate-600 dark:text-slate-400">{run.id}</div>
                </th>
                <td className="px-3 py-2.5">
                  <RunStatusBadge status={run.status} />
                </td>
                <td className="px-3 py-2.5">
                  <ul className="flex flex-wrap gap-1" aria-label="Type">
                    {run.scenarios.filter(BEHAVIOUR_SCENARIOS).map((s) => (
                      <Tag key={s} tone="neutral">
                        {SCENARIO_LABEL[s]}
                      </Tag>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-2.5">
                  {anomalies.length === 0 ? (
                    <span className="text-slate-600 dark:text-slate-400">None declared</span>
                  ) : (
                    <ul className="flex flex-wrap gap-1" aria-label="Declared anomalies">
                      {anomalies.map((s) => (
                        <Tag key={s} tone="warning">
                          {SCENARIO_LABEL[s]}
                        </Tag>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatCount(run.pointCount)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-300">
                  <time dateTime={run.createdAt} title={run.createdAt}>
                    {formatDate(run.createdAt)}
                  </time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
