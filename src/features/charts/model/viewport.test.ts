import { describe, expect, it } from 'vitest';
import { clampViewport, isFullViewport, panViewport, parseStepInput, pixelToStep, requestRange, zoomViewport } from './viewport';

describe('parseStepInput (typed step numbers)', () => {
  it.each([
    ['5000', 5_000],
    ['5,000', 5_000],
    ['1,000,000', 1_000_000],
    ['5 000', 5_000],
    ['5 000', 5_000],
    ['5 000', 5_000],
    [' 42 ', 42],
    ['0', 0],
  ])('accepts %j as %i', (text, value) => {
    expect(parseStepInput(text)).toEqual({ ok: true, value });
  });

  it.each(['5.000', '5000.7', '1,5', '12,34', '-10', 'abc', '', '5,000.5', '9'.repeat(20)])(
    'regression: rejects %j instead of guessing',
    (text) => {
      expect(parseStepInput(text).ok).toBe(false);
    },
  );

  it('explains why "5.000" is rejected', () => {
    expect(parseStepInput('5.000')).toEqual({ ok: false, reason: '"5.000": steps are whole numbers; write 5000 or 5,000 (not 5.000).' });
  });
});

describe('requestRange (typed range vs the data)', () => {
  const extent = { min: 0, max: 19_990 };
  it('applies a range inside the data unchanged', () => {
    expect(requestRange('5,000', '6000', extent)).toEqual({ ok: true, viewport: { minStep: 5_000, maxStep: 6_000 }, adjusted: false });
  });

  it('regression: cuts a partly outside range down to the data instead of shifting it', () => {
    expect(requestRange('19000', '25000', extent)).toEqual({ ok: true, viewport: { minStep: 19_000, maxStep: 19_990 }, adjusted: true });
    expect(requestRange('0', '500', { min: 100, max: 900 })).toEqual({ ok: true, viewport: { minStep: 100, maxStep: 500 }, adjusted: true });
  });

  it('regression: rejects a range with no data instead of showing another range', () => {
    expect(requestRange('30000', '40000', extent)).toEqual({ ok: false, error: 'No data in steps 30,000–40,000; this run has steps 0–19,990.' });
  });

  it('rejects reversed and malformed ranges', () => {
    expect(requestRange('6000', '5000', extent)).toEqual({ ok: false, error: '"From" must be smaller than "To".' });
    expect(requestRange('5.000', '6000', extent).ok).toBe(false);
    expect(requestRange('5000', '', extent).ok).toBe(false);
  });
});

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
