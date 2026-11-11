import type { MetricValue, TrainingPoint } from '../../../types/training';

/**
 * JSON codec for training points that keeps invalid-value semantics.
 *
 * Plain `JSON.stringify` writes `NaN` and `±Infinity` as `null`, which makes
 * them indistinguishable from "not recorded". This codec writes them as the
 * strings `"NaN"`, `"Infinity"` and `"-Infinity"`, and keeps `null` as `null`.
 * Metric values are otherwise numbers, so a string can never be ambiguous.
 *
 * Decoding is strict: anything unexpected throws. Nothing is coerced.
 *
 * Note: structured clone (`postMessage` to a Web Worker) preserves NaN and
 * Infinity natively, so it does not need this codec.
 */

export const POINTS_FORMAT = 'training-points/v1';

type EncodedNumber = number | 'NaN' | 'Infinity' | '-Infinity';
type EncodedMetric = EncodedNumber | null;

interface EncodedPoint {
  step: EncodedNumber;
  loss: EncodedMetric;
  lr: EncodedMetric;
  grad_norm: EncodedMetric;
}

interface EncodedPoints {
  format: typeof POINTS_FORMAT;
  points: EncodedPoint[];
}

function encodeNumber(value: number): EncodedNumber {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  return value;
}

function encodeMetric(value: MetricValue): EncodedMetric {
  return value === null ? null : encodeNumber(value);
}

export function encodePoints(points: readonly TrainingPoint[]): string {
  const payload: EncodedPoints = {
    format: POINTS_FORMAT,
    points: points.map((p) => ({
      step: encodeNumber(p.step),
      loss: encodeMetric(p.loss),
      lr: encodeMetric(p.lr),
      grad_norm: encodeMetric(p.grad_norm),
    })),
  };
  return JSON.stringify(payload);
}

export class PointDecodeError extends Error {
  override name = 'PointDecodeError';
}

function decodeNumber(raw: unknown, where: string): number {
  if (typeof raw === 'number') return raw;
  if (raw === 'NaN') return Number.NaN;
  if (raw === 'Infinity') return Number.POSITIVE_INFINITY;
  if (raw === '-Infinity') return Number.NEGATIVE_INFINITY;
  throw new PointDecodeError(`${where}: expected a number or NaN/Infinity marker, got ${JSON.stringify(raw)}`);
}

function decodeMetric(raw: unknown, where: string): MetricValue {
  return raw === null ? null : decodeNumber(raw, where);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodePoints(json: string): TrainingPoint[] {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || parsed.format !== POINTS_FORMAT || !Array.isArray(parsed.points)) {
    throw new PointDecodeError(`Expected a "${POINTS_FORMAT}" payload`);
  }
  return parsed.points.map((raw: unknown, i): TrainingPoint => {
    if (!isRecord(raw)) throw new PointDecodeError(`points[${i}]: expected an object`);
    for (const key of ['step', 'loss', 'lr', 'grad_norm']) {
      if (!(key in raw)) throw new PointDecodeError(`points[${i}]: missing "${key}"`);
    }
    return {
      step: decodeNumber(raw.step, `points[${i}].step`),
      loss: decodeMetric(raw.loss, `points[${i}].loss`),
      lr: decodeMetric(raw.lr, `points[${i}].lr`),
      grad_norm: decodeMetric(raw.grad_norm, `points[${i}].grad_norm`),
    };
  });
}
