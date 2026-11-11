/**
 * Before/after comparison of two measure.mjs result sets (Task 08).
 *   node scripts/perf/summarize.mjs baseline after
 * Prints a Markdown table (median of all repetitions, with min–max) and writes
 * docs/performance/comparison.json. No repetition is dropped.
 */
import fs from 'node:fs';

const [a, b] = process.argv.slice(2);
const load = (label) => JSON.parse(fs.readFileSync(`docs/performance/${label}/results.json`, 'utf8'));
const before = load(a);
const after = load(b);

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((p, q) => p - q);
  if (!s.length) return null;
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const range = (xs) => {
  const s = xs.filter((x) => typeof x === 'number');
  return s.length ? [Math.min(...s), Math.max(...s)] : null;
};
const num = (x) => (typeof x === 'number' ? x : null);

/** [label, unit, extractor (one rep → number | number[] | null), method] */
const METRICS = [
  ['Runs list: first contentful paint', 'ms', (r) => r.list.fcpMs, 'Paint Timing (FCP), from navigation start'],
  ['Runs list: table painted', 'ms', (r) => r.list.listPaintedMs, '20 rows in DOM, then next painted frame'],
  ['Runs list: total blocking time', 'ms', (r) => r.list.tbtMs, 'Σ(long task − 50 ms) until table painted'],
  ['Runs list: JS downloaded', 'kB', (r) => r.list.jsBytesDownloaded / 1000, 'Resource Timing decodedBodySize of .js'],
  ['Runs list: JS heap after GC', 'MB', (r) => r.list.memory.jsHeapUsedMB, 'CDP Performance.getMetrics JSHeapUsedSize after 2× forced GC'],
  ['run-20: loading message painted', 'ms', (r) => r.run20.load.loadingPaintedMs, 'deep link; status "Loading…" in DOM, then next frame'],
  ['run-20: data ready (summaries)', 'ms', (r) => r.run20.load.dataReadyMs, '"Data quality" heading in DOM'],
  ['run-20: charts painted (first render)', 'ms', (r) => r.run20.load.chartsPaintedMs, 'all 3 chart lines in DOM, then next frame'],
  ['run-20: total blocking time', 'ms', (r) => r.run20.load.tbtMs, 'Σ(long task − 50 ms) until charts painted'],
  ['run-20: longest main-thread task', 'ms', (r) => r.run20.load.maxLongTaskMs, 'Long Tasks API'],
  ['run-20: JS heap after GC (1M points)', 'MB', (r) => r.run20.memory.jsHeapUsedMB, 'CDP JSHeapUsedSize after 2× forced GC (main thread only)'],
  ['Zoom in, first click (new viewport)', 'ms', (r) => num(r.run20.zoomInMs[0]), 'Event Timing duration of the click (input → next paint)'],
  ['Zoom in, repeated clicks (viewport seen before)', 'ms', (r) => r.run20.zoomInMs.slice(1).map(num), 'Event Timing, clicks 2–5'],
  ['Reset zoom, first click (full range)', 'ms', (r) => num(r.run20.resetMs[0]), 'Event Timing duration of the click'],
  ['Reset zoom, repeated clicks', 'ms', (r) => r.run20.resetMs.slice(1).map(num), 'Event Timing, clicks 2–5'],
  ['Hover: processing per move (median)', 'ms', (r) => r.run20.hover.processingMedianMs, 'pointermove input timestamp → end of dispatch'],
  ['Hover: input → next frame (median)', 'ms', (r) => r.run20.hover.nextFrameMedianMs, 'input timestamp → after next frame'],
  ['Hover: input → next frame (max)', 'ms', (r) => r.run20.hover.nextFrameMaxMs, 'worst of 30 moves'],
];

const rows = [];
for (const [label, unit, get, method] of METRICS) {
  const collect = (res) => res.runs.flatMap((r) => [get(r)].flat());
  const xa = collect(before);
  const xb = collect(after);
  const ma = median(xa);
  const mb = median(xb);
  const diff = ma != null && mb != null ? mb - ma : null;
  rows.push({
    metric: label, unit, method,
    before: ma, beforeRange: range(xa), beforeSamples: xa.length,
    after: mb, afterRange: range(xb), afterSamples: xb.length,
    diff, pct: diff != null && ma ? (diff / ma) * 100 : null,
  });
}

const sizes = (res) => Object.fromEntries(res.build.map((f) => [f.file.replace(/-[\w-]{8}\./, '.'), f]));
const fmt = (x, d = 0) => (x == null ? 'n/a' : x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
const dec = (unit) => (unit === 'MB' ? 1 : 0);

let md = '| Metric | Baseline median (min–max) | Optimized median (min–max) | Difference | Change | Method |\n| --- | --- | --- | --- | --- | --- |\n';
for (const r of rows) {
  const d = dec(r.unit);
  const span = (m, rg, n) => `${fmt(m, d)} ${r.unit} (${rg ? `${fmt(rg[0], d)}–${fmt(rg[1], d)}` : 'n/a'}; n=${n})`;
  md += `| ${r.metric} | ${span(r.before, r.beforeRange, r.beforeSamples)} | ${span(r.after, r.afterRange, r.afterSamples)} | ${r.diff == null ? 'n/a' : `${r.diff > 0 ? '+' : ''}${fmt(r.diff, d)} ${r.unit}`} | ${r.pct == null ? 'n/a' : `${r.pct > 0 ? '+' : ''}${fmt(r.pct, 1)}%`} | ${r.method} |\n`;
}
const sa = sizes(before);
const sb = sizes(after);
md += '\n| Build output (JS) | Baseline | Optimized |\n| --- | --- | --- |\n';
for (const name of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
  if (!name.endsWith('.js')) continue;
  const cell = (f) => (f ? `${fmt(f.bytes / 1000, 1)} kB (gzip ${fmt(f.gzipBytes / 1000, 1)} kB)` : '—');
  md += `| ${name} | ${cell(sa[name])} | ${cell(sb[name])} |\n`;
}
console.log(md);
fs.writeFileSync('docs/performance/comparison.json', JSON.stringify({ baseline: a, optimized: b, rows, build: { baseline: before.build, optimized: after.build } }, null, 2));
fs.writeFileSync('docs/performance/comparison.md', md);
