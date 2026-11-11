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

describe('formatFinite never misrepresents a value', () => {
  it('never shows a nonzero value as zero, keeps its sign, and stays within rounding error (seeded sweep)', () => {
    const problems: string[] = [];
    let seed = 12_345;
    const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 20_000; i++) {
      const exponent = Math.floor(rand() * 600) - 300;
      const value = (rand() < 0.5 ? -1 : 1) * (1 + rand() * 9) * 10 ** exponent;
      if (!Number.isFinite(value) || value === 0) continue;
      for (const digits of [5, 9]) {
        const text = formatFinite(value, digits);
        const back = Number(text);
        if (back === 0 || /^-?0$/.test(text)) problems.push(`${value} -> ${text}`);
        if (Math.sign(back) !== Math.sign(value)) problems.push(`sign ${value} -> ${text}`);
        if (Math.abs(back - value) > Math.abs(value) * 10 ** (1 - digits)) problems.push(`error ${value} -> ${text}`);
        if (/[^\d.e+-]/.test(text)) problems.push(`locale chars in ${text}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('uses a fixed format, independent of the runtime locale', () => {
    expect(formatFinite(1234.5)).toBe('1234.5');
    expect(formatCount(1_234_567)).toBe('1,234,567'); // en-US grouping by policy, also in de-DE / ru-RU browsers
  });
});

describe('formatCount / formatDate', () => {
  it('groups digits and formats dates in UTC', () => {
    expect(formatCount(1_000_000)).toBe('1,000,000');
    expect(formatDate('2026-10-01T09:00:00.000Z')).toBe('Oct 1, 2026');
  });
});
