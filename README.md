# Training Run Monitor

A web application for monitoring machine learning training runs. It shows loss, learning rate (`lr`) and gradient norm (`grad_norm`) across runs, and it surfaces data quality problems instead of hiding them.

The finished application will:

- display 20 synthetic training runs
- chart loss, `lr` and `grad_norm`
- detect and report `NaN`, `Infinity`, duplicate steps, unsorted steps and missing steps
- render a 1,000,000-point series efficiently while keeping isolated spikes visible
- support sorting, filtering, zoom, hover, accessibility and responsive layouts

## Technology stack

| Concern    | Tool                                            |
| ---------- | ----------------------------------------------- |
| UI         | React 19, TypeScript 5.8 (strict)               |
| Build      | Vite 6                                          |
| Styling    | Tailwind CSS 4 (`@tailwindcss/vite`)            |
| Routing    | React Router 7                                  |
| Charts     | Apache ECharts 6.1 (tree-shaken, SVG renderer) + `echarts-for-react` |
| Unit tests | Vitest 4, React Testing Library, happy-dom      |
| E2E tests  | Playwright                                      |
| Linting    | ESLint 9 (flat config) + `typescript-eslint` strict type-checked |

## Installation

Requires Node.js 20 or later. This project was set up with Node 24.13.1 and npm 11.8.0.

```bash
npm install
npx playwright install chromium   # only needed for e2e tests
```

If Playwright's browser download is blocked on your network, run e2e against a locally installed browser instead:

```bash
PW_CHANNEL=chrome npm run test:e2e    # or PW_CHANNEL=msedge
```

## Commands

| Command             | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Start the Vite dev server                                      |
| `npm run build`     | Type-check, then build for production into `dist/`             |
| `npm run preview`   | Serve the production build                                     |
| `npm run lint`      | Run ESLint                                                     |
| `npm run typecheck` | Run the TypeScript project build (`tsc -b`, no emit)           |
| `npm run test`      | Run unit/component tests once (Vitest, via `scripts/run-vitest.mjs`) |
| `npm run test:watch`| Run Vitest in watch mode                                       |
| `npm run test:e2e`  | Build, serve with `vite preview`, run Playwright (desktop + mobile Chromium) |

## Folder structure

```
.
├── e2e/                         Playwright specs
├── scripts/
│   └── run-vitest.mjs           Starts Vitest with a normalized Windows drive letter
├── src/
│   ├── app/                     App root, route table, path helpers
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   └── paths.ts
│   ├── components/
│   │   └── layout/              App shell (header, nav, main) and 404 page
│   ├── features/
│   │   ├── charts/
│   │   │   ├── components/      RunCharts, TrainingMetricChart, ChartControls, ChartStatus, ChartAccessibilitySummary
│   │   │   ├── hooks/           useElementWidth, usePrefersDark
│   │   │   ├── model/           Pure chart model: budget, viewport math, hover text, ECharts option
│   │   │   └── echarts.ts       Tree-shaken ECharts registration
│   │   ├── data/
│   │   │   ├── catalog/         The 20 run definitions (metadata + declared anomalies)
│   │   │   ├── downsampling/    Viewport-aware, extrema-preserving downsampling (segment-aware M4)
│   │   │   ├── generators/      Seeded PRNG, metric curves, deterministic generateRun
│   │   │   ├── integrity/       Validation, ordering, duplicates, gaps, chart view, summaries
│   │   │   ├── repository/      RunRepository: lazy, cached access to runs
│   │   │   ├── serialization/   JSON codec that keeps NaN / ±Infinity / null distinct
│   │   │   └── worker/          Web Worker job (generate + analyze) and lossless column transfer
│   │   └── runs/
│   │       ├── components/      Table, filters, status badge, metric cards, data quality, chart placeholder
│   │       ├── data/            RunDataContext, worker run loader (cancellable, cached)
│   │       ├── hooks/           useRunAnalysis (stale-safe loading), useDocumentTitle
│   │       ├── pages/           Runs list and run details pages
│   │       └── format.ts, labels.ts, runListQuery.ts   Formatting, labels, list search/filter/sort
│   ├── perf/                    User Timing instrumentation (trm:* measures in Chrome traces)
│   ├── test/                    Test setup, render helpers, controlled repository, references
│   ├── types/
│   │   └── training.ts          Domain types (points, runs, summaries, diagnostics)
│   ├── index.css                Tailwind entry and base styles
│   └── main.tsx                 Entry point
├── AGENTS.md                    Engineering rules
├── eslint.config.js
├── playwright.config.ts
├── tsconfig*.json
└── vite.config.ts
```

Later tasks will add these folders. They are not created yet, to avoid empty placeholders:

```
src/hooks/  src/utils/
```

### Type design (`src/types/training.ts`)

- `MetricValue = number | null`. A finite number is a normal reading. `NaN` and `±Infinity` are kept exactly as recorded. `null` means the value was not recorded. Values are never coerced to `0`.
- `TrainingRunMetadata` holds everything about a run except its points: ID, name, description, status, config, `scenarios`, the exact `pointCount`, and the declared `sampling` (`{ kind: 'fixed', interval }` or `{ kind: 'irregular' }`). It is cheap to list. `TrainingRun` extends it with `points`.
- `TrainingRun.points` holds the raw points in the order received. They may be unsorted, duplicated or have gaps.
- `ValueKind` classifies a metric value as `finite`, `nan`, `positive_infinity`, `negative_infinity` or `missing`.
- `DataQualityIssue` is a discriminated union on `kind`: `invalid_step`, `unsorted_step`, `duplicate_step`, `missing_steps`, `off_grid_step`, `nan`, `positive_infinity`, `negative_infinity`, `missing_value` and `non_finite_tail`. Every issue about a specific record carries its `sourceIndex` in the raw array.
- `DataQualityDiagnostics` aggregates the counts, per-kind issue counts and the full issue list.
- `MetricSummary` holds safe statistics (see [Summary rules](#summary-rules)).

## Synthetic dataset

### Architecture

```
RUN_DEFINITIONS (catalog/runCatalog.ts)       declarative; no points
        │  metadata + pointCount (computed, not generated)
        ▼
RunRepository (repository/runRepository.ts)   listRuns() / getRunMetadata()  never generate
        │  getRun(id): first call generates, later calls reuse the cache
        ▼
generateRun(def, seed) (generators/generateRun.ts)
   1. sample clean points on the grid 0, Δ, 2Δ, …   (curves.ts + seeded PRNG)
   2. value overrides / tails                       NaN, ±Infinity, null written as-is
   3. remove gap ranges
   4. duplicate points in duplicate ranges          each copy right after its original
   5. move delayed blocks out of order
```

- **Definitions are ground truth.** Every anomaly is listed explicitly in the run's definition: steps, metric and value. Later integrity checks can be tested against them. Generation throws if an anomaly step is not on the run's grid; it never ignores one silently.
- **Determinism.** Every random value comes from Mulberry32, seeded by `DATASET_SEED = 20251111` (`generators/random.ts`). Each run's seed is `deriveSeed(DATASET_SEED, runId)` (FNV-1a of the ID mixed with the root seed). Seeding by ID means reordering the catalog never changes any run's data. Value noise and anomaly noise use separate PRNG streams, so adding an anomaly doesn't shift the other values. `Math.random` is never called (a test spies on it).
- **Noise.** Loss and `grad_norm` use multiplicative log-normal noise (always positive). The normal samples are clipped to ±4σ, which puts a hard upper bound on noise, so no accidental outlier can look like an intended one. `lr` follows a noise-free linear warmup and then a cosine decay.
- **Raw-data integrity.** The generator never sorts, deduplicates, smooths or repairs anything. The order of points is part of the data.

### Run catalog

Unless noted, runs have 2,000 points at steps 0–19,990 (every 10 steps).

| ID | Name | Scenario | Status | Points | Declared anomalies |
| --- | --- | --- | --- | ---: | --- |
| run-01 | baseline-350m-lr3e-4 | healthy | completed | 2,000 | none |
| run-02 | lr6e-4-fast-converge | healthy | completed | 2,000 | none |
| run-03 | long-schedule-50k | healthy | completed | 5,000 | none (steps 0–49,990) |
| run-04 | small-model-125m-in-progress | healthy | running | 1,200 | none (steps 0–11,990) |
| run-05 | noisy-small-batch-bs32 | noisy | completed | 2,000 | loss noise σ = 0.12 (healthy: 0.015) |
| run-06 | noisy-no-warmup | noisy | completed | 2,000 | no warmup, loss noise σ = 0.08 |
| run-07 | plateau-lr-too-low | plateau | stopped | 2,000 | flattens at loss ≈ 3.4 |
| run-08 | plateau-frozen-backbone | plateau | stopped | 2,000 | flattens at loss ≈ 3.1 |
| run-09 | diverging-lr3e-3 | diverging | failed | 2,000 | exponential growth from step 12,000 (finite) |
| run-10 | diverging-grad-explosion | diverging | stopped | 2,000 | exponential growth from step 8,000 (finite) |
| run-11 | nan-loss-isolated | nan_loss | completed | 2,000 | loss = NaN at steps 4,200, 9,150, 15,000 |
| run-12 | nan-loss-fp16-overflow | nan_loss | failed | 2,000 | loss = NaN at every step ≥ 14,000 (600 points) |
| run-13 | inf-loss-isolated | infinite_loss | completed | 2,000 | loss = +Infinity at steps 6,000, 13,370 |
| run-14 | inf-loss-overflow | infinite_loss | failed | 2,000 | loss = +Infinity at every step ≥ 16,500 (350 points) |
| run-15 | duplicate-steps-multi-rank-logging | duplicate_steps | completed | 2,051 | steps 8,000–8,490 logged twice with conflicting values (50); step 12,000 logged twice, identically |
| run-16 | unsorted-steps-async-logger | unsorted_steps | completed | 2,000 | steps 5,000–5,090 arrive after 5,490; step 11,000 arrives after 11,500 |
| run-17 | missing-steps-logger-outage | missing_steps | completed | 1,699 | steps missing: 3,000–3,990, 12,500, 17,000–18,990 (301 total) |
| run-18 | missing-values-partial-metrics | missing_values | completed | 2,000 | `null`: lr at 2,000/2,010/2,020, grad_norm at 7,500, loss at 10,000 |
| run-19 | corrupted-log-mixed-anomalies | all six anomaly types | failed | 1,953 | NaN loss at 3,330; −Infinity loss at 7,770; null grad_norm at 9,990; gap 14,000–14,490; steps 6,000–6,020 logged twice; steps 10,000–10,040 arrive after 10,200 |
| run-20 | large-1m-steps-loss-spike | large_dataset, loss_spike | completed | 1,000,000 | one loss spike (below); steps 0–999,999 every step |

**Each anomaly type can be identified on its own.** A test-only detector, written separately from the generator, checks every run. It confirms that each run contains exactly the anomaly types in its `scenarios` and no others. For example, duplicate copies are placed directly after their originals, so the duplicate run is not also unsorted.

### The million-point run (`run-20`)

- 1,000,000 points with sequential steps 0–999,999. The loss decays smoothly from 4.0 towards 1.8 (e-folding time 120,000 steps), with clipped noise of σ = 0.02.
- **One spike: step `500,123` (array index 500,123), loss exactly `42.5`.** It is exported as `LARGE_RUN_SPIKE`.
  - It sits near the midpoint but is deliberately an odd number, not a multiple of 2, 5, 10, 100 or 1,000, so a naive stride-based downsampler would miss it.
  - It is about 23× the baseline at that step. The test checks it is more than 20× every neighbour within ±1,000 steps, and more than 5× the next-largest loss in the whole run.
  - Only loss spikes. `lr` and `grad_norm` at that step are ordinary.
- **No accidental spikes:** because noise is clipped at ±4σ, every other point is guaranteed to stay within ×e^(±0.08) of the noise-free baseline. A test checks this for all 999,999 other points.
- **Lazy and cached:** `listRuns()` and `getRunMetadata()` never generate points, because `pointCount` is computed from the definition. The million points are generated only on the first `getRun('run-20')`. After that the repository returns the same cached array, and concurrent requests share one generation.
- **Measured cost** (Node 24.13.1 on this Windows dev machine; generator bundled with esbuild, run with `node --expose-gc`, 3 fresh processes): generation took 347, 433 and 484 ms, and the generated points held 109.3 MB of heap after GC. These are Node figures; browser numbers have not been measured.

### Serialization

`JSON.stringify` writes `NaN` and `±Infinity` as `null`, which would make them look like missing values. `serialization/pointCodec.ts` (`encodePoints` / `decodePoints`, format `training-points/v1`) writes them as the strings `"NaN"`, `"Infinity"` and `"-Infinity"` and keeps `null` as `null`. Decoding is strict: unknown markers, numeric strings, missing fields or a wrong format tag all throw `PointDecodeError`, and nothing is coerced. The app doesn't need serialization yet; the codec exists so any future JSON export or fixture keeps these semantics. Structured clone (`postMessage`) preserves NaN and Infinity natively.

### Known limitations

- **Memory:** the million-point run is an array of 1,000,000 point objects, about 109 MB of heap in Node (measured above). The cache is never evicted. A compact columnar format (typed arrays, with a separate mask for `null`) would cut this a lot, but it belongs to the performance task.
- **Main thread:** generation is synchronous inside `getRun` and takes about 0.35–0.5 s in Node. `getRun` returns a Promise, so generation can move to a Web Worker later without changing the interface.
- **Anomaly definitions** must not overlap (a catalog test enforces this). Duplicate copies with `relogged` values don't inherit value overrides at the same step.
- **`-0`** would come back as `0` from the codec (plain JSON behaviour). The generator never produces `-0`.
- **Curves** are simple parametric shapes (exponential decay, warmup plus cosine decay, log-normal noise) that resemble real training curves. They are not fitted to real runs.

## Data integrity engine

`src/features/data/integrity/` turns a raw run into diagnostics, a chart-ready view and safe summaries. It is made of pure functions only: no ECharts, no React, no caching. The input is never mutated. Tests run it on deeply frozen points, so any write would throw.

```
analyzeRun({ id, sampling, points })                          analyzeRun.ts
 ├─ buildStepOrder(points)       invalid steps, unsorted records,      stepOrder.ts
 │                               ascending display index, duplicates
 ├─ findMissingSteps(...)        gaps and off-grid steps,             missingSteps.ts
 │                               from the declared sampling
 ├─ buildMetricView(...) ×3      continuous segments, non-finite      metricView.ts
 │                               positions
 ├─ summarizeMetric(...) ×3      safe statistics                      summary.ts
 └─ diagnostics                  every issue, with its source index
→ { diagnostics, view, summaries }
```

### Validation rules

- **Values** (`classifyValue`): a metric value is valid only if it is a finite number. `NaN`, `+Infinity`, `-Infinity` and `null` (not recorded) are four separate kinds and are never merged. Each invalid or missing value in every raw record produces one issue with its metric, step and `sourceIndex`. No value is ever converted to 0, clamped, interpolated or dropped.
- **Steps** (`isValidStep`): a step must be a finite, non-negative integer. Records with any other step (`NaN`, `±Infinity`, negative, fractional) can't be placed on an axis. They are left out of the display view and reported as `invalid_step` issues; their values still count in `counts`.
- **Order:** a record whose step is lower than the previous valid-step record's is reported as `unsorted_step`. The display view sorts numerically by step (ties by source index). It never sorts lexicographically, and it never reorders the source array.

### Duplicate-step policy

When several records share a step, **the display view shows the last one recorded** (the highest source index), and nothing is averaged or merged.

- The rationale: when a logger writes a step again (a retry, or a re-run after resuming), the later write is usually the one that replaced the earlier. The rule is fixed and doesn't depend on values, so it is deterministic and easy to explain.
- Every duplicate produces a `duplicate_step` issue. It holds all the original records (by reference), their `sourceIndices`, which one is displayed, and the `conflictingMetrics`: the metrics whose values differ, compared with `Object.is`, so `NaN` equals `NaN` but `NaN` ≠ `null`. With no conflicting metrics the duplicate is identical (severity `info`); otherwise it conflicts (severity `warning`).
- Hidden copies still count: `counts`, `min` and `max` include them, so an extreme value in a hidden copy is never concealed. Its `sourceIndex` shows where it came from.

### Missing-step policy

- Detection uses the **declared** `sampling` in the run metadata. It never infers spacing from the data, and it never assumes steps go up by 1. Catalog runs declare `{ kind: 'fixed', interval }` from their definitions, for example 10 for runs 01–19 and 1 for run-20.
- Under `fixed` sampling, the expected grid is `firstStep + k × interval`. Every grid step strictly between two present steps is missing and is reported as one `missing_steps` range (first/last missing step and count).
- A step that isn't on the grid is reported as `off_grid_step`. It never creates a false gap, because gaps count only grid steps.
- `irregular` sampling reports no missing steps at all. That avoids false gaps for intentionally sparse logging, but it also means a real outage in an irregular run goes undetected.
- Nothing is reported before the first or after the last present step; the expected start and end of a run aren't declared.
- An invalid declared interval (0, negative, fractional) throws instead of being guessed.
- Missing **steps** (no record at all) and missing **values** (`null` in a record) are separate issue kinds.

### Chart-ready view (`ChartView`)

- `displayIndex: Uint32Array` maps each display position (strictly ascending step, one per distinct valid step) to a source index in the raw points. It is the only large structure built; values are read through `stepAt` / `valueAt` from the original objects, so they are never copied.
- `metrics[m].segments`: a line may be drawn only inside a segment, a maximal range of finite values with no missing steps between them. Invalid values, `null`s and gaps always end a segment, so nothing is drawn across them.
- `metrics[m].nonFinite` lists each non-finite displayed position and its kind. `gaps` and `duplicates` carry their display positions and issues.
- Nothing is smoothed, interpolated or downsampled here; see [Downsampling](#downsampling). The view is plain data plus a typed array, so it can be passed to a Web Worker.

### Summary rules

| Field | Scope | Rule |
| --- | --- | --- |
| `counts` (`finite`, `nan`, `positiveInfinity`, `negativeInfinity`, `missing`) | every raw record | always sums to the record count |
| `invalidCount` | every raw record | `nan + positiveInfinity + negativeInfinity` (`missing` is separate) |
| `min`, `max` | finite values on records with valid steps, including hidden duplicate copies | `{ value, step, sourceIndex }`, or `null` if there are no finite values; ties keep the first in source order |
| `firstFinite`, `lastFinite` | display view | first/last finite value by step, or `null` |
| `last` | display view | the raw value at the highest step, with its kind; may be `NaN`, `±Infinity` or `null` |
| `endsNonFinite` | display view | `true` if `last` is not finite |

A run that ends invalid is never hidden: `last` shows the raw value, `endsNonFinite` is set, and a `non_finite_tail` issue (severity `error`) records where the trailing invalid stretch begins and how long it is. Empty and all-invalid runs return `null` statistics and zero counts; nothing is invented.

### Measured cost

Measured in Node 24.13.1 on this Windows dev machine, by bundling with esbuild and running with `node --expose-gc`, 3 fresh processes. These are Node numbers; browser numbers haven't been measured.

- **run-20 (1,000,000 records):** `analyzeRun` took 200, 212, 256 ms (3 runs). The result retained 3.8 MB of ArrayBuffer memory (the `displayIndex`) plus 0.2 MB of JS heap. No per-metric copies are made.
- **run-15 and run-19 (about 2,000 records each):** 6–7 ms.

### Known information-loss risks

- **Duplicates:** the chart shows one value per step. Conflicting copies are visible only through diagnostics and the duplicate markers, not as separate points.
- **Invalid steps:** records with invalid steps are left out of the view, and their finite values are left out of `min`/`max`. They are reported and counted, but not plotted.
- **Missing-step range:** missing steps before the first or after the last record are not detected. Irregular sampling disables gap detection entirely.
- **Off-grid steps** are displayed, but they skew the expected grid only if the *first* step is off-grid (the grid is anchored there).
- **Issue volume:** there is one issue object per invalid value. A run with millions of invalid values would produce millions of issue objects.

### Limitations not covered by automated tests

- Browser timing and memory (only Node was measured), and Web Worker transfer, which isn't implemented.
- Real-world log formats: the tests use the synthetic catalog plus hand-made and randomized fixtures.
- The randomized tests cover up to 60 records per case, with steps up to a few hundred; very large steps (beyond 2^53) aren't tested.
- Whether "last recorded wins" is the right display choice for a specific team's logging setup is a product decision, not something tests can prove.

## Downsampling

`downsampleMetric(view, metric, viewport, budget)` in `src/features/data/downsampling/downsample.ts` reduces one metric of a Task 03 `ChartView` to at most `budget` points for a step range. It is a pure function with no chart dependency.

### Algorithm: segment-aware M4

1. Binary-search the display view for the positions inside the inclusive viewport `[minStep, maxStep]`. No point outside the viewport is ever returned, so the line starts and ends at the first and last visible records rather than at the viewport edge.
2. Clip the integrity segments to those positions. Only segment points (finite values) are plottable.
3. Choose a method:
   - `all`: the visible points fit the budget. Everything is returned, `reduced: false`.
   - `m4`: split the viewport's step range into `B = floor(budget / 4) − segmentCount` equal-width buckets. Each piece (one bucket within one segment) keeps its **first, last, minimum and maximum** point, deduplicated and in step order.
   - `endpoints_and_extrema`: the budget is too small for even one bucket (`budget < 4 × (segmentCount + 1)`). Keep every segment's first and last point plus the viewport minimum and maximum. If that still exceeds the budget, return it anyway with a `budget_exceeded` warning rather than merging segments.
4. Report the visible invalid runs (consecutive non-finite values by kind, split at gaps), the missing-step ranges that overlap the viewport, the duplicates in the viewport that conflict on this metric, and warnings.

**Why this algorithm:** M4 (first/last/min/max per pixel column; Jugel et al., *M4: A Visualization-Oriented Time Series Data Aggregation*, VLDB 2014) is the standard way to reduce a line chart without losing its vertical extent. It is a superset of min/max bucketing; the first/last points keep the joins between columns honest. Buckets are equal **step** widths, not equal point counts, so they line up with screen columns even when sampling is irregular. With `budget ≈ 4 × plot width in px`, each bucket is about one pixel column. Every-Nth-point sampling would have dropped the run-20 spike, which sits on step 500,123, a step chosen not to be a multiple of 2, 5, 10, 100 or 1,000.

### Guarantees (each checked by the tests against an independent reference)

- **Exact extrema:** the minimum and maximum displayed finite values in the viewport are always in `points`, with their exact value, step and source index (`extrema.min` / `extrema.max`). This holds in every method, including over-budget results.
- **No invented data:** every point is an existing displayed record. Values are raw (`Object.is`-equal), never rounded, clamped, normalized, averaged or interpolated. Tiny, subnormal, negative, `-0`, huge and identical values are all kept exactly.
- **Order:** steps are strictly ascending.
- **Segments:** each output segment comes from exactly one integrity segment, and segments are never merged. Every visible segment keeps its first and last visible point. No line between two consecutive points of a segment crosses a `NaN`, `±Infinity`, `null` or missing step.
- **Markers:** every non-finite visible value is counted in `invalidRuns`, by kind. Gaps and conflicting duplicates in the viewport are listed with their Task 03 issues, which keep every raw record.
- **Budget:** `outputCount ≤ budget` unless a `budget_exceeded` warning is present. In that case `outputCount ≤ 2 × segments + 2`.
- **Validation:** non-finite bounds, `minStep > maxStep`, or a budget that isn't a positive integer throw a `RangeError`.
- **Determinism:** the same inputs always produce the same output.

### Duplicates: displayed vs raw extrema

Only the displayed copy of a duplicate step (the last recorded, per Task 03) is plotted, so `extrema` covers **displayed** values. Task 03's `MetricSummary.min/max` covers **all raw observations**, including hidden copies. The two can differ when duplicates conflict. When that happens in the viewport, the result has a `conflicting_duplicates` warning, and a `hidden_duplicate_outside_extrema` warning (with the record's source index and value) for every hidden finite copy that lies outside the plotted extrema. The hidden values themselves remain available in `conflicts[].records`.

### Complexity and point counts

- **Time:** O(log n + V + I + D + G). Here V is the visible display positions (each read once), I the visible non-finite samples, D the duplicates and G the gaps in the run. A viewport over the whole million-point run is linear in its 1,000,000 points. There is no precomputed pyramid, so cost does not go below O(V).
- **Space:** O(output + segments + invalid runs + conflicts). No per-metric or per-point copies of the run are made; points are read through the existing `displayIndex`.
- **Output size:** `min(inputCount, budget)` in the normal case. M4 emits up to 4 points per piece, and fewer where first/last/min/max coincide (e.g. about 2 for a constant series). On the noisy million-point run, budgets of 2,000 and 4,000 gave 1,995 and 3,989 points.
- **When the budget can't be met:** with more visible segments than about `budget / 2`, for example many isolated `NaN`s at a tiny budget, the integrity-preserving minimum (two endpoints per segment plus the extrema) is larger than the budget. That result is returned with `budget_exceeded` rather than merged or truncated.

### Benchmarks (Node, not a browser)

Measured on the real million-point run (`analyzeRun` done once beforehand; see Task 03 for its ~0.2 s cost), `metric = 'loss'`. Environment: Node 24.13.1 on this Windows dev machine, esbuild bundle, `node --expose-gc`, 5 warm-up calls, then the median of 21 calls, 3 separate processes.

| Viewport | Budget | Input points | Output points | Median time (3 processes) |
| --- | ---: | ---: | ---: | --- |
| full range, 1,000,000 steps | 2,000 | 1,000,000 | 1,995 | 19.0–19.8 ms |
| full range, 1,000,000 steps | 4,000 | 1,000,000 | 3,989 | 17.6–19.3 ms |
| 100,000 steps around the spike | 2,000 | 100,000 | 1,984 | 3.2–3.3 ms |
| 100,000 steps around the spike | 4,000 | 100,000 | 3,956 | 1.9–2.0 ms |
| 1,000 steps around the spike | 2,000 / 4,000 | 1,000 | 1,000 (`all`) | 0.03–0.33 ms |

The spike was kept in every measured result. **Memory:** the heap retained by one result was not reliably measurable this way: readings of 216–248 KB for the full-range results sat beside negative readings for small results, which is GC noise. The structure is O(output), a few thousand small objects. These are Node numbers, not Chrome DevTools numbers; browser profiling is Task 08.

### What downsampling can still lose

**Min/max preservation does not preserve every meaningful feature of a signal.** Within each bucket only the first, last, min and max points survive, so:

- the order and number of oscillations inside a bucket, and any local extremum that isn't the bucket's min or max (e.g. a second, smaller spike in the same bucket), are lost;
- the distribution of values (density, variance, outlier frequency) inside a bucket is not represented, so a bucket with one outlier and a bucket with many look the same;
- near the edge of the budget (`endpoints_and_extrema`), each segment is reduced to its endpoints plus the global extrema, so the shape within segments is lost;
- duplicate copies that aren't displayed are not plotted. They are reported, not drawn;
- invalid samples are summarized as runs (start, end, count per kind), not as individual markers;
- extrema are exact only per viewport; a bucket-level "spike" can't be told apart from a single noisy sample without zooming in.

### What the automated tests cannot prove

- That the output looks right on screen. Rendering, axis scaling and pixel alignment belong to later tasks; the tests check data, not pixels.
- That `budget ≈ 4 × width` is the best setting for a given chart library.
- Behaviour beyond the tested inputs: the randomized cases go up to 400 records, and the only large input is the synthetic million-point run.
- Browser performance, memory and main-thread impact (Task 08).

## Dashboard (Task 05)

### Pages

- **Runs list (`/`)**: one table row per run: name (a link) and ID, status as text, type (behaviour scenarios), declared anomalies, point count and creation date. Above it: search (name or ID), status filter, data-quality filter (all / no declared anomalies / any / a specific anomaly), sort (ID, name, status, point count) and order, plus Clear filters. A polite live region announces "Showing N of 20 runs". The whole query is kept in the URL (`?q=…&status=…&quality=…&sort=…&dir=…`), so reloads, Back, and the details page's "← All runs" link all restore it.
- **Run details (`/runs/:runId`)**: name, status, ID, description, total observations, creation date, declared scenarios and configuration appear immediately, from metadata. Then:
  - three metric cards (loss, lr, grad_norm)
  - the data quality report
  - three interactive charts (see [Charts](#charts-task-06)); labelled placeholders keep the layout stable while data loads
- An unknown ID shows "Run not found" without requesting any data.

### Where the numbers come from

- The list uses **metadata only** (`listRuns()`); no run's points are loaded or analyzed. Its data-quality column is the anomaly set **declared** in the run metadata and is labelled as such. Detected issues are computed only when a run is opened. The list shows no metric values because computing them would mean loading all 20 runs, including the million-point one.
- The details page loads exactly one run with `repository.getRun(id)` and runs the Task 03 `analyzeRun` once. The cards and the report show `MetricSummary` and `DataQualityDiagnostics` directly; the UI computes no statistics of its own.
- Values are shown at 5 significant digits (scientific notation below 1e-3 or from 1e5). The exact raw value is kept in each `<data value>` attribute and tooltip. `NaN`, `+Infinity`, `-Infinity` and `Not recorded` are spelled out in red, never shown as 0. When a metric's last recorded value is invalid, its card shows a warning, and the report shows an error naming the trailing invalid stretch.
- The data quality report groups issues into categories (invalid values, missing measurements, missing steps, duplicates, out-of-order records, plus invalid/off-grid steps when present). Each category has a count, a severity written as text, and a breakdown, for example "50 conflicting · 1 identical". Details sit behind a native `<details>` element and list at most 10 entries, with "N more not shown". Conflicting duplicates come first and show every raw record's value, which one is displayed, and which are hidden.

### Loading and asynchronous behaviour

- `useRunAnalysis(runId)` returns `loading`, `ready`, `not_found` or `error`, with a retry. Stale responses are ignored in two ways: each request has an `active` flag that its cleanup turns off, and a state belonging to a different run ID is never returned, not even for a single render. The details page also remounts per run (`key`). Hook-level tests check both guards without a remount; removing either one fails a test.
- Analysis runs once per load, inside the effect rather than during render, and is memoized per run object (`WeakMap`). The repository returns the same immutable run object again, so re-opening a run reuses its analysis, and a cache entry can't belong to other data.
- **The Promise does not prevent blocking.** `getRun` returns a Promise, but generation and analysis are synchronous main-thread work. The hook waits for a `requestAnimationFrame` and then a timer before starting, so the loading state is painted first. After that, the page is unresponsive while the work runs. Measured in Chrome via Playwright on this machine by recording animation frames during navigation (not a DevTools profile):
  - **run-20:** the loading state was painted (2–3 frames, the first 64–74 ms after the click), followed by a **450 ms** gap without frames.
  - **run-12:** no gap longer than 17 ms.
  - The details page warns about this for runs of 100,000 points or more. Moving the work to a Web Worker belongs to the performance task.

### Accessibility and responsiveness

- **Structure:** semantic landmarks (one banner, primary nav, main, search form), one `h1` per page, then `h2` sections and `h3` cards. Every control has a `<label>`, and the table has a caption with `scope`d headers.
- **Sorting:** the sort headers are buttons, and their column headers carry `aria-sort`.
- **Status messages:** loading uses `role="status"`, and errors use `role="alert"`.
- **Never color alone:** status, severity and invalid values are always written as text; color is secondary.
- **Kept from Task 01:** the skip link and visible focus rings.
- **Small screens:** the table sits in a focusable, labelled scroll region, so it scrolls sideways itself instead of widening the page. Filters and cards reflow from 1 column to 2 or 3. Measured in Chrome at 1440, 820 and 390 px: no horizontal page overflow on the list or on the details pages checked.

### Limitations

- **Main thread:** the million-point run blocks it for about 0.45 s when opened (see above).
- **List columns:** the list shows declared anomalies and no metric values (by design, to avoid loading every run).
- **Accessibility checks:** contrast was chosen from Tailwind's 700–900 text on 50–100 backgrounds, but not measured with an automated contrast tool, and no screen-reader testing was done.
- **Dark mode:** styled, but not screenshot-checked.
- **Bundle size:** the JS bundle grew from 320.80 kB to 365.18 kB (115.54 kB gzipped) because the UI now includes the data layer.

## Charts (Task 06)

### Architecture

```
RunCharts (shared viewport state, ChartControls)
 └─ TrainingMetricChart ×3 (loss, lr, grad_norm)
     ├─ useElementWidth → budgetForWidth(width) = 4 × plot-width px (clamped 16…20,000)
     ├─ buildChartModel(view, metric, viewport, budget)   ← Task 04 downsampleMetric, nothing else
     ├─ buildEChartsOption(model, theme, tooltipFormatter)
     ├─ ChartStatus (warnings) · role="img" chart with text name · ChartAccessibilitySummary
     └─ ReactEChartsCore (one ECharts instance per chart; option updates with notMerge, no re-init)
```

- `src/features/charts/model/` is pure, with no React. It only arranges what `downsampleMetric` returns, so every plotted coordinate is an existing record's exact `(step, value)`. Summary numbers on the page still come from Task 03.
- **When downsampling runs:** the model is memoized on (run view, metric, viewport, budget), so downsampling reruns only on zoom, pan, reset or a width change. Hover and drag movement only read the existing model; a test spies on `downsampleMetric` during 100+ pointer moves and tooltip calls and confirms no extra call. The integrity analysis is never rerun (it comes from Task 05's `useRunAnalysis`).
- **One viewport for all three charts:** zooming any chart or using the controls zooms all of them. A newly opened run starts at its full range (the charts are keyed by run ID).

### Rendering policy (truthfulness)

- **One ECharts line series per downsampled segment.** A line can only connect consecutive points of one segment, so it never bridges `NaN`, `±Infinity`, `null` or a missing step. This doesn't rely on `connectNulls`; the Chrome tests count the drawn line paths (run-11: 4, run-17: 4, run-19: 4) and they equal the segment count.
- **Fidelity settings:** `smooth: false`, no `sampling` setting, `connectNulls: false` and `animation: false`, plus linear value axes only. A one-point segment, such as an isolated value between two NaNs, is drawn as a symbol so it stays visible.
- **Axes:** the x-axis is the step (labels like `1,000,000`; integer viewport bounds; `minInterval: 1`). The y-axis spans the **exact viewport extrema** plus 5% padding, so nothing can be clipped. Each side is padded independently, so values near ±`Number.MAX_VALUE` never collapse the axis. The padded ends are not labelled, because they aren't data values. Labels use the same 5-significant-digit format as the tooltips and cards, so `3e-5` stays `3e-5`, never `0`. Locale and number formatting are fixed (`en-US`); no dates are involved.
- **Invalid values (no y-coordinate):**
  - never drawn as points
  - a single invalid step is a dashed red vertical line, and a stretch is a red band, labelled with text: `NaN`, `+Inf`, `-Inf`, `null`, `NaN ×600`
  - **missing steps:** a grey band labelled `gap ×N`
  - **conflicting duplicates:** a ▲ rug along the bottom edge at each step; the plotted value is the displayed (last-recorded) copy, and the hover shows all values
  - all of these come from the downsampler's reports for the whole viewport, so a marker never disappears because its neighbours weren't sampled
  - each chart also lists its warnings in text above it. Markers are capped at 100 per kind (the text says when), and labels are hidden when more than 24 markers would crowd the plot
- **Plot area:** fixed margins with `outerBoundsMode: 'none'`. ECharts 6's default layout shifted the plot by ~16 px in Chrome, which would have made both the drawn spike position and the drag-to-zoom mapping wrong; the browser geometry tests caught it.

### Zoom and hover

- **Mouse:** drag horizontally across a chart to zoom into that step range. A selection band follows the drag, and the zoom (and downsampling) happens once, on release. Drags under 6 px are ignored. Wheel zoom is deliberately not used, so it can't hijack page scrolling.
- **Keyboard:** Zoom in (½ span), Zoom out (2×), Pan left/right (¼ span), Reset zoom, and an exact **From/To step** form. A polite live region announces "Showing steps A–B of C–D".
- **Tooltips:**
  - show the plotted observation nearest the cursor, with its exact step and value (exact digits added when rounding changed them), plus warnings for conflicting duplicates, nearby invalid stretches and a gap under the cursor
  - when the line is downsampled, they say "N of M observations plotted; zoom in to see every one", so the line isn't presented as containing every observation
  - the cursor step is tracked in the capture phase, because ECharts reports the nearest data point's x as `axisValue`; using it hid gaps under the cursor (found in Chrome, now covered by a regression test)
  - all tooltip text is HTML-escaped

### Spike evidence (run-20, step 500,123, loss 42.5)

- **Unit and component tests:** the spike is in the drawn series data at full range for widths of 390–1,920 px, and after zooming to spans from 500,000 down to 0 steps at five positions. The y-axis maximum is always ≥ 42.5. A viewport starting one step after the spike neither draws it nor scales for it.
- **Chrome (Playwright, SVG geometry):** a drawn vertex sits at the exact pixel computed from the axis model for (500,123, 42.5): **0 px** distance at 390, 820 and 1,280 px wide, at full range and zoomed to 300 and 20 steps. The hover tooltip reads "Step 500,123 / Loss: 42.5".

### Rendering limits found in the browser

- zrender (ECharts' renderer) merges consecutive line vertices that lie within 2 device pixels of the previous vertex in **both** x and y, keeping the farthest one. A large jump like the spike always survives. In one measurement at 390 px, the run-20 minimum was drawn 0.7 px from its exact position (0.52 px at 820 px); after the margin change it measured 0 px at all three widths. This is not configurable through ECharts' public options.
- Hover precision is limited by pixels: when one pixel spans several steps, the tooltip shows the observation nearest the cursor. To hover one specific step, zoom until steps are a few pixels apart.
- At wide zoom levels a single-step break, for example at one NaN, can be narrower than a pixel. The labelled marker and the warning text make it visible.

### Accessibility

- **Charts:** each chart is a named region ("Loss chart"; the summary cards keep "Loss") holding a `role="img"` element. Its accessible name is a text summary: visible step range, plotted vs total observations, and min/max with steps. The same summary is shown as visible text, and warnings are text lists. Markers carry text labels, so color is never the only cue.
- **Controls:** all zoom controls are native buttons and labelled inputs with visible focus. Disabled states reflect the limits, for example Reset is disabled at the full range.
- **Theme:** colors follow `prefers-color-scheme`. The dark theme is defined but has not been screenshot-checked.

### Known limitations

- **Bundle:** the JS bundle is **947.24 kB (316.30 kB gzipped)**, up from 365.19 kB, because ECharts ships in the main chunk; the runs list doesn't need it. Lazy-loading the charts is left for the performance task.
- **Main thread:** opening run-20 still blocks it for about 0.45 s (Task 05 measurement). Each zoom on run-20 reruns `downsampleMetric` for three metrics (Node: about 19 ms each at full range; browser cost not profiled).
- **Touch:** touch users zoom with the buttons and the range form; touch dragging scrolls the page by design.
- **Scale:** there is no log scale. Linear only, by choice: a log scale would need explicit handling of zero and negative values, and none of the metrics required it.
- **Visual review:** automated checks cover geometry, markers, tooltips and overflow. Dark-mode rendering, screen-reader output and visual density at very large marker counts need manual review.

## Reliability audit (Task 07)

The full matrix (status, evidence, tests, limitations per risk) is in [docs/silent-failures-audit.md](docs/silent-failures-audit.md). In short:

- **4 defects found and fixed:** the range form misread "5.000" as step 5; it also silently showed a different range when the request was outside the data; the tooltip headline presented a neighbouring step as the hovered one; and y-axis ticks printed identical labels for tiny ranges (run-20 lr).
- **Clarity fixes:** dates are labelled UTC (they were already UTC-correct in every timezone), and the summary cards say they cover the whole run.
- **Passed without changes:** request races (A → B → C in either completion order), superseded errors, unmounting, stale cache, error after success, smoothing/sampling, divergence, reset, linear-only axes and number formatting.
- **Policies:**
  - **Formatting is fixed to en-US** for all numbers, independent of the browser locale.
  - **Dates are shown in UTC.**
  - **Steps are not timestamps.**
  - **Typed steps are whole numbers:** digit groups may use `,` or spaces, and a `.` is rejected rather than guessed.

## Performance (Task 08)

Full report, protocol and evidence: [docs/performance-report.md](docs/performance-report.md). Measured in Chrome 157 with 4× CPU throttling (DevTools Protocol), 5 repetitions per build, plus genuine Chrome traces in `docs/performance/`.

- **Opening the million-point run:** main-thread blocking fell from 3,638 to 1,023 ms (−72%), and the longest task from 1,824 to 332 ms. Generation and analysis now run in a **Web Worker**, which returns lossless typed-array columns. Posting 1M objects would have cost ~1.8 s of main-thread deserialization.
- **Runs list:** downloads 371 kB of JS instead of 950 kB, because the charts and ECharts are **lazy-loaded**.
- **Charts:** each chart now downsamples once on load, not twice. A per-run model cache makes Reset/revisited zooms 73–76% faster. A leaner downsampling loop produces identical output.
- **Caveat:** DevTools CPU throttling does not slow Web Workers, so the end-to-end load gains are overstated for slow devices; the report quantifies this. Hover was not a bottleneck and is unchanged. Zoom to a *new* viewport improved only 13%.

Reproduce: `npm run build && node scripts/perf/measure.mjs <label> 5 && node scripts/perf/summarize.mjs baseline <label>`.

## Final QA (Task 09)

Full matrix, evidence and remaining risks: [docs/final-qa-report.md](docs/final-qa-report.md). Screenshots, memory data and e2e logs are in [docs/qa/](docs/qa/).

- **Fixed (each with a regression test):**
  - Fast typing in the search box dropped characters, because the input followed the asynchronously updated URL.
  - Light-theme chart axis lines were below WCAG 1.4.11 contrast (2.56:1, now 4.76:1).
  - A run worker that never answered left the page loading forever. It now times out after 60 s and offers Retry.
- **Accessibility:** axe (WCAG 2.0–2.2 A/AA) finds 0 violations in light and dark mode. Chart contrast, focus visibility, keyboard order and reflow at 320/640 px were also checked by hand. This is not a certification: **no screen reader was tested** (none installed).
- **Browsers:** the full e2e suite passes in Chrome, Edge and Playwright's Firefox (`PW_BROWSER=firefox npm run test:e2e`).
  - Firefox runs with 2 workers and longer axe time limits, because axe is slow there.
  - Six axe rules are skipped on one Firefox state, because they crash Playwright's Firefox. The report documents this.
  - Safari and real mobile devices are untested.
- **Memory (Chrome 157, run-20 open):** the tab's renderer uses about 125 MB private memory (peak while loading: about 225 MB); the JS heap is 74.9 MB. Measure with `npm run build && node scripts/perf/tab-memory.mjs` (Windows only).

## Current implementation status

**Task 01 (project foundation): complete.**

- [x] Vite + React + TypeScript (strict) + Tailwind + ESLint
- [x] Domain types for points, runs, summaries and data quality diagnostics
- [x] Routes: `/` (runs list placeholder), `/runs/:runId` (details placeholder), plus a catch-all 404
- [x] App shell: header, primary nav, skip link, `<main>` landmark, responsive container, visible focus rings
- [x] Vitest + React Testing Library unit tests, Playwright e2e specs

**Task 02 (synthetic data layer): complete.**

- [x] 20 deterministic runs with declared anomalies, plus the million-point run with one documented spike
- [x] Lazy, cached `RunRepository`; JSON codec that keeps invalid-value semantics
- [x] Unit tests for every requirement (see `src/features/data/**/*.test.ts`)

**Task 03 (data integrity engine): complete.**

- [x] Pure `analyzeRun` that validates values and steps, applies the duplicate policy, detects missing steps, and builds a chart-ready index view and safe summaries
- [x] Unit tests on the real datasets, edge-case fixtures, and 400 seeded randomized property cases

**Task 04 (downsampling): complete.**

- [x] Pure `downsampleMetric(view, metric, viewport, budget)`: segment-aware M4 with exact extrema, source indices, invalid-value and gap markers, duplicate conflicts, and budget warnings
- [x] Tests against an independent brute-force reference: real datasets, the million-point spike at many zoom levels, edge cases, and 300 randomized cases
- [x] Node benchmarks (below)

**Task 05 (dashboard): complete.**

- [x] Runs list: search, sort, status and data-quality filters, clear, empty states, URL-persisted query
- [x] Run details: metadata, metric summary cards, grouped data quality report, chart placeholders
- [x] Loading, error (with retry), unknown-run and empty states; stale-response protection
- [x] Unit/component tests on real data, plus Playwright tests in Chrome (desktop and mobile)

**Task 06 (charts): complete.**

- [x] Loss, lr and grad_norm charts from Task 04 downsampling: one series per segment, exact extrema, labelled invalid/gap/duplicate markers
- [x] Shared zoom: drag-to-zoom, keyboard buttons, exact range form, reset; tooltips at the real cursor position
- [x] ECharts upgraded to 6.1.0 (XSS advisory resolved)
- [x] Unit/component tests, plus Chrome tests that measure the drawn SVG geometry

**Task 07 (reliability audit): complete.** See [docs/silent-failures-audit.md](docs/silent-failures-audit.md).

**Task 08 (performance): complete.** See [docs/performance-report.md](docs/performance-report.md).

**Task 09 (final QA): complete.** See [docs/final-qa-report.md](docs/final-qa-report.md).

Not implemented yet (later tasks): deployment.

### Known notes

- `npm run test` starts Vitest through `scripts/run-vitest.mjs`. On Windows, Vitest 4 loads its own module twice when the shell's working directory uses a lower-case drive letter (`c:\…`, which VS Code's terminal often uses). Tests then fail with `Invalid Chai property` or `Cannot read properties of undefined (reading 'config')`. The wrapper relaunches Vitest from the same folder with an upper-case drive letter. It has no effect on macOS/Linux. Calling `npx vitest` directly from a `c:\` shell still hits the bug.

- Unit tests use **happy-dom** instead of jsdom. With jsdom, React Router's data-router navigation threw `RequestInit: Expected signal to be an instance of AbortSignal`, because jsdom's `AbortSignal` is a different class from the one Node's `Request` (undici) expects. happy-dom ships matching implementations of both.
- The skip-link e2e test is skipped on the mobile project on purpose, because it exercises hardware-keyboard Tab navigation.
- Production SPA hosting must rewrite unknown paths to `index.html` so `/runs/:runId` deep links work. This is handled by `vite preview` locally; it will be configured during the deployment task.

## Dependency security (`npm audit`, 2026-11-11)

**Changes made:**
- `vitest` 3.2.7 → 4.1.12. Fixes 2 critical `tinypool` advisories (Vitest 4 no longer depends on `tinypool`) and 2 moderate `@vitest/mocker` advisories. 4.1.12 is the smallest version that fixes them; `npm audit fix --force` would have installed 5.1.0.
- `happy-dom` 20.14.6 → 21.0.4. Fixes 2 high advisories.

Both are dev-only test tooling. No production dependency was changed.

**Task 06:** `echarts` 5.6.0 → 6.1.0 fixes [GHSA-fgmj-fm8m-jvvx](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx) (XSS, moderate), the only production finding. `echarts-for-react` 3.0.6, the latest, declares `echarts: "^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0"`, so the upgrade stays within its supported range. It was verified by the build, the unit tests and Chrome rendering. Tooltip HTML is built only from escaped text (`escapeHtml`), never from raw strings.

**Remaining (7 moderate, 0 high, 0 critical), all dev-only:**

| Package | Scope | Advisory | Why it remains |
| --- | --- | --- | --- |
| `minimatch` 10.2.6 (via `@typescript-eslint/typescript-estree`) | Dev (lint only) | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), ReDoS via glob patterns | `typescript-eslint` 8.72.2 is the latest release and requires `minimatch ^10.2.2`. The audit "fix" would *downgrade* `typescript-eslint` to 8.36.0. Exposure is limited to glob patterns written in our own ESLint config. The other 6 findings are the `@typescript-eslint/*` packages listed only because they depend on this `minimatch`. |
