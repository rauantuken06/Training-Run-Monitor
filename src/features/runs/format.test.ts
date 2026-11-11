import { describe, expect, it } from 'vitest';
import { describeValue, formatCount, formatDate, formatFinite } from './format';

describe('describeValue', () => {
  it('spells out invalid values and never turns them into 0', () => {
    expect(describeValue(Number.NaN)).toEqual({ text: 'NaN', kind: 'nan', exact: 'NaN' });
    expect(describeValue(Infinity)).toEqual({ text: '+Infinity', kind: 'positive_infinity', exact: 'Infinity' });
    expect(describeValue(-Infinity)).toEqual({ text: '-Infinity', kind: 'negative_infinity', exact: '-Infinity' });
    expect(describeValue(null)).toEqual({ text: 'Not recorded', kind: 'missing', exact: 'null' });
    for (const v of [Number.NaN, Infinity, -Infinity, null]) expect(describeValue(v).text).not.toMatch(/^-?0$/);
  });

  it('keeps the exact raw value next to the rounded display text', () => {
    expect(describeValue(1.884999123456)).toEqual({ text: '1.885', kind: 'finite', exact: '1.884999123456' });
    expect(describeValue(-0).exact).toBe('-0');
  });
});

describe('formatFinite', () => {
  it.each([
    [0, '0'],
    [-0, '-0'],
    [1.9, '1.9'],
    [1.884999123456, '1.885'],
    [42.5, '42.5'],
    [12345.678, '12346'],
    [123456, '1.2346e5'],
    [3e-4, '3e-4'],
    [0.00012345678, '1.2346e-4'],
    [0.001, '0.001'],
    [-2.5e-9, '-2.5e-9'],
    [1.7976931348623157e308, '1.7977e308'],
    [5e-324, '4.9407e-324'],
  ])('%s → %s', (value, text) => {
    expect(formatFinite(value)).toBe(text);
  });
});

describe('formatCount / formatDate', () => {
  it('groups digits and formats dates in UTC', () => {
    expect(formatCount(1_000_000)).toBe('1,000,000');
    expect(formatDate('2026-10-01T09:00:00.000Z')).toBe('Oct 1, 2026');
  });
});
