import type { RunConfigValue, RunScenario, RunStatus } from '../../../types/training';
import type { CurveParams } from '../generators/curves';
import { DATASET_SEED, deriveSeed } from '../generators/random';
import type { RunAnomalies, RunDefinition } from '../generators/runDefinition';

/**
 * The 20 synthetic runs. This module holds definitions only: it never generates points.
 * Each anomaly is listed explicitly, so the definitions double as ground truth.
 */

/** ID of the million-point run. */
export const LARGE_RUN_ID = 'run-20';

/**
 * The single intended outlier in the million-point run.
 *
 * Step 500,123 is near the midpoint but deliberately not a multiple of 2, 10,
 * 100 or 1,000. A naive stride-based downsampler would therefore drop it,
 * which is exactly what a later task must prove it does not do.
 */
export const LARGE_RUN_SPIKE = { step: 500_123, value: 42.5 } as const;

const STANDARD_LENGTH = 2_000;
const STANDARD_INTERVAL = 10;

const BASE_CURVE: CurveParams = {
  initialLoss: 4.2,
  finalLoss: 1.9,
  decaySteps: 4_000,
  lossNoise: 0.015,
  peakLr: 3e-4,
  minLr: 3e-5,
  warmupSteps: 500,
  gradNormBase: 0.8,
  gradNormNoise: 0.08,
};

interface RunSpec {
  id: string;
  name: string;
  description: string;
  status: RunStatus;
  createdAt: string;
  scenarios: readonly RunScenario[];
  config?: Readonly<Record<string, RunConfigValue>>;
  length?: number;
  stepInterval?: number;
  curve?: Partial<CurveParams>;
  anomalies?: RunAnomalies;
}

function defineRun(spec: RunSpec): RunDefinition {
  const curve: CurveParams = { ...BASE_CURVE, ...spec.curve };
  return {
    metadata: {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      status: spec.status,
      createdAt: spec.createdAt,
      scenarios: spec.scenarios,
      config: {
        model: 'transformer-350m',
        optimizer: 'adamw',
        batch_size: 256,
        peak_lr: curve.peakLr,
        warmup_steps: curve.warmupSteps,
        ...spec.config,
      },
    },
    seed: deriveSeed(DATASET_SEED, spec.id),
    length: spec.length ?? STANDARD_LENGTH,
    stepInterval: spec.stepInterval ?? STANDARD_INTERVAL,
    curve,
    anomalies: spec.anomalies ?? {},
  };
}

export const RUN_DEFINITIONS: readonly RunDefinition[] = [
  // --- Healthy ------------------------------------------------------------
  defineRun({
    id: 'run-01',
    name: 'baseline-350m-lr3e-4',
    description: 'Reference run: smooth, monotone convergence.',
    status: 'completed',
    createdAt: '2026-10-01T09:00:00.000Z',
    scenarios: ['healthy'],
  }),
  defineRun({
    id: 'run-02',
    name: 'lr6e-4-fast-converge',
    description: 'Higher learning rate; converges faster to a slightly lower loss.',
    status: 'completed',
    createdAt: '2026-10-02T09:00:00.000Z',
    scenarios: ['healthy'],
    curve: { peakLr: 6e-4, decaySteps: 2_500, finalLoss: 1.85 },
  }),
  defineRun({
    id: 'run-03',
    name: 'long-schedule-50k',
    description: 'Long 50k-step schedule with 5,000 logged points.',
    status: 'completed',
    createdAt: '2026-10-03T09:00:00.000Z',
    scenarios: ['healthy'],
    length: 5_000,
    curve: { decaySteps: 9_000, finalLoss: 1.7, warmupSteps: 1_000 },
  }),
  defineRun({
    id: 'run-04',
    name: 'small-model-125m-in-progress',
    description: 'Smaller model, still training: fewer points, higher loss floor.',
    status: 'running',
    createdAt: '2026-11-10T18:00:00.000Z',
    scenarios: ['healthy'],
    config: { model: 'transformer-125m' },
    length: 1_200,
    curve: { initialLoss: 4.6, finalLoss: 2.6, decaySteps: 3_000, gradNormBase: 1.1 },
  }),

  // --- Noisy --------------------------------------------------------------
  defineRun({
    id: 'run-05',
    name: 'noisy-small-batch-bs32',
    description: 'Batch size 32: converges, but with heavy step-to-step noise.',
    status: 'completed',
    createdAt: '2026-10-05T09:00:00.000Z',
    scenarios: ['noisy'],
    config: { batch_size: 32 },
    curve: { lossNoise: 0.12, gradNormNoise: 0.3 },
  }),
  defineRun({
    id: 'run-06',
    name: 'noisy-no-warmup',
    description: 'No learning-rate warmup: noisy, slower convergence.',
    status: 'completed',
    createdAt: '2026-10-06T09:00:00.000Z',
    scenarios: ['noisy'],
    curve: { warmupSteps: 0, lossNoise: 0.08, gradNormNoise: 0.25, decaySteps: 5_000 },
  }),

  // --- Plateau ------------------------------------------------------------
  defineRun({
    id: 'run-07',
    name: 'plateau-lr-too-low',
    description: 'Learning rate too low: loss flattens early at a high value.',
    status: 'stopped',
    createdAt: '2026-10-07T09:00:00.000Z',
    scenarios: ['plateau'],
    curve: { peakLr: 1e-5, minLr: 1e-6, finalLoss: 3.4, decaySteps: 1_500 },
  }),
  defineRun({
    id: 'run-08',
    name: 'plateau-frozen-backbone',
    description: 'Frozen backbone: modest early improvement, then a long flat plateau.',
    status: 'stopped',
    createdAt: '2026-10-08T09:00:00.000Z',
    scenarios: ['plateau'],
    curve: { initialLoss: 3.9, finalLoss: 3.1, decaySteps: 2_500 },
  }),

  // --- Diverging (finite) -------------------------------------------------
  defineRun({
    id: 'run-09',
    name: 'diverging-lr3e-3',
    description: 'Learning rate too high: loss converges, then grows exponentially (finite).',
    status: 'failed',
    createdAt: '2026-10-09T09:00:00.000Z',
    scenarios: ['diverging'],
    curve: { peakLr: 3e-3, divergence: { startStep: 12_000, growthSteps: 2_000 } },
  }),
  defineRun({
    id: 'run-10',
    name: 'diverging-grad-explosion',
    description: 'Gradient explosion: grad_norm and loss blow up from step 8,000 (finite).',
    status: 'stopped',
    createdAt: '2026-10-10T09:00:00.000Z',
    scenarios: ['diverging'],
    curve: { divergence: { startStep: 8_000, growthSteps: 2_500 } },
  }),

  // --- NaN in loss --------------------------------------------------------
  defineRun({
    id: 'run-11',
    name: 'nan-loss-isolated',
    description: 'Three isolated NaN losses; training recovered (skip-NaN).',
    status: 'completed',
    createdAt: '2026-10-11T09:00:00.000Z',
    scenarios: ['nan_loss'],
    anomalies: {
      valueOverrides: [
        { step: 4_200, metric: 'loss', value: Number.NaN },
        { step: 9_150, metric: 'loss', value: Number.NaN },
        { step: 15_000, metric: 'loss', value: Number.NaN },
      ],
    },
  }),
  defineRun({
    id: 'run-12',
    name: 'nan-loss-fp16-overflow',
    description: 'fp16 overflow: every loss from step 14,000 onward is NaN.',
    status: 'failed',
    createdAt: '2026-10-12T09:00:00.000Z',
    scenarios: ['nan_loss'],
    config: { precision: 'fp16' },
    anomalies: { valueTails: [{ fromStep: 14_000, metric: 'loss', value: Number.NaN }] },
  }),

  // --- Infinity in loss ---------------------------------------------------
  defineRun({
    id: 'run-13',
    name: 'inf-loss-isolated',
    description: 'Two isolated +Infinity losses; training continued.',
    status: 'completed',
    createdAt: '2026-10-13T09:00:00.000Z',
    scenarios: ['infinite_loss'],
    anomalies: {
      valueOverrides: [
        { step: 6_000, metric: 'loss', value: Number.POSITIVE_INFINITY },
        { step: 13_370, metric: 'loss', value: Number.POSITIVE_INFINITY },
      ],
    },
  }),
  defineRun({
    id: 'run-14',
    name: 'inf-loss-overflow',
    description: 'Loss overflows to +Infinity from step 16,500 onward.',
    status: 'failed',
    createdAt: '2026-10-14T09:00:00.000Z',
    scenarios: ['infinite_loss'],
    anomalies: {
      valueTails: [{ fromStep: 16_500, metric: 'loss', value: Number.POSITIVE_INFINITY }],
    },
  }),

  // --- Step-structure anomalies -------------------------------------------
  defineRun({
    id: 'run-15',
    name: 'duplicate-steps-multi-rank-logging',
    description:
      'Two ranks both logged steps 8,000–8,490, with conflicting values. Step 12,000 was double-written identically.',
    status: 'completed',
    createdAt: '2026-10-15T09:00:00.000Z',
    scenarios: ['duplicate_steps'],
    anomalies: {
      duplicates: [
        { fromStep: 8_000, toStep: 8_490, mode: 'relogged' },
        { fromStep: 12_000, toStep: 12_000, mode: 'identical' },
      ],
    },
  }),
  defineRun({
    id: 'run-16',
    name: 'unsorted-steps-async-logger',
    description:
      'Async logger flushed out of order: steps 5,000–5,090 arrive after 5,490, and step 11,000 arrives after 11,500.',
    status: 'completed',
    createdAt: '2026-10-16T09:00:00.000Z',
    scenarios: ['unsorted_steps'],
    anomalies: {
      delayedBlocks: [
        { fromStep: 5_000, toStep: 5_090, afterStep: 5_490 },
        { fromStep: 11_000, toStep: 11_000, afterStep: 11_500 },
      ],
    },
  }),
  defineRun({
    id: 'run-17',
    name: 'missing-steps-logger-outage',
    description:
      'Logging outages: steps 3,000–3,990, 12,500 and 17,000–18,990 were never recorded.',
    status: 'completed',
    createdAt: '2026-10-17T09:00:00.000Z',
    scenarios: ['missing_steps'],
    anomalies: {
      gaps: [
        { fromStep: 3_000, toStep: 3_990 },
        { fromStep: 12_500, toStep: 12_500 },
        { fromStep: 17_000, toStep: 18_990 },
      ],
    },
  }),
  defineRun({
    id: 'run-18',
    name: 'missing-values-partial-metrics',
    description:
      'Steps exist, but some metrics were not recorded (null): lr at 2,000–2,020, grad_norm at 7,500, loss at 10,000.',
    status: 'completed',
    createdAt: '2026-10-18T09:00:00.000Z',
    scenarios: ['missing_values'],
    anomalies: {
      valueOverrides: [
        { step: 2_000, metric: 'lr', value: null },
        { step: 2_010, metric: 'lr', value: null },
        { step: 2_020, metric: 'lr', value: null },
        { step: 7_500, metric: 'grad_norm', value: null },
        { step: 10_000, metric: 'loss', value: null },
      ],
    },
  }),
  defineRun({
    id: 'run-19',
    name: 'corrupted-log-mixed-anomalies',
    description:
      'Corrupted log combining every anomaly type at once, for integrity-pipeline testing.',
    status: 'failed',
    createdAt: '2026-10-19T09:00:00.000Z',
    scenarios: [
      'nan_loss',
      'infinite_loss',
      'missing_values',
      'missing_steps',
      'duplicate_steps',
      'unsorted_steps',
    ],
    anomalies: {
      valueOverrides: [
        { step: 3_330, metric: 'loss', value: Number.NaN },
        { step: 7_770, metric: 'loss', value: Number.NEGATIVE_INFINITY },
        { step: 9_990, metric: 'grad_norm', value: null },
      ],
      gaps: [{ fromStep: 14_000, toStep: 14_490 }],
      duplicates: [{ fromStep: 6_000, toStep: 6_020, mode: 'identical' }],
      delayedBlocks: [{ fromStep: 10_000, toStep: 10_040, afterStep: 10_200 }],
    },
  }),

  // --- Million points -----------------------------------------------------
  defineRun({
    id: LARGE_RUN_ID,
    name: 'large-1m-steps-loss-spike',
    description:
      '1,000,000 sequential steps with a smooth loss curve and exactly one extreme loss spike near the midpoint.',
    status: 'completed',
    createdAt: '2026-10-20T09:00:00.000Z',
    scenarios: ['large_dataset', 'loss_spike'],
    config: { model: 'transformer-1.3b', batch_size: 512 },
    length: 1_000_000,
    stepInterval: 1,
    curve: {
      initialLoss: 4.0,
      finalLoss: 1.8,
      decaySteps: 120_000,
      lossNoise: 0.02,
      peakLr: 2e-4,
      minLr: 2e-5,
      warmupSteps: 2_000,
      gradNormBase: 0.6,
      gradNormNoise: 0.05,
    },
    anomalies: {
      valueOverrides: [{ step: LARGE_RUN_SPIKE.step, metric: 'loss', value: LARGE_RUN_SPIKE.value }],
    },
  }),
];

