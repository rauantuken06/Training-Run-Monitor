/**
 * Reproducible browser performance measurement (Task 08).
 *
 *   npm run build
 *   node scripts/perf/measure.mjs <label> [reps=5]
 *
 * Starts `vite preview`, then for each repetition launches Google Chrome (Playwright
 * channel "chrome", new headless mode) with CPU throttling 4x set through the
 * DevTools Protocol (`Emulation.setCPUThrottlingRate`, the mechanism behind the
 * DevTools "4x slowdown" setting) and the HTTP cache disabled. Results go to
 * docs/performance/<label>/results.json; one extra traced pass writes genuine Chrome
 * trace files (loadable in the DevTools Performance panel) to docs/performance/<label>/traces/.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from '@playwright/test';

const label = process.argv[2];
const reps = Number(process.argv[3] ?? 5);
if (!label) throw new Error('usage: node scripts/perf/measure.mjs <label> [reps]');
const PORT = 4320;
const BASE = `http://localhost:${PORT}`;
const OUT = path.resolve('docs/performance', label);
fs.mkdirSync(path.join(OUT, 'traces'), { recursive: true });
const CPU_THROTTLING = 4;
const VIEWPORT = { width: 1280, height: 900 };
const LINE_COLOR = '#0369a1';
const GRID = { left: 76, right: 36 };

/** Installed before any app script: observers for long tasks, paints, events and DOM milestones. */
const INIT = `(() => {
  const P = (window.__perf = { longtasks: [], events: [], milestones: {}, painted: {}, lcp: null, hover: [] });
  const obs = (type, fn, extra) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }); } catch {} };
  obs('longtask', (e) => P.longtasks.push({ start: e.startTime, duration: e.duration }));
  obs('largest-contentful-paint', (e) => { P.lcp = e.startTime; });
  obs('event', (e) => P.events.push({ name: e.name, start: e.startTime, duration: e.duration, interactionId: e.interactionId }), { durationThreshold: 16 });
  const hasLine = (m) => [...document.querySelectorAll('[data-testid="metric-chart-' + m + '"] svg path')].some((p) => (p.getAttribute('stroke') || '').toLowerCase() === '${LINE_COLOR}');
  const checks = {
    listReady: () => document.querySelectorAll('table tbody tr').length >= 20,
    shell: () => !!document.querySelector('main h1'),
    loading: () => [...document.querySelectorAll('[role=status]')].some((n) => /Loading/.test(n.textContent || '')),
    dataReady: () => [...document.querySelectorAll('h2')].some((h) => h.textContent === 'Data quality'),
    chartsReady: () => ['loss', 'lr', 'grad_norm'].every(hasLine),
  };
  const check = () => {
    const t = performance.now();
    for (const [k, f] of Object.entries(checks)) {
      if (k in P.milestones || !f()) continue;
      P.milestones[k] = t;
      // rAF callbacks run before the frame is painted; a timer scheduled from it runs after.
      requestAnimationFrame(() => setTimeout(() => { P.painted[k] = performance.now(); }, 0));
    }
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
  // Hover: input timestamp -> end of event dispatch -> after the next frame.
  window.addEventListener('pointermove', (e) => { P._hover = { t0: e.timeStamp }; }, true);
  window.addEventListener('pointermove', () => {
    const h = P._hover; if (!h) return;
    h.processed = performance.now();
    requestAnimationFrame(() => setTimeout(() => { h.frame = performance.now(); P.hover.push(h); }, 0));
    P._hover = null;
  }, false);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

async function startServer() {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await fetch(BASE); return server; } catch { await sleep(200); }
  }
  server.kill();
  throw new Error('preview server did not start');
}

async function newPage(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLING });
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Performance.enable');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { context, page, cdp, errors };
}

async function heapAfterGc(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (n) => metrics.find((m) => m.name === n)?.value ?? null;
  return { jsHeapUsedMB: round(get('JSHeapUsedSize') / 1048576), jsHeapTotalMB: round(get('JSHeapTotalSize') / 1048576), domNodes: get('Nodes') };
}

const perfState = (page) => page.evaluate(() => {
  const P = window.__perf;
  const nav = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
  const scripts = performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js'));
  return {
    milestones: P.milestones, painted: P.painted, lcp: P.lcp, fcp, longtasks: P.longtasks, events: P.events, hover: P.hover,
    domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
    jsBytes: scripts.reduce((n, r) => n + (r.decodedBodySize || 0), 0),
    jsFiles: scripts.map((r) => r.name.split('/').pop()),
    measures: performance.getEntriesByType('measure').filter((m) => m.name.startsWith('trm:')).map((m) => ({ name: m.name, start: m.startTime, duration: m.duration })),
  };
});

/** Long-task statistics up to `until` (ms since navigation start). */
function blocking(longtasks, until) {
  const lt = longtasks.filter((t) => t.start < until);
  return { longTaskCount: lt.length, longTaskTotalMs: round(lt.reduce((n, t) => n + t.duration, 0)), maxLongTaskMs: round(Math.max(0, ...lt.map((t) => t.duration))), tbtMs: round(lt.reduce((n, t) => n + Math.max(0, t.duration - 50), 0)) };
}

async function chartBox(page) {
  const chart = page.getByTestId('metric-chart-loss');
  await chart.scrollIntoViewIfNeeded();
  return chart.boundingBox();
}

async function waitFor(page, fn, timeout = 60_000) {
  await page.waitForFunction(fn, undefined, { timeout, polling: 100 });
}

async function scenarioList(browser) {
  const { context, page, cdp, errors } = await newPage(browser);
  await page.goto(`${BASE}/`);
  await waitFor(page, () => window.__perf.painted.listReady !== undefined);
  await sleep(1000);
  const s = await perfState(page);
  const memory = await heapAfterGc(cdp);
  await context.close();
  return {
    fcpMs: round(s.fcp), lcpMs: round(s.lcp), listDomMs: round(s.milestones.listReady), listPaintedMs: round(s.painted.listReady),
    ...blocking(s.longtasks, s.painted.listReady), jsBytesDownloaded: s.jsBytes, jsFiles: s.jsFiles, memory, errors,
  };
}

async function scenarioRun20(browser) {
  const { context, page, cdp, errors } = await newPage(browser);
  await page.goto(`${BASE}/runs/run-20`);
  await waitFor(page, () => window.__perf.painted.chartsReady !== undefined, 120_000);
  await sleep(1500);
  const s = await perfState(page);
  const load = {
    shellPaintedMs: round(s.painted.shell), loadingPaintedMs: round(s.painted.loading), dataReadyMs: round(s.milestones.dataReady),
    chartsDomMs: round(s.milestones.chartsReady), chartsPaintedMs: round(s.painted.chartsReady),
    ...blocking(s.longtasks, s.painted.chartsReady), jsBytesDownloaded: s.jsBytes, jsFiles: s.jsFiles,
    phases: Object.fromEntries(s.measures.map((m) => [m.name.replace('trm:', ''), round(m.duration)])),
  };
  const memory = await heapAfterGc(cdp);

  // Zoom: from the full range, click "Zoom in" (to half), then "Reset zoom" (back to full). 5 times.
  const zoomIn = [];
  const reset = [];
  for (let i = 0; i < 5; i++) {
    for (const [name, list] of [['Zoom in', zoomIn], ['Reset zoom', reset]]) {
      const before = await page.evaluate(() => window.__perf.events.length);
      await page.getByRole('button', { name }).click();
      await sleep(1200);
      const evs = await page.evaluate((n) => window.__perf.events.slice(n), before);
      const click = evs.filter((e) => e.name === 'click' || e.name === 'pointerup' || e.name === 'pointerdown');
      // The interaction latency is the longest event of the interaction (as INP defines it).
      list.push(click.length ? Math.max(...click.map((e) => e.duration)) : '<16');
    }
  }
  const xRange = await page.getByTestId('metric-chart-loss').evaluate((el) => [el.dataset.xMin, el.dataset.xMax]);

  // Hover: 30 fixed positions across the plot of the full-range loss chart.
  const box = await chartBox(page);
  const before = await page.evaluate(() => window.__perf.hover.length);
  for (let i = 0; i < 30; i++) {
    const x = box.x + GRID.left + ((i + 0.5) / 30) * (box.width - GRID.left - GRID.right);
    await page.mouse.move(x, box.y + box.height / 2);
    await sleep(150);
  }
  await sleep(500);
  const hover = await page.evaluate((n) => window.__perf.hover.slice(n), before);
  await context.close();
  const num = (xs) => xs.filter((x) => typeof x === 'number');
  return {
    load, memory, zoomInMs: zoomIn, resetMs: reset, xRangeAfterReset: xRange,
    hover: {
      moves: hover.length,
      processingMedianMs: round(median(hover.map((h) => h.processed - h.t0))),
      processingMaxMs: round(Math.max(...hover.map((h) => h.processed - h.t0))),
      nextFrameMedianMs: round(median(hover.map((h) => h.frame - h.t0))),
      nextFrameMaxMs: round(Math.max(...hover.map((h) => h.frame - h.t0))),
    },
    zoomInMedianMs: round(median(num(zoomIn))), resetMedianMs: round(median(num(reset))), errors,
  };
}

const TRACE_CATEGORIES = [
  'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack', 'toplevel', 'blink.user_timing', 'loading', 'latencyInfo',
  'v8.execute', 'disabled-by-default-v8.cpu_profiler', 'v8', 'blink', 'blink.console',
];

async function tracedPass(browser) {
  const files = {};
  const trace = async (name, fn) => {
    const { context, page, cdp } = await newPage(browser);
    const file = path.join(OUT, 'traces', `${name}.json`);
    await fn(page, cdp, async () => browser.startTracing(page, { path: file, screenshots: true, categories: TRACE_CATEGORIES }));
    await browser.stopTracing();
    const gz = `${file}.gz`;
    fs.writeFileSync(gz, zlib.gzipSync(fs.readFileSync(file)));
    fs.rmSync(file);
    files[name] = path.relative(process.cwd(), gz).replaceAll('\\', '/');
    await context.close();
  };
  await trace('01-list-load', async (page, _cdp, start) => {
    await page.goto('about:blank');
    await start();
    await page.goto(`${BASE}/`);
    await waitFor(page, () => window.__perf.painted.listReady !== undefined);
    await sleep(1000);
  });
  await trace('02-run20-load', async (page, _cdp, start) => {
    await page.goto('about:blank');
    await start();
    await page.goto(`${BASE}/runs/run-20`);
    await waitFor(page, () => window.__perf.painted.chartsReady !== undefined, 120_000);
    await sleep(1500);
  });
  await trace('03-run20-zoom-and-hover', async (page, _cdp, start) => {
    await page.goto(`${BASE}/runs/run-20`);
    await waitFor(page, () => window.__perf.painted.chartsReady !== undefined, 120_000);
    await sleep(1500);
    await start();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await sleep(1200);
      await page.getByRole('button', { name: 'Reset zoom' }).click();
      await sleep(1200);
    }
    const box = await chartBox(page);
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(box.x + GRID.left + ((i + 0.5) / 30) * (box.width - GRID.left - GRID.right), box.y + box.height / 2);
      await sleep(150);
    }
    await sleep(500);
  });
  return files;
}

function buildSizes() {
  const dir = 'dist/assets';
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js') || f.endsWith('.css')).map((f) => {
    const buf = fs.readFileSync(path.join(dir, f));
    return { file: f, bytes: buf.length, gzipBytes: zlib.gzipSync(buf).length };
  });
}

const server = await startServer();
try {
  const browser0 = await chromium.launch({ channel: 'chrome', headless: true });
  const environment = { chrome: browser0.version(), cpuThrottling: CPU_THROTTLING, viewport: VIEWPORT, headless: 'new headless (channel chrome)', cacheDisabled: true, node: process.version, date: new Date().toISOString() };
  await browser0.close();
  const runs = [];
  for (let i = 0; i < reps; i++) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const list = await scenarioList(browser);
    const run20 = await scenarioRun20(browser);
    await browser.close();
    runs.push({ list, run20 });
    console.log(`rep ${i + 1}/${reps}: list painted ${list.listPaintedMs} ms; run-20 charts painted ${run20.load.chartsPaintedMs} ms, TBT ${run20.load.tbtMs} ms; zoom ${run20.zoomInMedianMs} ms; hover ${run20.hover.processingMedianMs} ms; heap ${run20.memory.jsHeapUsedMB} MB`);
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const traces = await tracedPass(browser);
  await browser.close();
  const result = { label, environment, build: buildSizes(), runs, traces };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(result, null, 2));
  console.log(`wrote ${path.join(OUT, 'results.json')}`);
} finally {
  server.kill();
}
