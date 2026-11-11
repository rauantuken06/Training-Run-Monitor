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
| Unit tests | Vitest 3, React Testing Library, happy-dom      |
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
| `npm run test`      | Run unit/component tests once (Vitest)                         |
| `npm run test:watch`| Run Vitest in watch mode                                       |
| `npm run test:e2e`  | Build, serve with `vite preview`, run Playwright (desktop + mobile Chromium) |

## Folder structure

```
.
├── e2e/                         Playwright specs
├── src/
│   ├── app/                     App root, route table, path helpers
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   └── paths.ts
│   ├── components/
│   │   └── layout/              App shell (header, nav, main) and 404 page
│   ├── features/
│   │   └── runs/
│   │       └── pages/           Runs list and run details pages
│   ├── test/                    Test setup and render helpers
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
src/features/data/generators/       synthetic run generation
src/features/data/integrity/        validation and DataQualityDiagnostics
src/features/data/downsampling/     spike-preserving downsampling
src/hooks/  src/utils/
```

### Type design (`src/types/training.ts`)

- `MetricValue = number | null`. A finite number is a normal reading. `NaN` and `±Infinity` are kept exactly as recorded. `null` means the value was not recorded. Values are never coerced to `0`.
- `TrainingRun.points` holds the raw points in the order received. They may be unsorted, duplicated or have gaps.
- `DataQualityIssue` is a discriminated union on `kind`: `nan`, `positive_infinity`, `negative_infinity`, `missing_value`, `duplicate_step`, `unsorted_step`, `missing_steps` or `invalid_step`. Each kind carries the step, index and metric details it needs.
- `DataQualityDiagnostics` aggregates per-metric value counts, per-kind issue counts and the full issue list.
- `RunSummary` / `MetricSummary` compute `min` and `max` over finite values only (`null` if there are none). `last` keeps the raw last value, so a run that ends in `NaN` stays visible.

## Current implementation status

**Task 01 (project foundation) is complete.**

- [x] Vite + React + TypeScript (strict) + Tailwind + ESLint
- [x] Domain types for points, runs, summaries and data quality diagnostics
- [x] Routes: `/` (runs list placeholder), `/runs/:runId` (details placeholder), plus a catch-all 404
- [x] App shell: header, primary nav, skip link, `<main>` landmark, responsive container, visible focus rings
- [x] Vitest + React Testing Library unit tests, Playwright e2e specs

Not implemented yet (later tasks): synthetic data generation, data integrity checks, charts, downsampling, sorting and filtering, zoom and hover, performance work, deployment.

### Known notes

- Unit tests use **happy-dom** instead of jsdom. With jsdom, React Router's data-router navigation threw `RequestInit: Expected signal to be an instance of AbortSignal`, because jsdom's `AbortSignal` is a different class from the one Node's `Request` (undici) expects. happy-dom ships matching implementations of both.
- The skip-link e2e test is skipped on the mobile project on purpose, because it exercises hardware-keyboard Tab navigation.
- Production SPA hosting must rewrite unknown paths to `index.html` so `/runs/:runId` deep links work. This is handled by `vite preview` locally; it will be configured during the deployment task.
