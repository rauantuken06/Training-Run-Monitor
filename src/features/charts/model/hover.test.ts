import { describe, expect, it } from 'vitest';
import { fixtureRun, loadFrozenRun, pt } from '../../../test/integrityTestUtils';
import { analyzeRun, type ChartView } from '../../data/integrity/analyzeRun';
import { buildChartModel, type ChartModel } from './chartModel';
import { describeHover, escapeHtml, hoverHtml, hoverLines } from './hover';

const FULL = { minStep: 0, maxStep: 19_990 };
function setup(id: string, viewport = FULL, budget = 4_000): { view: ChartView; model: ChartModel } {
  const view = analyzeRun(loadFrozenRun(id)).view;
  return { view, model: buildChartModel(view, 'loss', viewport, budget) };
}
const lines = (s: { view: ChartView; model: ChartModel }, cursor: number, stepsPerPixel: number) =>
  hoverLines(s.model, describeHover(s.model, s.view, cursor, stepsPerPixel));

describe('hover: exact observation vs nearest plotted observation', () => {
  it('labels the value as the hovered step only when the pixel holds exactly that observation', () => {
    const s = setup('run-09', { minStep: 19_900, maxStep: 19_990 });
    const info = describeHover(s.model, s.view, 19_990.2, 0.1);
    expect(info.exact).toBe(true);
    expect(hoverLines(s.model, info).slice(0, 2)).toEqual(['Step 19,990', expect.stringMatching(/^Loss: 102\.47 \(exact 102\.4705\d+\)$/)]);
  });

  it('regression: inside a gap, the headline is the cursor step, not the nearest observation', () => {
    const s = setup('run-17');
    const out = lines(s, 3_500, 0.5);
    expect(out[0]).toBe('Cursor: step 3,500 (no observation at this step)');
    expect(out[1]).toBe('Nearest plotted observation: step 4,000 (500 steps away)');
    expect(out).toContain('⚠ Missing steps 3,000–3,990 (100 not recorded). The line is broken here.');
  });

  it('when one pixel spans several observations, says so and names the plotted one', () => {
    const s = setup('run-01');
    const out = lines(s, 10_000, 20); // a pixel covers ~20 steps = 2–3 observations at interval 10
    expect(out[0]).toMatch(/^Cursor: steps 9,990–10,010 \(3 observations in this pixel\)$/);
    expect(out[1]).toMatch(/^Nearest plotted observation: step [\d,]+ \(in this pixel\)$/);
  });

  it('on the million-point run at full zoom, never presents the spike as "the" hovered step', () => {
    const view = analyzeRun(loadFrozenRun('run-20')).view;
    const model = buildChartModel(view, 'loss', { minStep: 0, maxStep: 999_999 }, 4_000);
    const out = hoverLines(model, describeHover(model, view, 500_123, 920));
    expect(out[0]).toMatch(/^Cursor: steps 499,663–500,583 \(921 observations in this pixel\)$/);
    expect(out[1]).toBe('Nearest plotted observation: step 500,123 (in this pixel)');
    expect(out[2]).toBe('Loss: 42.5');
    expect(out.at(-1)).toMatch(/^Downsampled: [\d,]+ of 1,000,000 observations plotted/);
    // Builds and analyzes 1M points in the test body: ~3 s idle, exceeded the 5 s default under
    // CPU load in Task 09 QA (5.8 s). Only the time limit is raised; assertions are unchanged.
  }, 30_000);

  it('handles the viewport boundaries (cursor clamped to the first/last step)', () => {
    const s = setup('run-01');
    expect(lines(s, 0, 0.2)[0]).toBe('Step 0');
    expect(lines(s, 19_990, 0.2)[0]).toBe('Step 19,990');
  });
});

describe('hover: anomalies near the cursor', () => {
  it('reports NaN stretches near the cursor without inventing a value', () => {
    const s = setup('run-12');
    const out = lines(s, 17_000, 18);
    expect(out[0]).toBe('Cursor: steps 16,991–17,009 (1 observation in this pixel)'); // only step 17,000 (NaN)
    expect(out).toContain('Nearest plotted observation: step 13,990 (3,010 steps away)');
    expect(out).toContain('⚠ Steps 14,000–19,990: 600 NaN. Not plotted (no numeric value).');
  });

  it('reports +Infinity and -Infinity at their step', () => {
    expect(lines(setup('run-13'), 6_000, 1)).toContain('⚠ Step 6,000: 1 +Infinity. Not plotted (no numeric value).');
    expect(lines(setup('run-19'), 7_770, 1)).toContain('⚠ Step 7,770: 1 -Infinity. Not plotted (no numeric value).');
  });

  it('lists all values of a conflicting duplicate', () => {
    const out = lines(setup('run-15'), 8_200, 0.5);
    expect(out[0]).toBe('Step 8,200');
    expect(out.find((l) => l.startsWith('⚠ Step logged 2×'))).toMatch(/with different values \(\d\.\d+, \d\.\d+\); the last recorded is plotted\.$/);
  });

  it('shows exact digits when conflicting values would round to the same text', () => {
    const run = fixtureRun([pt(0, 1), pt(10, 2.000001), pt(10, 2.000002), pt(20, 3)]);
    const view = analyzeRun(run).view;
    const model = buildChartModel(view, 'loss', { minStep: 0, maxStep: 20 }, 100);
    const out = hoverLines(model, describeHover(model, view, 10, 0.1));
    expect(out).toContain('⚠ Step logged 2× with different values (2.000001, 2.000002); the last recorded is plotted.');
  });

  it('handles a chart with no plotted points', () => {
    const view = analyzeRun(fixtureRun([pt(0, Number.NaN), pt(10, null)])).view;
    const model = buildChartModel(view, 'loss', { minStep: 0, maxStep: 10 }, 16);
    const out = hoverLines(model, describeHover(model, view, 5, 0.1));
    expect(out[0]).toBe('Cursor: step 5 (no observation at this step)');
    expect(out.some((l) => l.includes('NaN') && l.includes('not recorded (null)'))).toBe(true);
    expect(out.some((l) => l.startsWith('Nearest plotted'))).toBe(false);
  });
});

describe('tooltip HTML', () => {
  it('escapes everything', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
    expect(hoverHtml(['Step <1>', 'x', '⚠ <b>'])).toBe('<strong>Step &lt;1&gt;</strong><br/>x<br/><span style="color:#b91c1c">⚠ &lt;b&gt;</span>');
  });
});
