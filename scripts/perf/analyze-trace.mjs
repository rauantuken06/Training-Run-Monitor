/**
 * Bottleneck attribution from a genuine Chrome trace (Task 08).
 *
 *   node scripts/perf/analyze-trace.mjs docs/performance/<label>/traces/<file>.json.gz
 *
 * Works on the renderer main thread (CrRendererMain with the most task time):
 * - long tasks (RunTask > 50 ms), each broken down into instrumented phases
 *   (User Timing `trm:*` measures), GC, style/layout, paint, and "other" (the rest:
 *   React render/commit, ECharts init/render, bundle evaluation, framework code)
 * - EventDispatch durations per event type (click, pointermove, mousemove)
 * - task time on any worker threads (DedicatedWorker)
 * Overlaps are resolved by attributing each microsecond of a long task to at most one
 * bucket, with priority: GC > instrumented phase > style/layout > paint > other.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
const raw = fs.readFileSync(file);
const trace = JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8'));
const events = trace.traceEvents ?? trace;

const threadNames = new Map();
for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args.name);
const key = (e) => `${e.pid}:${e.tid}`;
const runTasks = events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && typeof e.dur === 'number');
const busy = new Map();
for (const t of runTasks) busy.set(key(t), (busy.get(key(t)) ?? 0) + t.dur);
const mains = [...busy].filter(([k]) => threadNames.get(k) === 'CrRendererMain').sort((a, b) => b[1] - a[1]);
if (!mains.length) throw new Error('no renderer main thread found');
const main = mains[0][0];
const onMain = (e) => key(e) === main;
const ms = (us) => Math.round(us / 100) / 10;

// User Timing measures (async begin/end pairs, possibly nestable), with the emitting thread.
const allPhases = [];
const open = new Map();
for (const e of events) {
  if (!String(e.cat).includes('blink.user_timing') || !String(e.name).startsWith('trm:')) continue;
  const id = `${key(e)}:${e.name}:${e.id ?? e.id2?.local ?? ''}`;
  if (e.ph === 'b' || e.ph === 'B') open.set(id, e.ts);
  else if ((e.ph === 'e' || e.ph === 'E') && open.has(id)) {
    allPhases.push({ name: e.name.slice(4), start: open.get(id), end: e.ts, thread: key(e) });
    open.delete(id);
  } else if (e.ph === 'X') allPhases.push({ name: e.name.slice(4), start: e.ts, end: e.ts + e.dur, thread: key(e) });
}
// Only measures emitted on the main thread are attributed to main-thread tasks;
// worker measures (generation/analysis after Task 08) are reported separately.
const phases = allPhases.filter((p) => p.thread === main);
const workerPhases = allPhases.filter((p) => p.thread !== main);
const kindOf = (name) => name.split(':')[0];

const sliceEvents = (names) => events.filter((e) => onMain(e) && e.ph === 'X' && names.includes(e.name)).map((e) => ({ start: e.ts, end: e.ts + e.dur }));
const gc = sliceEvents(['MinorGC', 'MajorGC', 'V8.GC_SCAVENGER', 'V8.GC_MC_BACKGROUND_EVACUATE_COPY', 'BlinkGC.AtomicPhase', 'V8.GCFinalizeMC', 'V8.GCScavenger']);
const layout = sliceEvents(['Layout', 'UpdateLayoutTree', 'RecalculateStyles', 'PrePaint', 'Layerize']);
const paint = sliceEvents(['Paint', 'PaintImage', 'Commit', 'UpdateLayer', 'CompositeLayers']);

/** Microseconds of [s, e) covered by intervals, with intervals already claimed excluded. */
function attribute(s, e) {
  const buckets = { gc: 0, layout: 0, paint: 0, other: 0 };
  const phaseTime = {};
  // Walk in 0.1 ms slots: accurate to 0.1 ms and simple to verify.
  const STEP = 100;
  for (let t = s; t < e; t += STEP) {
    const mid = t + STEP / 2;
    const inside = (iv) => iv.start <= mid && iv.end > mid;
    if (gc.some(inside)) buckets.gc += STEP;
    else {
      const ph = phases.find((p) => onMainWindow(p) && inside(p));
      if (ph) phaseTime[kindOf(ph.name)] = (phaseTime[kindOf(ph.name)] ?? 0) + STEP;
      else if (layout.some(inside)) buckets.layout += STEP;
      else if (paint.some(inside)) buckets.paint += STEP;
      else buckets.other += STEP;
    }
  }
  return { ...Object.fromEntries(Object.entries(phaseTime).map(([k, v]) => [k, ms(v)])), gc: ms(buckets.gc), styleLayout: ms(buckets.layout), paint: ms(buckets.paint), other: ms(buckets.other) };
}
// User timing events are emitted on the main thread's pid; accept any (they come from the page).
const onMainWindow = () => true;

const t0 = Math.min(...runTasks.filter(onMain).map((t) => t.ts));
const mainTasks = runTasks.filter(onMain).sort((a, b) => a.ts - b.ts);
const longTasks = mainTasks.filter((t) => t.dur > 50_000).map((t) => ({
  startMs: ms(t.ts - t0),
  durationMs: ms(t.dur),
  breakdown: attribute(t.ts, t.ts + t.dur),
}));

const totals = {};
for (const lt of longTasks) for (const [k, v] of Object.entries(lt.breakdown)) totals[k] = Math.round(((totals[k] ?? 0) + v) * 10) / 10;

const dispatch = {};
for (const e of events) {
  if (!onMain(e) || e.name !== 'EventDispatch' || e.ph !== 'X') continue;
  const type = e.args?.data?.type;
  if (!['click', 'pointermove', 'mousemove', 'pointerdown', 'pointerup'].includes(type)) continue;
  (dispatch[type] ??= []).push(e.dur / 1000);
}
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { count: s.length, medianMs: Math.round(q(0.5) * 10) / 10, p95Ms: Math.round(q(0.95) * 10) / 10, maxMs: Math.round(s.at(-1) * 10) / 10 };
};

const workers = [...busy].filter(([k]) => /Worker/.test(threadNames.get(k) ?? '')).map(([k, us]) => ({ thread: threadNames.get(k), busyMs: ms(us) }));

console.log(JSON.stringify({
  file,
  mainThreadBusyMs: ms(busy.get(main)),
  longTaskCount: longTasks.length,
  longTaskTotalMs: Math.round(longTasks.reduce((n, t) => n + t.durationMs, 0) * 10) / 10,
  longTaskBreakdownTotalsMs: totals,
  longTasks,
  eventDispatch: Object.fromEntries(Object.entries(dispatch).map(([k, v]) => [k, stats(v)])),
  workerThreads: workers,
  workerPhases: workerPhases.map((p) => ({ name: p.name, thread: threadNames.get(p.thread) ?? p.thread, durationMs: ms(p.end - p.start) })),
}, null, 1));
