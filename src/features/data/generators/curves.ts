import type { TrainingPoint } from '../../../types/training';

/** Shape parameters for one run's metric curves. */
export interface CurveParams {
  /** Loss at step 0 (before noise). */
  initialLoss: number;
  /** Asymptotic loss the run converges towards. */
  finalLoss: number;
  /** e-folding time of the loss decay, in steps. */
  decaySteps: number;
  /** Standard deviation of multiplicative log-normal loss noise. */
  lossNoise: number;
  peakLr: number;
  minLr: number;
  /** Linear warmup length in steps. `0` disables warmup. */
  warmupSteps: number;
  /** Late-training gradient norm level. */
  gradNormBase: number;
  /** Standard deviation of multiplicative log-normal grad-norm noise. */
  gradNormNoise: number;
  /** Optional exponential blow-up after `startStep`; values stay finite. */
  divergence?: {
    startStep: number;
    /** Steps for the loss to grow by a factor of e. */
    growthSteps: number;
  };
}

/** Linear warmup followed by cosine decay to `minLr`. Noise-free, as real schedulers are. */
export function learningRateAt(curve: CurveParams, step: number, totalSteps: number): number {
  const { peakLr, minLr, warmupSteps } = curve;
  if (warmupSteps > 0 && step < warmupSteps) {
    return (peakLr * step) / warmupSteps;
  }
  const decaySpan = Math.max(1, totalSteps - warmupSteps);
  const progress = Math.min(1, Math.max(0, (step - warmupSteps) / decaySpan));
  return minLr + (peakLr - minLr) * 0.5 * (1 + Math.cos(Math.PI * progress));
}

function divergenceFactor(curve: CurveParams, step: number): number {
  const d = curve.divergence;
  if (!d || step <= d.startStep) return 1;
  return Math.exp((step - d.startStep) / d.growthSteps);
}

/** Noise-free loss: exponential decay towards `finalLoss`, times any divergence factor. */
export function baselineLossAt(curve: CurveParams, step: number): number {
  const { initialLoss, finalLoss, decaySteps } = curve;
  const converged = finalLoss + (initialLoss - finalLoss) * Math.exp(-step / decaySteps);
  return converged * divergenceFactor(curve, step);
}

/** Noise-free gradient norm: elevated early in training, grows faster than loss when diverging. */
export function baselineGradNormAt(curve: CurveParams, step: number): number {
  const early = 1 + 2 * Math.exp(-step / (curve.decaySteps / 2));
  return curve.gradNormBase * early * divergenceFactor(curve, step) ** 1.5;
}

/**
 * Sample one point. Noise is multiplicative log-normal, so values stay positive
 * and finite; `gaussian` must be a clipped sampler (see `createGaussian`).
 */
export function samplePoint(
  curve: CurveParams,
  step: number,
  totalSteps: number,
  gaussian: () => number,
): TrainingPoint {
  return {
    step,
    loss: baselineLossAt(curve, step) * Math.exp(curve.lossNoise * gaussian()),
    lr: learningRateAt(curve, step, totalSteps),
    grad_norm: baselineGradNormAt(curve, step) * Math.exp(curve.gradNormNoise * gaussian()),
  };
}
