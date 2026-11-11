import { useMemo, useState } from 'react';
import type { MetricKey } from '../../../types/training';
import type { Viewport } from '../../data/downsampling/downsample';
import type { ChartView } from '../../data/integrity/analyzeRun';
import { clampViewport, dataExtent, fullViewport } from '../model/viewport';
import { ChartControls } from './ChartControls';
import { TrainingMetricChart } from './TrainingMetricChart';

const METRICS: readonly MetricKey[] = ['loss', 'lr', 'grad_norm'];

/**
 * The three metric charts of one run, sharing one step viewport, so zooming
 * any chart (or using the controls) zooms all three. Mount with `key={runId}`
 * so a different run starts at its full range.
 */
export function RunCharts({ view }: { view: ChartView }) {
  const extent = useMemo(() => dataExtent(view), [view]);
  const [viewport, setViewport] = useState<Viewport | null>(() => (extent ? fullViewport(extent) : null));

  return (
    <section aria-labelledby="charts-heading" className="space-y-3">
      <h2 id="charts-heading" className="text-lg font-semibold">
        Charts
      </h2>
      {!extent || !viewport ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          This run has no records with a valid step, so there is nothing to chart.
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Linear scales; x is the training step. Drag across a chart to zoom into a step range, or use the controls below.
            Long ranges are downsampled for drawing, but each chart's minimum and maximum are always kept exactly.
          </p>
          <ChartControls
            viewport={viewport}
            extent={extent}
            onChange={(vp) => {
              setViewport(clampViewport(vp, extent));
            }}
          />
          <div className="grid grid-cols-1 gap-4">
            {METRICS.map((metric) => (
              <TrainingMetricChart
                key={metric}
                view={view}
                metric={metric}
                viewport={viewport}
                onViewportChange={(vp) => {
                  setViewport(clampViewport(vp, extent));
                }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
