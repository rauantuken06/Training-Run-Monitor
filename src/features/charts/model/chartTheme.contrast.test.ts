/**
 * Contrast of the chart themes (Task 09). axe-core cannot evaluate text and
 * shapes inside the ECharts SVG (it reports them as "needs review"), so the
 * theme colours are checked here with the WCAG 2.x contrast formula:
 * text ≥ 4.5:1 (1.4.3); data line, axes and markers ≥ 3:1 (1.4.11, graphical
 * objects needed to understand the chart). Translucent bands are blended over
 * the card background first.
 */
import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME, type ChartTheme } from './echartsOption';

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
};
const rgba = (css: string): [number, number, number, number] => {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(css);
  if (!m) throw new Error(`not rgba: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
};
const blend = (css: string, bg: RGB): RGB => {
  const [r, g, b, a] = rgba(css);
  return [r, g, b].map((c, i) => Math.round(c * a + (bg[i] ?? 0) * (1 - a))) as RGB;
};
const luminance = (c: RGB) => {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

// Card backgrounds behind the charts: bg-white / dark:bg-slate-900.
const THEMES: [string, ChartTheme, RGB][] = [
  ['light', LIGHT_THEME, hex('#ffffff')],
  ['dark', DARK_THEME, hex('#0f172a')],
];

describe.each(THEMES)('%s chart theme contrast', (_name, t, bg) => {
  it('text (axis labels, marker labels) is at least 4.5:1', () => {
    expect(contrast(hex(t.text), bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(t.invalid), bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(t.invalid), blend(t.invalidBand, bg))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(t.text), blend(t.gapBand, bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('regression: data line, axis lines and markers are at least 3:1', () => {
    expect(contrast(hex(t.line), bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(t.axis), bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(t.conflict), bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(t.line), blend(t.invalidBand, bg))).toBeGreaterThanOrEqual(3);
  });
});
