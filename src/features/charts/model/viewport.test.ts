import { describe, expect, it } from 'vitest';
import { clampViewport, isFullViewport, panViewport, pixelToStep, zoomViewport } from './viewport';

const EXTENT = { min: 0, max: 19_990 };

describe('viewport math', () => {
  it('zooms in and out around the centre, staying inside the data', () => {
    const half = zoomViewport({ minStep: 0, maxStep: 19_990 }, 0.5, EXTENT);
    // Centre 9,995, half-span 4,997.5 → min 4,997.5, rounded to 4,998; span 9,995.
    expect(half).toEqual({ minStep: 4_998, maxStep: 14_993 });
    expect(zoomViewport(half, 2, EXTENT)).toEqual({ minStep: 0, maxStep: 19_990 });
    expect(zoomViewport({ minStep: 0, maxStep: 19_990 }, 4, EXTENT)).toEqual({ minStep: 0, maxStep: 19_990 });
  });

  it('zooms around a given centre', () => {
    expect(zoomViewport({ minStep: 0, maxStep: 1_000 }, 0.5, EXTENT, 0)).toEqual({ minStep: 0, maxStep: 500 });
  });

  it('pans by a fraction of the span and stops at the edges', () => {
    expect(panViewport({ minStep: 1_000, maxStep: 2_000 }, 0.25, EXTENT)).toEqual({ minStep: 1_250, maxStep: 2_250 });
    expect(panViewport({ minStep: 0, maxStep: 1_000 }, -0.25, EXTENT)).toEqual({ minStep: 0, maxStep: 1_000 });
    expect(panViewport({ minStep: 18_990, maxStep: 19_990 }, 0.5, EXTENT)).toEqual({ minStep: 18_990, maxStep: 19_990 });
  });

  it('clamps to integer bounds with a minimum span of one step', () => {
    expect(clampViewport({ minStep: 100.4, maxStep: 100.6 }, EXTENT)).toEqual({ minStep: 100, maxStep: 101 });
    expect(clampViewport({ minStep: -500, maxStep: 50_000 }, EXTENT)).toEqual({ minStep: 0, maxStep: 19_990 });
    expect(clampViewport({ minStep: 0, maxStep: 0 }, { min: 7, max: 7 })).toEqual({ minStep: 7, maxStep: 7 });
  });

  it('maps plot pixels to steps linearly', () => {
    expect(pixelToStep(76, 76, 1_000, { minStep: 0, maxStep: 1_000 })).toBe(0);
    expect(pixelToStep(576, 76, 1_000, { minStep: 0, maxStep: 1_000 })).toBe(500);
    expect(pixelToStep(5_000, 76, 1_000, { minStep: 0, maxStep: 1_000 })).toBe(1_000); // clamped
  });

  it('knows when it shows everything', () => {
    expect(isFullViewport({ minStep: 0, maxStep: 19_990 }, EXTENT)).toBe(true);
    expect(isFullViewport({ minStep: 10, maxStep: 19_990 }, EXTENT)).toBe(false);
  });
});
