import { describe, expect, it } from 'vitest';
import { getDefinition, samePoints } from '../../../test/dataTestUtils';
import type { TrainingPoint } from '../../../types/training';
import { generateRun } from '../generators/generateRun';
import { decodePoints, encodePoints, POINTS_FORMAT, PointDecodeError } from './pointCodec';

const tricky: TrainingPoint[] = [
  { step: 0, loss: 2.5, lr: 0, grad_norm: 1.25 },
  { step: 1, loss: Number.NaN, lr: 1e-4, grad_norm: Number.NaN },
  { step: 2, loss: Number.POSITIVE_INFINITY, lr: 1e-4, grad_norm: 3 },
  { step: 3, loss: Number.NEGATIVE_INFINITY, lr: null, grad_norm: 3 },
  { step: 4, loss: null, lr: 1e-4, grad_norm: null },
  { step: 0, loss: 0, lr: 1e-4, grad_norm: 0 }, // duplicate + unsorted step, real zeros
];

describe('pointCodec', () => {
  it('plain JSON.stringify would collapse NaN and Infinity into null (the problem being solved)', () => {
    const plain = JSON.parse(JSON.stringify(tricky)) as TrainingPoint[];
    expect(plain[1]?.loss).toBeNull();
    expect(plain[2]?.loss).toBeNull();
    expect(plain[4]?.loss).toBeNull();
  });

  it('round-trips NaN, +Infinity, -Infinity, null and zero distinctly, in the original order', () => {
    const decoded = decodePoints(encodePoints(tricky));
    expect(samePoints(decoded, tricky)).toBe(true);
    expect(Number.isNaN(decoded[1]?.loss)).toBe(true);
    expect(decoded[2]?.loss).toBe(Number.POSITIVE_INFINITY);
    expect(decoded[3]?.loss).toBe(Number.NEGATIVE_INFINITY);
    expect(decoded[4]?.loss).toBeNull();
    expect(decoded[5]?.loss).toBe(0);
  });

  it('writes explicit markers that are distinct from null', () => {
    const json = encodePoints(tricky);
    expect(json).toContain('"loss":"NaN"');
    expect(json).toContain('"loss":"Infinity"');
    expect(json).toContain('"loss":"-Infinity"');
    expect(json).toContain('"loss":null');
  });

  it('round-trips a full run containing every anomaly type', () => {
    const points = generateRun(getDefinition('run-19'));
    expect(samePoints(decodePoints(encodePoints(points)), points)).toBe(true);
  });

  it.each([
    ['unknown marker', { format: POINTS_FORMAT, points: [{ step: 0, loss: 'nan', lr: 1, grad_norm: 1 }] }],
    ['numeric string', { format: POINTS_FORMAT, points: [{ step: 0, loss: '1.5', lr: 1, grad_norm: 1 }] }],
    ['missing field', { format: POINTS_FORMAT, points: [{ step: 0, loss: 1, lr: 1 }] }],
    ['null step', { format: POINTS_FORMAT, points: [{ step: null, loss: 1, lr: 1, grad_norm: 1 }] }],
    ['wrong format tag', { format: 'other', points: [] }],
    ['non-object point', { format: POINTS_FORMAT, points: [42] }],
  ])('rejects invalid input instead of coercing it: %s', (_label, payload) => {
    expect(() => decodePoints(JSON.stringify(payload))).toThrow(PointDecodeError);
  });
});
