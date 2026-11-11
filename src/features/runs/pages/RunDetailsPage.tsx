import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { paths } from '../../../app/paths';
import type { MetricKey, TrainingRunMetadata } from '../../../types/training';
import { ChartPlaceholder } from '../components/ChartPlaceholder';
import { DataQualitySummary } from '../components/DataQualitySummary';
import { MetricSummaryCard } from '../components/MetricSummaryCard';
import { RunStatusBadge } from '../components/RunStatusBadge';
import { useRunData } from '../data/runDataContext';
import { formatCount, formatDate } from '../format';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRunAnalysis } from '../hooks/useRunAnalysis';
import { METRIC_LABEL, SCENARIO_LABEL } from '../labels';

const METRICS: readonly MetricKey[] = ['loss', 'lr', 'grad_norm'];
const linkClass = 'rounded font-medium text-sky-800 underline-offset-2 hover:underline dark:text-sky-300';

/** Back to the list, restoring the filters the user came from (if any). */
function BackLink() {
  const state: unknown = useLocation().state;
  const listSearch =
    typeof state === 'object' && state !== null && 'listSearch' in state && typeof state.listSearch === 'string' && state.listSearch.startsWith('?')
      ? state.listSearch
      : '';
  return (
    <nav aria-label="Breadcrumb">
      <Link to={`${paths.runs}${listSearch}`} className={`text-sm ${linkClass}`}>
        ← All runs
      </Link>
    </nav>
  );
}

export function RunDetailsPage() {
  const { runId = '' } = useParams<{ runId: string }>();
  const { repository } = useRunData();
  const metadata = repository.getRunMetadata(runId);
  if (!metadata) return <RunNotFound runId={runId} />;
  // `key` gives each run fresh component state; useRunAnalysis also guards against stale responses.
  return <RunDetails key={metadata.id} metadata={metadata} />;
}

function RunNotFound({ runId }: { runId: string }) {
  useDocumentTitle('Run not found');
  return (
    <div className="space-y-4">
      <BackLink />
      <h1 className="text-2xl font-semibold">Run not found</h1>
      <p className="text-slate-700 break-all dark:text-slate-300">
        There is no training run with ID <code className="font-mono">{runId}</code>.
      </p>
      <Link to={paths.runs} className={linkClass}>
        Browse all training runs
      </Link>
    </div>
  );
}

/**
 * Charts (and ECharts) are a separate chunk, so the runs list never downloads them.
 * Measured in Task 08: the single bundle was 950 kB, about 580 kB of it chart code.
 */
const loadRunCharts = () => import('../../charts/components/RunCharts');
const RunCharts = lazy(() => loadRunCharts().then((m) => ({ default: m.RunCharts })));

function RunDetails({ metadata }: { metadata: TrainingRunMetadata }) {
  useDocumentTitle(metadata.name);
  // Start downloading the chart chunk now, in parallel with loading the run data.
  useEffect(() => {
    void loadRunCharts().catch(() => undefined); // a failure is shown by ChartLoadBoundary when rendering
  }, []);
  const { state, retry } = useRunAnalysis(metadata.id);
  const configEntries = Object.entries(metadata.config);

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">{metadata.name}</h1>
          <RunStatusBadge status={metadata.status} />
        </div>
        <p className="font-mono text-sm text-slate-600 dark:text-slate-400">ID: {metadata.id}</p>
        <p className="max-w-3xl text-slate-700 dark:text-slate-300">{metadata.description}</p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 pt-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-slate-600 dark:text-slate-400">Total observations</dt>
            <dd className="font-mono tabular-nums">{formatCount(metadata.pointCount)}</dd>
          </div>
          <div>
            <dt className="text-slate-600 dark:text-slate-400">Created (UTC)</dt>
            <dd>
              <time dateTime={metadata.createdAt} title={metadata.createdAt}>
                {formatDate(metadata.createdAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="text-slate-600 dark:text-slate-400">Declared scenarios</dt>
            <dd>{metadata.scenarios.map((s) => SCENARIO_LABEL[s]).join(', ')}</dd>
          </div>
          <div>
            <dt className="text-slate-600 dark:text-slate-400">Configuration</dt>
            <dd className="font-mono text-xs break-words">
              {configEntries.map(([k, v]) => `${k}=${String(v)}`).join(' · ')}
            </dd>
          </div>
        </dl>
      </div>

      <section aria-labelledby="summary-heading" className="space-y-3">
        <h2 id="summary-heading" className="text-lg font-semibold">
          Metric summaries
        </h2>
        {state.status === 'loading' && (
          <div role="status" className="rounded-lg border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
            Loading {formatCount(metadata.pointCount)} observations…
            {metadata.pointCount >= 100_000 && (
              <span className="block text-slate-600 dark:text-slate-400">
                Large run: generating and checking the data takes a moment, and the page may be briefly unresponsive.
              </span>
            )}
          </div>
        )}
        {(state.status === 'error' || state.status === 'not_found') && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <p>
              <strong>Could not load this run's data.</strong>{' '}
              {state.status === 'error' && state.error instanceof Error ? state.error.message : 'The run data is unavailable.'}
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-2 rounded-md border border-red-400 bg-white px-3 py-1.5 font-medium text-red-800 hover:bg-red-100 dark:border-red-700 dark:bg-red-900 dark:text-red-100"
            >
              Retry
            </button>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              <strong>Whole run:</strong> these values do not change when you zoom the charts.{' '}
              {formatCount(state.analysis.diagnostics.totalRecords)} raw records across{' '}
              {formatCount(state.analysis.diagnostics.distinctSteps)} distinct steps. Minimum and maximum include every raw
              record, including hidden duplicate copies; last values follow the displayed (sorted, deduplicated) series.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {METRICS.map((m) => (
                <MetricSummaryCard key={m} metric={m} summary={state.analysis.summaries[m]} />
              ))}
            </div>
          </>
        )}
      </section>

      {state.status === 'ready' && <DataQualitySummary diagnostics={state.analysis.diagnostics} />}

      {state.status === 'ready' ? (
        <ChartLoadBoundary>
          <Suspense fallback={<ChartsPlaceholder message="Loading the chart component…" />}>
            <RunCharts key={state.runId} view={state.analysis.view} />
          </Suspense>
        </ChartLoadBoundary>
      ) : (
        <ChartsPlaceholder
          message={state.status === 'loading' ? 'Chart appears once the run data has loaded.' : 'No chart: the run data could not be loaded.'}
        />
      )}
    </div>
  );
}

function ChartsPlaceholder({ message }: { message: string }) {
  return (
    <section aria-labelledby="charts-heading" className="space-y-3">
      <h2 id="charts-heading" className="text-lg font-semibold">
        Charts
      </h2>
      <div className="grid grid-cols-1 gap-4">
        {METRICS.map((m) => (
          <ChartPlaceholder key={m} id={`chart-${m}`} title={METRIC_LABEL[m]} message={message} />
        ))}
      </div>
    </section>
  );
}

/** Shows a visible error instead of breaking the page if the chart code cannot be downloaded. */
class ChartLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section aria-labelledby="charts-heading" className="space-y-3">
        <h2 id="charts-heading" className="text-lg font-semibold">
          Charts
        </h2>
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          The chart component could not be loaded (network error). Reload the page to try again. The summaries above are complete.
        </p>
      </section>
    );
  }
}
