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
| Charts     | Apache ECharts 5 + `echarts-for-react` (installed, not used yet) |
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
│   │   ├── data/
│   │   │   ├── catalog/         The 20 run definitions (metadata + declared anomalies)
│   │   │   ├── generators/      Seeded PRNG, metric curves, deterministic generateRun
│   │   │   ├── integrity/       Validation, ordering, duplicates, gaps, chart view, summaries
│   │   │   ├── repository/      RunRepository: lazy, cached access to runs
│   │   │   └── serialization/   JSON codec that keeps NaN / ±Infinity / null distinct
│   │   └── runs/
│   │       └── pages/           Runs list and run details pages
│   ├── test/                    Test setup, render and dataset test helpers
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
src/features/runs/components/       list table, filters, sort controls
src/features/charts/components/     ECharts wrappers
src/features/data/downsampling/     spike-preserving downsampling
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
- Nothing is smoothed, interpolated or downsampled. For Task 04: downsampling can work per segment, keep the per-bucket min and max (which preserves the run-20 spike), and keep every `nonFinite`, `gaps` and `duplicates` entry as an explicit marker. The view is plain data plus a typed array, so it can be passed to a Web Worker.

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

Not implemented yet (later tasks): wiring data into the UI, charts, downsampling, sorting and filtering, zoom and hover, performance work, deployment.

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

**Remaining (8 moderate, 0 high, 0 critical):**

| Package | Scope | Advisory | Why it remains |
| --- | --- | --- | --- |
| `echarts` 5.6.0 (direct) | **Production** | [GHSA-fgmj-fm8m-jvvx](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx), XSS (CWE-79, CVSS 6.1), fixed in 6.1.0 | Fixing it needs a major upgrade. No code uses ECharts yet, so nothing is exposed today. `echarts-for-react` 3.0.6 accepts `^6.0.0`, so upgrading before the charting task is the recommended path. Until then, never pass untrusted HTML into chart options (for example tooltip `formatter` or rich text). |
| `minimatch` 10.2.6 (via `@typescript-eslint/typescript-estree`) | Dev (lint only) | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), ReDoS via glob patterns | `typescript-eslint` 8.72.2 is the latest release and requires `minimatch ^10.2.2`. The audit "fix" would *downgrade* `typescript-eslint` to 8.36.0. Exposure is limited to glob patterns written in our own ESLint config. The other 6 findings are the `@typescript-eslint/*` packages listed only because they depend on this `minimatch`. |
