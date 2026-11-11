import type { ReactNode } from 'react';
import type {
  DataQualityDiagnostics,
  DataQualityIssue,
  DataQualitySeverity,
  DuplicateStepIssue,
} from '../../../types/training';
import { formatCount } from '../format';
import { METRIC_LABEL, SEVERITY_LABEL } from '../labels';
import { ValueText } from './ValueText';

/** At most this many individual entries are rendered per category; the rest are counted. */
export const MAX_LISTED_ISSUES = 10;

type IssueOf<K extends DataQualityIssue['kind']> = DataQualityIssue & { kind: K };

const SEVERITY_RANK: Readonly<Record<DataQualitySeverity, number>> = { error: 3, warning: 2, info: 1 };
const SEVERITY_STYLE: Readonly<Record<DataQualitySeverity | 'none', string>> = {
  error: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  info: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200',
  none: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

function worstSeverity(issues: readonly DataQualityIssue[]): DataQualitySeverity | null {
  let worst: DataQualitySeverity | null = null;
  for (const i of issues) if (!worst || SEVERITY_RANK[i.severity] > SEVERITY_RANK[worst]) worst = i.severity;
  return worst;
}

function SeverityLabel({ severity }: { severity: DataQualitySeverity | null }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLE[severity ?? 'none']}`}>
      {severity ? SEVERITY_LABEL[severity] : 'None'}
    </span>
  );
}

interface Category {
  key: string;
  title: string;
  description: string;
  count: number;
  /** Short breakdown shown next to the count. */
  breakdown?: string | undefined;
  issues: readonly DataQualityIssue[];
  renderItem: (issue: DataQualityIssue) => ReactNode;
}

function byKind<K extends DataQualityIssue['kind']>(issues: readonly DataQualityIssue[], ...kinds: K[]): IssueOf<K>[] {
  return issues.filter((i): i is IssueOf<K> => (kinds as string[]).includes(i.kind));
}

function step(n: number) {
  return <span className="font-mono tabular-nums">{formatCount(n)}</span>;
}

function DuplicateItem({ issue }: { issue: DuplicateStepIssue }) {
  if (issue.conflictingMetrics.length === 0) {
    return (
      <>
        Step {step(issue.step)}: {issue.records.length} identical records (source records {issue.sourceIndices.join(', ')}).
      </>
    );
  }
  return (
    <>
      <strong className="font-semibold">Conflict</strong> at step {step(issue.step)} in{' '}
      {issue.conflictingMetrics.map((m) => METRIC_LABEL[m].toLowerCase()).join(', ')}:
      <ul className="mt-1 ml-4 list-disc">
        {issue.records.map((record, k) => {
          const sourceIndex = issue.sourceIndices[k] ?? -1;
          return (
            <li key={sourceIndex}>
              Record {sourceIndex}
              {sourceIndex === issue.displayedSourceIndex ? ' (displayed, last recorded)' : ' (hidden)'}:{' '}
              {issue.conflictingMetrics.map((m, j) => (
                <span key={m}>
                  {j > 0 && ', '}
                  {m} = <ValueText value={record[m]} />
                </span>
              ))}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function buildCategories(d: DataQualityDiagnostics): Category[] {
  const { issues } = d;
  const nonFinite = byKind(issues, 'nan', 'positive_infinity', 'negative_infinity');
  const missingValues = byKind(issues, 'missing_value');
  const gaps = byKind(issues, 'missing_steps');
  // Conflicting duplicates first: they matter more than identical double-writes.
  const duplicates = byKind(issues, 'duplicate_step').sort(
    (a, b) => Number(b.conflictingMetrics.length > 0) - Number(a.conflictingMetrics.length > 0) || a.step - b.step,
  );
  const unsorted = byKind(issues, 'unsorted_step');
  const invalidSteps = byKind(issues, 'invalid_step');
  const offGrid = byKind(issues, 'off_grid_step');
  const kindText = { nan: 'NaN', positive_infinity: '+Infinity', negative_infinity: '-Infinity' } as const;

  const perMetric = (list: readonly (IssueOf<'nan' | 'positive_infinity' | 'negative_infinity'> | IssueOf<'missing_value'>)[]) =>
    (['loss', 'lr', 'grad_norm'] as const)
      .map((m) => [m, list.filter((i) => i.metric === m).length] as const)
      .filter(([, n]) => n > 0)
      .map(([m, n]) => `${METRIC_LABEL[m]}: ${formatCount(n)}`)
      .join(' · ');

  const categories: Category[] = [
    {
      key: 'invalid-values',
      title: 'Invalid numeric values',
      description: 'NaN, +Infinity or -Infinity recorded for a metric. Shown as gaps in the chart, never as 0.',
      count: nonFinite.length,
      breakdown: perMetric(nonFinite),
      issues: nonFinite,
      renderItem: (i) => {
        const issue = i as (typeof nonFinite)[number];
        return (
          <>
            {kindText[issue.kind]} {METRIC_LABEL[issue.metric].toLowerCase()} at step {step(issue.step)} (record {issue.sourceIndex})
          </>
        );
      },
    },
    {
      key: 'missing-values',
      title: 'Missing measurements',
      description: 'The step was logged, but this metric was not recorded (null).',
      count: missingValues.length,
      breakdown: perMetric(missingValues),
      issues: missingValues,
      renderItem: (i) => {
        const issue = i as IssueOf<'missing_value'>;
        return (
          <>
            {METRIC_LABEL[issue.metric]} not recorded at step {step(issue.step)} (record {issue.sourceIndex})
          </>
        );
      },
    },
    {
      key: 'missing-steps',
      title: 'Missing steps',
      description: 'Expected steps (from the declared sampling interval) with no record at all.',
      count: d.missingStepCount,
      breakdown: gaps.length > 0 ? `${formatCount(gaps.length)} range${gaps.length === 1 ? '' : 's'}` : undefined,
      issues: gaps,
      renderItem: (i) => {
        const issue = i as IssueOf<'missing_steps'>;
        return (
          <>
            Steps {step(issue.firstMissingStep)}–{step(issue.lastMissingStep)} ({formatCount(issue.missingCount)} missing, between {step(issue.afterStep)} and {step(issue.beforeStep)})
          </>
        );
      },
    },
    {
      key: 'duplicates',
      title: 'Duplicate steps',
      description: 'The same step was logged more than once. The chart shows the last recorded value; nothing is averaged.',
      count: d.duplicateStepCount,
      breakdown:
        d.duplicateStepCount > 0
          ? `${formatCount(d.conflictingDuplicateCount)} conflicting · ${formatCount(d.duplicateStepCount - d.conflictingDuplicateCount)} identical`
          : undefined,
      issues: duplicates,
      renderItem: (i) => <DuplicateItem issue={i as DuplicateStepIssue} />,
    },
    {
      key: 'unsorted',
      title: 'Out-of-order records',
      description: 'A record arrived with a lower step than the one before it. The display is sorted by step; the raw order is kept.',
      count: unsorted.length,
      issues: unsorted,
      renderItem: (i) => {
        const issue = i as IssueOf<'unsorted_step'>;
        return (
          <>
            Step {step(issue.step)} arrived after step {step(issue.previousStep)} (record {issue.sourceIndex})
          </>
        );
      },
    },
  ];
  if (invalidSteps.length > 0) {
    categories.push({
      key: 'invalid-steps',
      title: 'Invalid steps',
      description: 'Records whose step is not a non-negative integer. They cannot be placed on the chart.',
      count: invalidSteps.length,
      issues: invalidSteps,
      renderItem: (i) => {
        const issue = i as IssueOf<'invalid_step'>;
        return <>Record {issue.sourceIndex} has step {String(issue.rawStep)}</>;
      },
    });
  }
  if (offGrid.length > 0) {
    categories.push({
      key: 'off-grid',
      title: 'Off-grid steps',
      description: 'Steps that do not fall on the declared sampling grid.',
      count: offGrid.length,
      issues: offGrid,
      renderItem: (i) => {
        const issue = i as IssueOf<'off_grid_step'>;
        return <>Step {step(issue.step)} (record {issue.sourceIndex}) is not on the every-{formatCount(issue.interval)} grid</>;
      },
    });
  }
  return categories;
}

/** Grouped, count-first data quality report for one run (from Task 03 diagnostics). */
export function DataQualitySummary({ diagnostics }: { diagnostics: DataQualityDiagnostics }) {
  const { issues } = diagnostics;
  const tails = byKind(issues, 'non_finite_tail');
  const severityCounts = (['error', 'warning', 'info'] as const).map((s) => [s, issues.filter((i) => i.severity === s).length] as const);
  const categories = buildCategories(diagnostics);
  const sampling =
    diagnostics.sampling.kind === 'fixed'
      ? `one record every ${formatCount(diagnostics.sampling.interval)} step${diagnostics.sampling.interval === 1 ? '' : 's'}`
      : 'irregular (missing steps are not checked)';

  return (
    <section aria-labelledby="data-quality-heading" className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 id="data-quality-heading" className="text-lg font-semibold">
        Data quality
      </h2>

      <p className="mt-1 text-sm" data-testid="quality-overview">
        {issues.length === 0 ? (
          <span>
            <span aria-hidden="true">✓ </span>No data quality issues detected.
          </span>
        ) : (
          <>
            <strong>{formatCount(issues.length)} issue{issues.length === 1 ? '' : 's'} detected</strong>:{' '}
            {severityCounts.map(([s, n]) => `${formatCount(n)} ${SEVERITY_LABEL[s].toLowerCase()}${n === 1 || s === 'info' ? '' : 's'}`).join(', ')}.
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        {formatCount(diagnostics.totalRecords)} raw records, {formatCount(diagnostics.distinctSteps)} distinct steps. Declared sampling: {sampling}.
      </p>

      {tails.map((tail) => (
        <p key={tail.metric} className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <strong>Error:</strong> {METRIC_LABEL[tail.metric]} is invalid for the last {formatCount(tail.count)} step{tail.count === 1 ? '' : 's'} (from step {formatCount(tail.fromStep)} to the end of the run).
        </p>
      ))}

      <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {categories.map((c) => {
          const severity = worstSeverity(c.issues);
          const shown = c.issues.slice(0, MAX_LISTED_ISSUES);
          return (
            <li key={c.key} className="py-3" data-testid={`quality-${c.key}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{c.title}</h3>
                <div className="flex items-center gap-2 text-sm">
                  {c.count === 0 ? (
                    <span className="text-slate-600 dark:text-slate-400">None</span>
                  ) : (
                    <>
                      <span className="font-mono tabular-nums">{formatCount(c.count)}</span>
                      <SeverityLabel severity={severity} />
                    </>
                  )}
                </div>
              </div>
              {c.breakdown && <p className="mt-0.5 text-xs text-slate-700 dark:text-slate-300">{c.breakdown}</p>}
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{c.description}</p>
              {c.issues.length > 0 && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer rounded text-sky-800 underline-offset-2 hover:underline dark:text-sky-300">
                    Show details{c.issues.length > MAX_LISTED_ISSUES ? ` (first ${MAX_LISTED_ISSUES} of ${formatCount(c.issues.length)})` : ''}
                  </summary>
                  <ul className="mt-2 space-y-1 pl-1 text-slate-700 dark:text-slate-300">
                    {shown.map((issue, k) => (
                      <li key={k}>{c.renderItem(issue)}</li>
                    ))}
                  </ul>
                  {c.issues.length > MAX_LISTED_ISSUES && (
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                      {formatCount(c.issues.length - MAX_LISTED_ISSUES)} more not shown.
                    </p>
                  )}
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
