import type { LineSeriesOption } from 'echarts';
import { describe, expect, it } from 'vitest';
import { fixtureRun, loadFrozenRun, pt } from '../../../test/integrityTestUtils';
import type { MetricKey } from '../../../types/training';
import { analyzeRun } from '../../data/integrity/analyzeRun';
import { buildChartModel, type ChartModel } from './chartModel';
import { buildEChartsOption, invalidRunLabel, LIGHT_THEME, MAX_MARKERS } from './echartsOption';

const FULL = { minStep: 0, maxStep: 19_990 };
const noop = () => '';
function optionFor(id: string, metric: MetricKey = 'loss', budget = 4_000, viewport = FULL) {
  const model = buildChartModel(analyzeRun(loadFrozenRun(id)).view, metric, viewport, budget);
  return { model, option: buildEChartsOption(model, LIGHT_THEME, noop) };
}
type AnyRecord = Record<string, unknown>;
const series = (option: AnyRecord) => option.series as LineSeriesOption[];
const lineSeries = (option: AnyRecord) => series(option).filter((s) => s.id !== 'markers');
const markers = (option: AnyRecord) => series(option).find((s) => s.id === 'markers') as LineSeriesOption & AnyRecord;
const axis = (option: AnyRecord, key: 'xAxis' | 'yAxis') => option[key] as AnyRecord & { axisLabel: { formatter: (v: number) => string } & AnyRecord };

describe('ECharts option: fidelity settings', () => {
  it.each(['run-01', 'run-11', 'run-17'])('%s: one unsmoothed, unsampled line series per segment with exact data', (id) => {
    const { model, option } = optionFor(id);
    const lines = lineSeries(option);
    expect(lines).toHaveLength(model.seriesData.length);
    lines.forEach((s, i) => {
      expect(s).toMatchObject({ type: 'line', smooth: false, connectNulls: false, animation: false, clip: true });
      expect(s.sampling).toBeUndefined();
      expect(s.data).toEqual(model.seriesData[i]?.map((xy) => [xy[0], xy[1]]));
    });
    expect((option as AnyRecord).animation).toBe(false);
  });

  it('pins the plot area and the axes to the model', () => {
    const { model, option } = optionFor('run-09', 'loss', 400, { minStep: 1_000, maxStep: 15_000 });
    const o = option as AnyRecord;
    expect(o.grid).toMatchObject({ outerBoundsMode: 'none' });
    expect(axis(o, 'xAxis')).toMatchObject({ type: 'value', min: 1_000, max: 15_000 });
    expect(axis(o, 'yAxis')).toMatchObject({ type: 'value', min: model.yBounds?.min, max: model.yBounds?.max, show: true });
    expect(axis(o, 'yAxis').axisLabel).toMatchObject({ showMinLabel: false, showMaxLabel: false });
  });

  it('formats axis labels as steps and readable values (small lr is not 0)', () => {
    const { option } = optionFor('run-01', 'lr');
    expect(axis(option as AnyRecord, 'xAxis').axisLabel.formatter(1_000_000)).toBe('1,000,000');
    expect(axis(option as AnyRecord, 'yAxis').axisLabel.formatter(3e-5)).toBe('3e-5');
    expect(axis(option as AnyRecord, 'yAxis').axisLabel.formatter(-0.5)).toBe('-0.5');
  });

  it('single-point segments show a symbol so they are visible', () => {
    const run = fixtureRun([pt(0, 1), pt(10, Number.NaN), pt(20, 2), pt(30, Number.NaN), pt(40, 3), pt(50, 4)]);
    const model = buildChartModel(analyzeRun(run).view, 'loss', { minStep: 0, maxStep: 50 }, 100);
    const lines = lineSeries(buildEChartsOption(model, LIGHT_THEME, noop));
    expect(lines.map((s) => s.showSymbol)).toEqual([true, true, false]);
  });
});

describe('ECharts option: anomaly markers', () => {
  it('marks every invalid run, even at a tiny budget, although invalid steps are never plotted points', () => {
    const { model, option } = optionFor('run-11', 'loss', 2);
    const m = markers(option);
    const lineMarks = (m.markLine as { data: { xAxis: number; label: { formatter: string } }[] }).data;
    expect(lineMarks.map((d) => [d.xAxis, d.label.formatter])).toEqual([
      [4_200, 'NaN'],
      [9_150, 'NaN'],
      [15_000, 'NaN'],
    ]);
    // The invalid steps have no plotted point, yet each is marked.
    expect(model.result.points.filter((p) => [4_200, 9_150, 15_000].includes(p.step))).toEqual([]);
    expect(model.result.outputCount).toBeLessThan(20);
  });

  it('marks long invalid runs and gaps as labelled bands', () => {
    const nan = markers(optionFor('run-12').option);
    const nanAreas = (nan.markArea as { data: [{ xAxis: number; label: { formatter: string } }, { xAxis: number }][] }).data;
    expect(nanAreas.map(([a, b]) => [a.xAxis, b.xAxis, a.label.formatter])).toEqual([[14_000, 19_990, 'NaN ×600']]);

    const gaps = markers(optionFor('run-17').option);
    const gapAreas = (gaps.markArea as { data: [{ xAxis: number; label: { formatter: string } }, { xAxis: number }][] }).data;
    expect(gapAreas.map(([a, b]) => [a.xAxis, b.xAxis, a.label.formatter])).toEqual([
      [2_990, 4_000, 'gap ×100'],
      [12_490, 12_510, 'gap ×1'],
      [16_990, 19_000, 'gap ×200'],
    ]);
  });

  it('marks each conflicting duplicate step on the bottom edge (never on top of the data)', () => {
    const { model, option } = optionFor('run-15');
    const points = (markers(option).markPoint as unknown as { data: { coord: [number, number] }[] }).data;
    expect(points).toHaveLength(50);
    expect(points.every((p) => p.coord[1] === model.yBounds?.min)).toBe(true);
    expect(points[0]?.coord[0]).toBe(8_000);
  });

  it(`draws at most ${MAX_MARKERS} markers of a kind`, () => {
    const pts = Array.from({ length: 600 }, (_, i) => pt(i * 10, i % 2 === 0 ? 1 : Number.NaN));
    const model: ChartModel = buildChartModel(analyzeRun(fixtureRun(pts)).view, 'loss', { minStep: 0, maxStep: 5_990 }, 4_000);
    expect(model.result.invalidRuns).toHaveLength(300);
    const lineMarks = (markers(buildEChartsOption(model, LIGHT_THEME, noop)).markLine as { data: unknown[] }).data;
    expect(lineMarks).toHaveLength(MAX_MARKERS);
  });

  it('labels invalid runs with text, not just color', () => {
    const base = { startPosition: 0, endPosition: 0, startStep: 0, endStep: 0, startSourceIndex: 0, endSourceIndex: 0 };
    expect(invalidRunLabel({ ...base, count: 1, kinds: { nan: 0, positive_infinity: 0, negative_infinity: 1, missing: 0 } })).toBe('-Inf');
    expect(invalidRunLabel({ ...base, count: 3, kinds: { nan: 1, positive_infinity: 1, negative_infinity: 0, missing: 1 } })).toBe('NaN/+Inf/null ×3');
  });
});
