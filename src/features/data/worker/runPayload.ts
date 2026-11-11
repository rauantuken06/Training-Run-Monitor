import type { DataQualityIssue, DuplicateStepIssue, TrainingPoint, TrainingRun, TrainingRunMetadata } from '../../../types/training';
import type { ChartView, RunIntegrity } from '../integrity/analyzeRun';

/**
 * Worker → main-thread transfer format for one run.
 *
 * Measured in Chrome at 4x CPU throttling (Task 08): structured-cloning 1M point
 * objects blocks the main thread for ~1.8 s, while transferring typed-array columns
 * costs almost nothing and rebuilding the objects ~0.1–0.15 s. So points travel as
 * columns, and the analysis travels without its `points` reference.
 *
 * Lossless: Float64Array keeps NaN, ±Infinity and -0 bit-exact. `null` (not
 * recorded) has no Float64 encoding, so a mask byte marks it, and the slot holds NaN
 * only as filler. Decoding reads the mask first, so null and NaN stay distinct.
 */

const MISSING_LOSS = 1;
const MISSING_LR = 2;
const MISSING_GRAD_NORM = 4;

export interface PointColumns {
  readonly step: Float64Array;
  readonly loss: Float64Array;
  readonly lr: Float64Array;
  readonly grad_norm: Float64Array;
  /** Bit flags per point: 1 = loss is null, 2 = lr is null, 4 = grad_norm is null. */
  readonly missing: Uint8Array;
}

export type TransferredAnalysis = Omit<RunIntegrity, 'view'> & { readonly view: Omit<ChartView, 'points'> };

export interface RunPayload {
  readonly runId: string;
  readonly columns: PointColumns;
  readonly analysis: TransferredAnalysis;
}

export interface LoadedRun {
  readonly run: TrainingRun;
  readonly analysis: RunIntegrity;
}

export function encodeRunPayload(
  runId: string,
  points: readonly TrainingPoint[],
  analysis: RunIntegrity,
): { payload: RunPayload; transfer: ArrayBuffer[] } {
  const n = points.length;
  const columns = {
    step: new Float64Array(n),
    loss: new Float64Array(n),
    lr: new Float64Array(n),
    grad_norm: new Float64Array(n),
    missing: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const p = points[i] as TrainingPoint;
    let missing = 0;
    columns.step[i] = p.step;
    if (p.loss === null) {
      missing |= MISSING_LOSS;
      columns.loss[i] = Number.NaN;
    } else columns.loss[i] = p.loss;
    if (p.lr === null) {
      missing |= MISSING_LR;
      columns.lr[i] = Number.NaN;
    } else columns.lr[i] = p.lr;
    if (p.grad_norm === null) {
      missing |= MISSING_GRAD_NORM;
      columns.grad_norm[i] = Number.NaN;
    } else columns.grad_norm[i] = p.grad_norm;
    columns.missing[i] = missing;
  }
  // The analysis is sent without the points array (that would be cloned object by object).
  const { runId: viewRunId, sampling, displayIndex, gaps, duplicates, metrics } = analysis.view;
  const view: Omit<ChartView, 'points'> = { runId: viewRunId, sampling, displayIndex, gaps, duplicates, metrics };
  const payload: RunPayload = { runId, columns, analysis: { ...analysis, view } };
  const transfer = [columns.step, columns.loss, columns.lr, columns.grad_norm, columns.missing, view.displayIndex].map(
    (a) => a.buffer,
  );
  return { payload, transfer };
}

/**
 * Rebuild the points and re-attach them to the analysis. Duplicate-step issues are
 * re-linked to the rebuilt point objects (by source index), so the result has the
 * same object identities a main-thread `analyzeRun` would produce.
 */
export function decodeRunPayload(payload: RunPayload, metadata: TrainingRunMetadata): LoadedRun {
  const { step, loss, lr, grad_norm, missing } = payload.columns;
  const n = step.length;
  const points: TrainingPoint[] = new Array<TrainingPoint>(n);
  for (let i = 0; i < n; i++) {
    const m = missing[i] as number;
    points[i] = {
      step: step[i] as number,
      loss: m & MISSING_LOSS ? null : (loss[i] as number),
      lr: m & MISSING_LR ? null : (lr[i] as number),
      grad_norm: m & MISSING_GRAD_NORM ? null : (grad_norm[i] as number),
    };
  }

  const relinked = new Map<DuplicateStepIssue, DuplicateStepIssue>();
  const relink = (issue: DuplicateStepIssue): DuplicateStepIssue => {
    let fresh = relinked.get(issue);
    if (!fresh) {
      fresh = { ...issue, records: issue.sourceIndices.map((i) => points[i] as TrainingPoint) };
      relinked.set(issue, fresh);
    }
    return fresh;
  };
  const { analysis } = payload;
  const view: ChartView = {
    ...analysis.view,
    points,
    duplicates: analysis.view.duplicates.map((d) => ({ position: d.position, issue: relink(d.issue) })),
  };
  const issues: DataQualityIssue[] = analysis.diagnostics.issues.map((issue) =>
    issue.kind === 'duplicate_step' ? relink(issue) : issue,
  );
  return {
    run: { ...metadata, points },
    analysis: { ...analysis, view, diagnostics: { ...analysis.diagnostics, issues } },
  };
}
