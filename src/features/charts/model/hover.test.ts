import { describe, expect, it } from 'vitest';
import { fixtureRun, loadFrozenRun, pt } from '../../../test/integrityTestUtils';
import { analyzeRun } from '../../data/integrity/analyzeRun';
import { buildChartModel } from './chartModel';
import { describeHover, escapeHtml, hoverHtml, hoverLines } from './hover';

const model = (id: string, budget = 4_000) => buildChartModel(analyzeRun(loadFrozenRun(id)).view, 'loss', { minStep: 0, maxStep: 19_990 }, budget);

describe('describeHover / hoverLines', () => {
  it('shows the exact step and raw value of the nearest plotted point', () => {
    const m = model('run-09');
    const info = describeHover(m, 19_987, 5);
    expect(info.nearest?.step).toBe(19_990);
    const lines = hoverLines(m, info);
    expect(lines[0]).toBe('Step 19,990');
    expect(lines[1]).toMatch(/^Loss: 102\.47 \(exact 102\.4705\d+\)$/);
  });

  it('reports a gap at the cursor, even far from any plotted point', () => {
    const m = model('run-17');
    const lines = hoverLines(m, describeHover(m, 3_500, 50));
    expect(lines).toContain('⚠ Missing steps 3,000–3,990 (100 not recorded). The line is broken here.');
  });

  it('reports NaN and Infinity stretches near the cursor without inventing a value', () => {
    const nan = model('run-12');
    const lines = hoverLines(nan, describeHover(nan, 17_000, 50));
    expect(lines).toContain('⚠ Steps 14,000–19,990: 600 NaN. Not plotted (no numeric value).');
    expect(lines[0]).toBe('Step 13,990'); // nearest real point, not a value at 17,000

    const inf = model('run-13');
    expect(hoverLines(inf, describeHover(inf, 6_000, 5))).toContain('⚠ Step 6,000: 1 +Infinity. Not plotted (no numeric value).');
  });

  it('lists all values of a conflicting duplicate', () => {
    const m = model('run-15');
    const lines = hoverLines(m, describeHover(m, 8_200, 1));
    expect(lines.find((l) => l.startsWith('⚠ Step logged 2×'))).toMatch(/with different values \(.+, .+\); the last recorded is plotted\.$/);
  });

  it('says when the line is downsampled', () => {
    const m = model('run-01', 40);
    expect(hoverLines(m, describeHover(m, 5_000, 10)).at(-1)).toMatch(/^Nearest plotted observation\. \d+ of 2,000 observations are plotted/);
  });

  it('handles a chart with no plotted points', () => {
    const run = fixtureRun([pt(0, Number.NaN), pt(10, null)]);
    const m = buildChartModel(analyzeRun(run).view, 'loss', { minStep: 0, maxStep: 10 }, 16);
    const lines = hoverLines(m, describeHover(m, 5, 10));
    expect(lines.some((l) => l.includes('NaN') && l.includes('not recorded (null)'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Step '))).toBe(false);
  });
});

describe('tooltip HTML', () => {
  it('escapes everything', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
    expect(hoverHtml(['Step <1>', 'x', '⚠ <b>'])).toBe('<strong>Step &lt;1&gt;</strong><br/>x<br/><span style="color:#b91c1c">⚠ &lt;b&gt;</span>');
  });
});
