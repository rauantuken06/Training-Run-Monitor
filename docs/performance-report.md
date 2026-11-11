# Performance report (Task 08)

## Summary

- **The freeze when opening the million-point run is mostly gone.** At 4× CPU throttling, main-thread blocking (TBT) dropped from **3,638 ms to 1,023 ms (−72%)**. The longest main-thread task dropped from **1,824 ms to 332 ms (−82%)**. Generation and analysis moved to a Web Worker.
- **The runs list downloads 61% less JavaScript** (950 → 371 kB) and paints 22% sooner: the charts and ECharts are now a separate chunk.
- **Zoom:** returning to a viewport already drawn (for example Reset) is 73–76% faster thanks to a model cache. Zooming to a **new** viewport improved only 13%, because downsampling a million points is still the main cost.
- **Not improved:** hover (about 12 ms per move) wasn't a bottleneck and wasn't changed. Main-thread JS heap with 1M points: 77.6 → 74.2 MB (−4%).
- **Important caveat:** DevTools CPU throttling **does not slow the Web Worker** (verified below). The run-20 "data ready" and "charts painted" improvements are therefore overstated for a genuinely slow CPU. The main-thread figures are not affected.

## Environment

| | |
| --- | --- |
| Hardware | Intel Core i3-1215U (8 logical CPUs), 7.7 GB RAM, Windows 11 Pro |
| Browser | Google Chrome 157.0.8103.39, new headless mode, driven by Playwright (`channel: 'chrome'`) |
| CPU throttling | **4×** via Chrome DevTools Protocol `Emulation.setCPUThrottlingRate`, the mechanism behind the DevTools "4× slowdown" setting. Verified: a busy loop took 41–63 ms at 1× and 212–298 ms at 4× |
| Other | 1280×900 viewport, device scale 1, HTTP cache disabled, production build served by `vite preview` |
| Traces | Chrome Tracing via Playwright `browser.startTracing` (the DevTools Performance recording backend). Categories include `devtools.timeline`, `blink.user_timing`, the V8 CPU profiler and screenshots. Files are `.json.gz` and load directly into the DevTools Performance panel |

The traces were recorded through automation, not by clicking Record in the DevTools UI. Throttling and tracing use the same Chrome facilities as the UI.

## Measurement protocol

`npm run build`, then `node scripts/perf/measure.mjs <label> 5` runs **5 repetitions**, each in a fresh browser. A separate **traced pass** follows, because tracing adds overhead. Times are in ms from navigation start, unless stated otherwise. An init script registers Long Task, Paint, LCP and Event Timing observers and DOM-milestone observers before any app code runs. "Painted" means: milestone in the DOM, then `requestAnimationFrame` → `setTimeout(0)` (after the next frame).

| # | Metric | Starts | Ends |
| --- | --- | --- | --- |
| 1 | Runs list first render | navigation to `/` | 20 table rows in the DOM, then next frame. FCP is also recorded |
| 2 | run-20 first render | navigation to `/runs/run-20` (cold, deep link) | "Loading…" painted, "Data quality" heading in the DOM, then all 3 chart lines drawn and painted |
| 3 | Zoom | click on **Zoom in** (full → half range), and on **Reset zoom**, 5 times each, in the same order | Event Timing `duration` of the click: input → handlers → next paint, as INP measures it |
| 4 | Hover | 30 pointer moves at fixed x positions across the full-range run-20 loss chart, 150 ms apart | pointermove input timestamp → end of dispatch (processing), and → after the next frame |
| 5 | Memory (1M points) | run-20 loaded and idle 1.5 s | JS heap after 2× `HeapProfiler.collectGarbage` (CDP `Performance.getMetrics` `JSHeapUsedSize`). Main thread only |
| 6 | Long tasks / blocking | navigation start | end of metric 1 or 2. TBT = Σ(long task − 50 ms) |
| 7 | Bundle size | — | Resource Timing JS bytes per page, plus build output sizes |

Bottleneck attribution: `node scripts/perf/analyze-trace.mjs <trace>` takes each main-thread long task and assigns every 0.1 ms to garbage collection, an instrumented phase (User Timing `trm:*`: generate, analyze, decode, downsample, option), style/layout, paint, or "other" (React render/commit, ECharts init/render, bundle evaluation). The User Timing instrumentation is two `performance.now()` calls per phase. It was added **before** the baseline and is identical in both builds.

## Before / after (median of 5 repetitions; min–max in brackets)

| Metric | Baseline | Optimized | Difference | Change |
| --- | --- | --- | --- | --- |
| Runs list: first contentful paint | 960 ms (868–1,392) | 780 ms (728–828) | −180 ms | −18.8% |
| Runs list: table painted | 978 ms (896–1,421) | 763 ms (710–859) | −215 ms | −21.9% |
| Runs list: total blocking time | 604 ms (533–829) | 433 ms (397–509) | −171 ms | −28.3% |
| Runs list: JS downloaded | 950 kB | 371 kB | −580 kB | −61.0% |
| Runs list: JS heap after GC | 3.5 MB | 2.3 MB | −1.2 MB | −34.3% |
| run-20: loading message painted | 798 ms (753–923) | 605 ms (603–641) | −193 ms | −24.1% |
| run-20: data ready ¹ | 3,208 ms (3,054–3,762) | 1,330 ms (1,315–1,416) | −1,879 ms | −58.6% |
| run-20: charts painted ¹ | 4,348 ms (4,072–5,022) | 2,530 ms (2,445–2,836) | −1,817 ms | −41.8% |
| run-20: total blocking time | 3,638 ms (3,343–4,292) | 1,023 ms (989–1,127) | −2,615 ms | **−71.9%** |
| run-20: longest main-thread task | 1,824 ms (1,619–2,035) | 332 ms (319–379) | −1,492 ms | **−81.8%** |
| run-20: JS heap after GC (main thread) ² | 77.6 MB | 74.2 MB | −3.4 MB | −4.4% |
| Zoom in, first click (new viewport) | 504 ms (488–520) | 440 ms (400–632) | −64 ms | −12.7% |
| Zoom in, repeated (viewport seen before) | 360 ms (312–424; n=20) | 144 ms (112–248; n=20) | −216 ms | −60.0% |
| Reset zoom, first click (full range) | 648 ms (640–680) | 176 ms (176–192) | −472 ms | −72.8% |
| Reset zoom, repeated | 528 ms (496–640; n=20) | 128 ms (112–224; n=20) | −400 ms | −75.8% |
| Hover: processing per move (median) | 12 ms (11–13) | 12 ms (10–13) | ≈0 | +4.3% (noise) |
| Hover: input → next frame (median) | 32 ms (30–32) | 31 ms (28–33) | ≈0 | −2.2% (noise) |
| Hover: input → next frame (max of 30) | 122 ms (114–140) | 122 ms (113–141) | ≈0 | +0.6% (noise) |

| Build output (JS) | Baseline | Optimized |
| --- | --- | --- |
| Main chunk (`index`) | 950.1 kB (gzip 317.4 kB) | 370.5 kB (gzip 117.6 kB) |
| Charts chunk (`RunCharts`, on demand) | — | 582.5 kB (gzip 200.9 kB) |
| Worker (`run.worker`) | — | 17.0 kB (gzip 6.2 kB) |

¹ **Overstated.** CDP CPU throttling slowed the main thread (busy loop 56–74 ms at 1× → 165–334 ms at 4×) but not a dedicated worker (41–42 ms at 1× → 41–96 ms at 4×). In the optimized trace the worker spent 511 ms (generate 301, analyze 177, encode 20), against 1,768 ms for generate+analyze on the throttled main thread in the baseline. **Estimate, not a measurement:** if the worker were slowed by the same factor (+~1.26 s), data ready would be about 2.6 s and charts painted about 3.8 s. That is still somewhat earlier than the baseline (fewer downsampling passes, smaller bundle), but the main gain is that the main thread stays responsive.
² The worker's heap is not included. The worker is terminated after each job (verified in Chrome: the `worker.close` event fires), so it retains nothing afterwards.

All 5 repetitions are included; none was dropped. Raw data: `docs/performance/{baseline,after}/results.json`. Table generated by `node scripts/perf/summarize.mjs baseline after` (`docs/performance/comparison.md`).

## Bottlenecks (from the traces)

run-20 cold load, traced pass at 4×, all main-thread long tasks combined:

| Bucket (ms) | Baseline | Optimized |
| --- | --- | --- |
| Data generation | 1,088 | 0 (worker: 301) |
| Integrity analysis | 680 | 0 (worker: 177) |
| Decode transferred columns | — | 136 |
| Downsampling (3 charts) | 827 (**each chart twice**) | 302 |
| Chart option building | 5 | 4 |
| Garbage collection | 254 | 54 |
| Style / layout | 357 | 386 |
| Paint | 15 | 21 |
| Other (React, ECharts init/render, bundle evaluation) | 1,333 | 987 |
| **Main thread busy (all tasks)** | **4,784** | **2,195** |

Findings:
1. **Generation, analysis and GC ran in one 2,014 ms main-thread task.** That's the freeze. A worker only helps if handing the data back is cheap. Measured in Chrome at 4×: structured-cloning 1M point objects to the main thread costs **~1.8 s** of main-thread work, while transferring typed-array columns costs about 0 ms, plus 105–148 ms to rebuild the objects. So the worker returns columns.
2. **Each chart downsampled twice on load.** It first used a guessed 640 px width, then re-ran with the measured width (trace: two `trm:downsample:*` measures per metric).
3. **About 830 ms of "other" script time on the runs list** was mostly evaluating a 950 kB bundle, about 580 kB of it chart code the list never uses.
4. **Zoom is dominated by downsampling all three charts** (traced click: about 470 ms, mostly `downsample`). Reset recomputed the full-range models already built at load.
5. **Hover is cheap.** pointermove dispatch median 1–2 ms; mousemove (ECharts tooltip) 17 ms median. Not optimized.

Trace artifact: each zoom/hover trace starts with a ~1.5 s task that's not present in the untraced runs. It's attributed to the CPU profiler starting, and excluded from conclusions.

## Changes

| Change | Why (evidence) | Correctness safeguards |
| --- | --- | --- |
| **Web Worker** for generation and analysis (`src/features/data/worker/`, `workerRunLoader.ts`) | Finding 1 | Lossless columns: Float64 plus a null mask, so NaN, ±Infinity, −0 and null stay distinct. Duplicate records are re-linked to the same point objects. Output equals the main-thread pipeline on all 20 runs (`runPayload.test.ts`). One worker per job, terminated when done or on navigation (cancellation). Errors and crashes become the visible error state. Stale results are ignored (`useRunAnalysis.worker.test.tsx`, `workerRunLoader.test.ts`, Chrome `performance-architecture.spec.ts`) |
| **Measure width before the first chart model** (`useElementWidth` in a layout effect) | Finding 2 | `RunCharts.perf.test.tsx`: one downsampling per chart at 1,000 px. Reverting the fix fails it |
| **Code splitting:** `RunCharts` and ECharts lazy-loaded, prefetched when a run page mounts, with an error boundary | Finding 3 | Chrome: the list requests no chart chunk; deep links and navigation still work; accessible "Loading the chart component…" placeholder |
| **Chart-model cache** per run view (8 entries, keyed by metric, viewport and budget) | Finding 4 (Reset) | The view is immutable and the model is a pure function, so it can't be stale. Reverting it fails the Reset test |
| **Downsampling inner loop:** one record lookup per point | Finding 4 | **Identical output** to the previous loop on 1,800 cases (all runs × metrics × budgets × viewports), plus the existing reference and property tests (165 pass). Node, used only to decide: −18% (full range), −24% (half range) |

The downsampling algorithm, its extrema guarantees and segments are unchanged. Nothing was smoothed, dropped or merged.

## Correctness after the changes

- **Unit tests:** 555 passed / 0 failed (517 before; 38 new tests for the worker, payload, loader and the redundant-work regressions).
- **E2E (Chrome):** 53 passed / 0 failed / 5 skipped. The skips are the 5 mobile tests that need a hardware keyboard, mouse drag or hover, as before.
- **Covered:** the exact spike pixel and tooltip (500,123 / 42.5) at full range and zoomed; NaN, Infinity and null markers; gap breaks; duplicate warnings; keyboard zoom; Task 07's race and stale-response tests; worker close-on-completion; rapid navigation.

## Remaining risks and unmeasured items

- **Worker throttling:** see note ¹. A real slow device would show more load time than the optimized row (but on the worker, not blocking the UI).
- **Tab memory:** only the main-thread JS heap was measured. The full renderer and GPU footprint (Chrome Task Manager "Memory footprint") was **not measured**. Manual check: open Task Manager (Shift+Esc), load `/runs/run-20`, wait 5 s, read the tab's memory footprint, and compare against the same on `/`.
- **Remaining main-thread work on run-20:** downsampling (~300 ms at 4×), ECharts first render (~300 ms), style/layout (~390 ms) and decoding (~136 ms). Zooming to a new viewport still takes about 440 ms at 4×. Further gains would need multi-resolution pre-aggregation or moving downsampling to the worker, which is a larger change.
- **Run cache:** the 1M-point run stays cached (≈74 MB) for the session, by design (Task 02).
- **Coverage:** one machine; headless Chrome; no GPU/frame-rate or real mobile-device profiling; no DevTools-UI recording.

## Evidence files

- `docs/performance/baseline/results.json`, `docs/performance/after/results.json`: all raw repetitions
- `docs/performance/{baseline,after}/traces/01-list-load.json.gz`, `02-run20-load.json.gz`, `03-run20-zoom-and-hover.json.gz`: Chrome traces (open in DevTools → Performance → Load profile)
- `docs/performance/{baseline,after}/traces/*.analysis.json`: per-trace bottleneck breakdowns
- `docs/performance/comparison.md` / `.json`: the before/after table
- Scripts: `scripts/perf/measure.mjs`, `scripts/perf/analyze-trace.mjs`, `scripts/perf/summarize.mjs`

To reproduce: `npm run build && node scripts/perf/measure.mjs <label> 5 && node scripts/perf/summarize.mjs baseline <label>`.
