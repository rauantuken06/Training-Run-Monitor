# Silent-failures audit (Task 07)

Scope: cases where the UI could look correct while showing stale, misleading, incomplete or wrong information. Each risk was checked by an automated test, and in Chrome where noted. Statuses:

- **FIXED**: a real defect was reproduced, then fixed and covered by a regression test.
- **PASS**: tested; the code was already correct.
- **N/A**: does not apply to this data model.
- **UNVERIFIED**: not covered by automated checks.

Every FIXED item was confirmed to fail its regression tests when the bug was put back. "Chrome" means Playwright driving the installed Chrome (`PW_CHANNEL=chrome npm run test:e2e`).

## Defects found and fixed

| # | Risk | Reproduction (before the fix) | Fix | Tests |
| --- | --- | --- | --- | --- |
| F1 | Typed step numbers misread | The range form ran `Number(text.replace(/,/g, ''))`: **"5.000" (German 5,000) became step 5**, "1,5" became 15, and "5000.7" was accepted | `parseStepInput`: whole steps only; groups may use `,` or spaces (`5,000`, `5 000`); a `.` is rejected with a message instead of guessed | `viewport.test.ts` (17 input cases), `RunCharts.test.tsx`, Chrome `reliability.spec.ts` |
| F2 | Requested range silently replaced | **19,000–25,000 showed 13,990–19,990** (5,000 steps nobody asked for); **30,000–40,000 (no data) showed 9,990–19,990**; −500–500 showed 0–1,000 | `requestRange`: a range partly outside the data is trimmed to the part with data (never shifted), with a visible "Adjusted to …" note; a range with no data shows an error and leaves the chart unchanged | `viewport.test.ts`, `RunCharts.test.tsx`, Chrome |
| F3 | Tooltip presented a neighbour as the hovered step | Cursor at step 3,500 inside run-17's gap: the bold headline read **"Step 4,000"**. At full zoom on run-20, one pixel spans ~920 steps, but the headline still read "Step 500,123" | The headline now describes the cursor: "Step S" only when the pixel holds exactly that observation; otherwise "Cursor: steps A–B (N observations in this pixel)" or "Cursor: step X (no observation at this step)", followed by "Nearest plotted observation: step S (Δ steps away)" | `hover.test.ts`, `TrainingMetricChart.tooltip.test.tsx`, Chrome |
| F4 | Identical y-axis labels | Chrome, run-20 lr, steps 500,000–500,010: **all six y ticks were labelled "1.1028e-4"** (different values printed identically, so the axis looked flat and unlabelled) | `axisLabelDigits`: label precision follows the visible range, at least 5 significant digits, enough to keep ticks distinct (max 17) | `chartModel.test.ts` (shows the 5-digit labels collide, then that they no longer do), Chrome tick-label test |

## Clarity fixes (values were already correct)

| Risk | Finding | Change | Tests |
| --- | --- | --- | --- |
| Timestamps not labelled | `createdAt` was already formatted in UTC and identical in every timezone, but nothing said UTC | "Created (UTC)" headers and labels; full ISO timestamp in a tooltip and `datetime` | Chrome: de-DE in UTC+14 and ru-RU in UTC−11 both show run-04 as "Nov 10, 2026" (a browser-local date would show Nov 11 in UTC+14) |
| Whole-run vs viewport numbers | Summary cards never change on zoom (correct), but nothing said so next to zoomed charts | "Whole run: these values do not change when you zoom the charts." | `reliability.test.tsx`: zooming run-12 to 0–5,000 removes the chart's NaN warning, while cards and diagnostics stay identical (last value still NaN) |
| Duplicate values rounding to the same text (latent) | Not present in the catalog (checked: no conflicting copies collide at 5 digits) | If they would, the tooltip shows the exact values | `hover.test.ts` fixture (2.000001 vs 2.000002) |

## Risks tested: PASS

| Area | Evidence |
| --- | --- |
| Request races A → B → C | Responses delivered C, B, A and also A, B before C. Only C's heading, cards, charts, warnings and data quality appear; nothing from B's NaNs (`reliability.test.tsx`). Chrome: three navigations in one tick end on the last run with only its warnings. |
| Superseded errors / unmount | A failure of a superseded request never shows (no alert). Unmounting before the response logs no React errors. Hook-level guards from Task 05 still fail their tests if removed. |
| Stale cached data | The catalog is immutable, and the analysis cache is keyed by run *object*. A simulated update (a new object for the same ID) is re-analyzed and shows the new value; re-opening an unchanged run shows identical numbers. |
| Error after success, unknown ID | A failed load after a successful run shows the error and no previous charts or diagnostics; a loaded run → unknown ID shows "Run not found" with nothing of the previous run. Retry and concurrent requests are covered by Task 02/05 tests. |
| Zoom state on navigation | Each run starts at its full range (`RunCharts.test.tsx`); zoom never leaks between runs. |
| Smoothing / sampling | Option tests: `smooth: false`, no `sampling`, no animation, one series per segment. A drawn-geometry test in Chrome places the run-20 spike vertex exactly. |
| Divergence | run-09's final value (102.47 at step 19,990) is the last plotted point at budgets 16–4,000, and the y-axis contains it (unit and Chrome). |
| Reset restores anomalies | Chrome: run-12's "NaN ×600" marker disappears when zoomed to 0–5,000 and returns after Reset. |
| Log scale / zero / negatives | Only linear `value` axes exist (option tests); −2, 0, 3e-12 and −1e-300 are plotted exactly, inside the y-range. Log scale is intentionally unsupported. |
| Number formatting | A seeded sweep of 20,000 values across 10^±300: never shown as "0", sign kept, error within the rounding bound, no locale characters. Chrome in de-DE and ru-RU shows the same en-US text ("1,000,000", "42.5", "2e-5"): **a fixed en-US policy**, not the browser locale. |
| Hover edge cases | Exact hover at high zoom (run-20 spike, Chrome); NaN / ±Infinity / null near the cursor; conflicting duplicates; first/last step of the viewport; no plotted points at all. |

## Not applicable

- **Timezones for metrics:** the x-axis is the training **step**, a counter, not a timestamp. The only timestamp is run metadata `createdAt` (see above).
- **Data freshness / real-time updates:** the data is a deterministic, immutable synthetic catalog. There is no backend, so no freshness guarantee is claimed.
- **Log-scale handling of zero and negatives:** there is no log scale.

## Unverified / remaining limitations

- **Simulated races only:** races use controlled promises and same-tick navigations; this does not prove behaviour on a real network.
- **Browsers:** only Chrome (desktop and a mobile viewport) was automated. Firefox, Safari and real touch devices were not.
- **Rendering precision:** zrender may merge line vertices within 2 device pixels (Task 06: measured up to 0.7 px). Hover precision is one pixel; when a pixel spans many steps, the tooltip now says so.
- **Not reviewed:** screen-reader output and dark mode.
  - **Manual procedure:** open run-12 and run-15, zoom with the keyboard, and check the announced range, the chart names and the warnings with NVDA/VoiceOver; repeat with the OS in dark mode.
