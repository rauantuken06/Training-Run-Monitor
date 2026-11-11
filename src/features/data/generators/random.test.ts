import { describe, expect, it } from 'vitest';
import { createGaussian, deriveSeed, GAUSSIAN_CLIP, hashString, mulberry32 } from './random';

function take(rng: () => number, n: number): number[] {
  return Array.from({ length: n }, () => rng());
}

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    expect(take(mulberry32(123), 1_000)).toEqual(take(mulberry32(123), 1_000));
  });

  it('produces different sequences for different seeds', () => {
    expect(take(mulberry32(123), 10)).not.toEqual(take(mulberry32(124), 10));
  });

  it('returns values in [0, 1)', () => {
    const outOfRange = take(mulberry32(7), 100_000).filter((v) => !(v >= 0 && v < 1));
    expect(outOfRange).toEqual([]);
  });
});

describe('createGaussian', () => {
  it('is deterministic for a seeded source', () => {
    expect(take(createGaussian(mulberry32(9)), 1_000)).toEqual(
      take(createGaussian(mulberry32(9)), 1_000),
    );
  });

  it(`never exceeds ±${GAUSSIAN_CLIP} standard deviations`, () => {
    const values = take(createGaussian(mulberry32(42)), 200_000);
    const largest = values.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    expect(largest).toBeLessThanOrEqual(GAUSSIAN_CLIP);
    // Clipping actually engages at this sample size (|z| > 4 has p ≈ 6e-5 per sample).
    expect(largest).toBe(GAUSSIAN_CLIP);
  });

  it('has approximately zero mean and unit variance', () => {
    const values = take(createGaussian(mulberry32(42)), 200_000);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(Math.abs(variance - 1)).toBeLessThan(0.02);
  });
});

describe('seed derivation', () => {
  it('is stable and key-dependent', () => {
    expect(hashString('run-01')).toBe(hashString('run-01'));
    expect(deriveSeed(1, 'run-01')).toBe(deriveSeed(1, 'run-01'));
    expect(deriveSeed(1, 'run-01')).not.toBe(deriveSeed(1, 'run-02'));
    expect(deriveSeed(1, 'run-01')).not.toBe(deriveSeed(2, 'run-01'));
  });
});
