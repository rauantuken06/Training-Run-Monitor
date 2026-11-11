import type { ReactNode } from 'react';
import type { MetricKey, MetricSummary, ObservedValue } from '../../../types/training';
import { formatCount } from '../format';
import { METRIC_LABEL } from '../labels';
import { ValueText } from './ValueText';

function AtStep({ step }: { step: number }) {
  return <span className="text-xs text-slate-600 dark:text-slate-400"> at step {formatCount(step)}</span>;
}

function Observed({ observed }: { observed: ObservedValue | null }) {
  if (!observed) return <span className="text-slate-600 dark:text-slate-400">No finite values</span>;
  return (
    <>
      <ValueText value={observed.value} />
      <AtStep step={observed.step} />
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
      <dt className="text-sm text-slate-600 dark:text-slate-400">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Safe summary of one metric, straight from the Task 03 `MetricSummary`. */
export function MetricSummaryCard({ metric, summary }: { metric: MetricKey; summary: MetricSummary }) {
  const { counts, last } = summary;
  const headingId = `metric-${metric}-heading`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 id={headingId} className="font-semibold">
        {METRIC_LABEL[metric]} <span aria-hidden="true" className="font-mono text-xs font-normal text-slate-600 dark:text-slate-400">{metric}</span>
      </h3>

      {summary.endsNonFinite && last && (
        <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <strong>Warning:</strong> the last recorded value is <ValueText value={last.value} /> (step {formatCount(last.step)}). The run ends without a valid {METRIC_LABEL[metric].toLowerCase()} value.
        </p>
      )}

      <dl className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
        <Row label="Last recorded">
          {last ? (
            <>
              <ValueText value={last.value} />
              <AtStep step={last.step} />
            </>
          ) : (
            <span className="text-slate-600 dark:text-slate-400">No records</span>
          )}
        </Row>
        <Row label="Last finite">
          <Observed observed={summary.lastFinite} />
        </Row>
        <Row label="Minimum (finite)">
          <Observed observed={summary.min} />
        </Row>
        <Row label="Maximum (finite)">
          <Observed observed={summary.max} />
        </Row>
        <Row label="Finite measurements">
          <span className="font-mono tabular-nums">{formatCount(counts.finite)}</span>
        </Row>
        <Row label="Invalid (NaN / ±Infinity)">
          <span className={`font-mono tabular-nums ${summary.invalidCount > 0 ? 'font-semibold text-red-700 dark:text-red-300' : ''}`}>
            {formatCount(summary.invalidCount)}
          </span>
          {summary.invalidCount > 0 && (
            <span className="ml-1 text-xs text-slate-600 dark:text-slate-400">
              ({formatCount(counts.nan)} NaN, {formatCount(counts.positiveInfinity)} +Inf, {formatCount(counts.negativeInfinity)} -Inf)
            </span>
          )}
        </Row>
        <Row label="Missing (not recorded)">
          <span className={`font-mono tabular-nums ${counts.missing > 0 ? 'font-semibold text-amber-800 dark:text-amber-300' : ''}`}>
            {formatCount(counts.missing)}
          </span>
        </Row>
      </dl>
    </section>
  );
}
