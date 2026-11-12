# Final QA report (Task 09)

Date: 2026-11-12. Machine: Windows 11 Pro, Chrome 157 (157.0.8103.39 for most runs; it auto-updated to 157.0.8103.52 before the final memory measurement), Microsoft Edge (Chromium, stable channel), Playwright's bundled Firefox. All checks ran against the production build (`npm run build` + `vite preview`) unless a row says otherwise. Evidence files live in [docs/qa/](qa/).

Status values: **PASS** (checked, no defect), **FIXED** (defect found in Task 09 and fixed, with a regression test), **FAIL** (open defect), **UNVERIFIED** (not checked, or only partly checked; the reason is given).

An automated axe scan is **not** an accessibility certification. axe finds a subset of WCAG failures. The manual checks below cover more, but no assistive-technology user testing was done, and no screen reader was available on this machine.

## 1. Defects found and fixed in Task 09

| # | Defect | Severity | Fix | Regression test |
| --- | --- | --- | --- | --- |
| 1 | **Search box dropped keystrokes.** The input's value came straight from the URL, and the router applies `setSearchParams` asynchronously, so fast typing lost characters. Firefox e2e: "loss" became "lss". Chrome on the production build: "nan-loss-fp16" became "nan-los-fp6"; wrong in 1 of 5 runs unthrottled, and in 5 of 5 at 6× and 20× CPU throttling. | High: silently filters by the wrong text | `useUrlBackedText`: the input renders local state, its own lagging URL echoes are ignored, and URL changes made elsewhere (Clear filters, Back, links) are adopted. After the fix: 0 of 15 wrong (5 each at 1×, 6× and 20×). | `src/features/runs/hooks/useUrlBackedText.test.tsx` (fails on the old behaviour, checked by mutation); `e2e/final-qa.spec.ts` "regression: fast typing in the search box…" (6× CPU throttling in Chromium) |
| 2 | **Light-theme chart axis lines failed WCAG 1.4.11:** `#94a3b8` on white is 2.56:1 (3:1 required). axe could not check this: it reported the chart SVG text as "incomplete". | Medium | Axis colour changed to `#64748b` (4.76:1). Data colours are unchanged. | `src/features/charts/model/chartTheme.contrast.test.ts`: every chart colour in both themes, including text on the translucent bands (fails on the old colour) |
| 3 | **A run worker that never answers left the page on "Loading…" forever.** Seen once in a Chrome e2e run: 3 tests timed out with no error shown. | Medium | 60 s watchdog in `workerRunLoader`: it terminates the worker and shows the error state with Retry. Checked in Chrome with a hung worker request: the alert appeared at 61 s. | `workerRunLoader.test.ts` "regression: a worker that never answers…" (fails without the watchdog) |

Test-only changes (no assertion was removed, skipped or loosened):

- **Two heavy unit tests got a 30 s time limit.** They generate the million-point run in the test body (~3 s idle) and hit Vitest's 5 s default at 5.8 s and 6.3 s while other applications used 61% CPU. The reason is commented in the code.
- **`reliability.spec.ts` "zooming away from NaNs…" now retries instead of reading once.** Edge failed it once, reading `[]` (no text at all) from the chart. The chart draws on the next animation frame (ECharts `lazyUpdate`), so the test had sampled an `<svg>` that existed but was not drawn yet. The test now retries until the chart is drawn: it requires axis labels to be present, so an empty frame cannot satisfy the "marker gone" check. The expected values are unchanged.
- **Firefox only:** 2 Playwright workers instead of 4, and `test.slow` (3× time limit) on the axe tests. See section 3 for the measurements behind this.
- The new e2e search regression test was not itself run against the old code. The failure was shown with an equivalent standalone script on the old production build (same typing, same throttling). The unit test was run against the old behaviour and failed.

## 2. Requirement matrix

### Automated checks

| Requirement | Status | Evidence | Remaining risk |
| --- | --- | --- | --- |
| Lint, typecheck | PASS | `npm run lint` (0 problems), `npm run typecheck` (exit 0) | None |
| Unit and component tests | PASS | `npm run test`: 35 files, 564 tests passed (clean run) | Under heavy CPU load, the time limits are the weak point. One run that I accidentally overlapped with an e2e run and the memory script reported 2 failures (531 passed); the failure details were not kept. The next clean run was fully green. |
| Production build | PASS | `npm run build`: index 370.97 kB (gzip 117.74), RunCharts 582.45 kB (lazy), worker 17.03 kB | The chunk-size warning for RunCharts is expected (ECharts) |
| e2e in Chrome, desktop + mobile (`PW_CHANNEL=chrome`) | PASS | 76 passed, 6 skipped, 0 failed (3.2 min). [logs/e2e-chrome.log](qa/logs/e2e-chrome.log) | 6 mobile skips are intentional: hardware-keyboard tests. An earlier Chrome run had 3 timeouts from a worker that never answered; this led to fix #3. |
| axe WCAG 2.0/2.1/2.2 A+AA, light and dark: list (default, filtered, empty), run-01/12/15/20 with details open and a range-form error, unknown run, 404 | PASS (Chromium); PASS with a workaround (Firefox) | `e2e/final-qa.spec.ts`; 0 violations. axe was proven to detect planted `image-alt` and `color-contrast` violations. | axe marks chart SVG text contrast "incomplete", so that check was done by hand (row below). Firefox: see section 3. |
| Chart colour contrast (both themes) | FIXED | `chartTheme.contrast.test.ts`: text ≥ 4.5:1; lines, axes and markers ≥ 3:1 | Colours are checked against the card background, not against every pixel of every screenshot |
| Visible keyboard focus | PASS | e2e: every Tab stop on `/` and `/runs/run-15` has a ≥ 2 px outline | Desktop only, by design |
| Reflow at 320 px and 640 px (= 1280 px at 200% zoom) | PASS | e2e: 0 px horizontal overflow on `/`, run-12 and run-20; zoom controls visible | Browser zoom emulated by viewport width, not the zoom setting itself |
| URL state survives reload and Back | PASS | e2e "URL filters survive a reload and the browser Back button" | None |
| Failure paths: worker crash, chart chunk not downloadable, hung worker | PASS / FIXED | e2e (worker abort → alert + Retry; chunk abort → alert, summaries kept); unit test (hung worker) | The 60 s timeout is long. It is a last resort, not the normal error path. |
| Data correctness at every width (spike at step 500,123 kept, NaN/gap markers) | PASS | Existing Task 04–08 unit and e2e tests, all green | Unchanged in Task 09; chart rendering was not altered except the axis colour |

### Manual or scripted checks

| Requirement | Status | Evidence | Remaining risk |
| --- | --- | --- | --- |
| Responsive layout at 390/820/1280/1920, light and dark: list, run-01, run-12 (NaN), run-15 (duplicates), run-20 (1M) | PASS | 40 screenshots in [qa/screenshots/](qa/screenshots/); [qa/responsive-results.json](qa/responsive-results.json): 0 px page overflow, 0 overlapping chart labels, 0 console errors in every case. The table scrolls inside its own region at 390 and 820 px. | Screenshots were checked by eye for a sample (for example `dark/1280-run-12-nan.jpg`), not pixel by pixel |
| Dark mode | PASS | Screenshots plus the axe dark-mode scans; disabled zoom buttons are faint (WCAG 1.4.3 exempts disabled controls) | Faint disabled buttons could be read as missing |
| Keyboard order | PASS | Manual Tab walk: skip link → home → nav → back → details → zoom → From/To → Apply. Disabled buttons are skipped. | None found |
| Tab memory | PASS (measured; no budget exists) | Section 4; [qa/tab-memory.json](qa/tab-memory.json); `node scripts/perf/tab-memory.mjs` | One machine, one browser |
| Production bundle hygiene | PASS | `dist/` scan: no local paths, secrets, `debugger` or test code; our code has no `console.log`. Matches came only from library internals. No console errors in any e2e or screenshot run. | `trm:*` User Timing marks and `data-testid` attributes ship to production (harmless, intentional) |
| Direct URL navigation (deep links) | PASS locally | `/runs/run-20`, `/?status=failed`, `/does-not-exist` load directly through `vite preview` | **Production hosting needs an SPA rewrite to `index.html`** (Task 10) |
| `npm audit` | PASS for production | `npm audit --omit=dev`: 0. Full audit: 7 moderate, all dev-only (`typescript-eslint` → `minimatch`); the only "fix" offered is a downgrade. See README. | Dev tooling only |

### Not done or partly done

| Requirement | Status | Why | What would close it |
| --- | --- | --- | --- |
| Screen reader (NVDA/JAWS/VoiceOver/TalkBack) | UNVERIFIED | No screen reader is installed on this machine. Structure is checked indirectly (landmarks, labels, roles, live regions, via axe and the RTL/Playwright role queries). | Manual pass with NVDA + Firefox/Chrome: announce the page title and landmarks; filter the list and hear "Showing N of 20 runs"; open run-12 and reach the warnings list and the data-quality report; submit "5.000" in the range form and hear the error |
| Real browser zoom at 200% / 400% | UNVERIFIED (emulated) | Checked as viewport widths 640 and 320 | Set the browser zoom manually and repeat the reflow checks |
| Windows high-contrast / forced colours | UNVERIFIED | Not tested | Check with Windows contrast themes |
| Real mobile devices and Safari/WebKit | UNVERIFIED | Only the Chromium "Pixel 7" emulation was tested; no Safari | Test on an iPhone and an Android phone |
| Chrome Task Manager "Memory footprint" | UNVERIFIED | Not automatable; see section 4 for the closest measured metric | Shift+Esc in Chrome, open run-20, read the tab's row |

## 3. Cross-browser smoke tests

Each browser ran the **full** e2e suite, not just a smoke subset. Final runs are on the final code; the logs are in [qa/logs/](qa/logs/).

| Browser | Final result | Earlier failures in Task 09 and what they were |
| --- | --- | --- |
| Chrome 157 (`PW_CHANNEL=chrome`) | **PASS**: 76 passed, 6 skipped, 0 failed | 3 timeouts in one run: a worker that never answered (real gap, fix #3) |
| Edge (`PW_CHANNEL=msedge`) | **PASS**: 76 passed, 6 skipped, 0 failed | (a) `charts.spec.ts:79` (spike test) failed once at 25.7 s with no message; it passed 3 isolated runs, a second full run and 16 stress runs. **Unexplained intermittent failure.** (b) `reliability.spec.ts:115` read an undrawn chart: a test race, now polled (section 1). |
| Firefox (Playwright build, desktop only, `PW_BROWSER=firefox`) | **PASS**, twice in a row: 41 passed, 0 failed (2 workers) | (a) `dashboard.spec.ts:17` saw "lss" instead of "loss": a **real app bug** (fix #1). (b) With 4 workers, 6–7 tests timed out in two runs. Cause: axe takes 3.5–6 s per scan in Firefox, and CPU was contended (about 48% load from other applications). The same tests passed with 1 worker. Firefox now uses 2 workers, and its axe tests have a 3× time limit (`test.slow`). No expectation changed. My fix was ruled out as the cause: the same axe scan with the old and new search input took the same time (3.5–5.0 s vs 3.7–5.1 s). |

The 6 skips in Chrome and Edge are the mobile-project runs of hardware-keyboard tests. Firefox has no mobile project. Safari/WebKit was not tested.

**Firefox axe workaround (scoped, annotated).** In Playwright's Firefox build, after six axe rules run on a run page (`aria-allowed-attr`, `aria-conditional-attr`, `aria-prohibited-attr`, `label-content-name-mismatch`, `nested-interactive`, `target-size`), the next input event in that document crashes the content process. Running them after the range form has been submitted crashes it too (reproduced 6 of 6 times). The app on its own never crashed, and the same form interactions pass in the other Firefox tests. So Firefox scans each state in a fresh page and never interacts after a scan:

- "Details open" is scanned with every rule.
- "Form error" is scanned without those six rules.

Chromium runs every rule in every state. The test records a `firefox-axe-workaround` annotation. Risk: those six rules are unverified on the form-error state in Firefox only.

## 4. Memory

Measured with `node scripts/perf/tab-memory.mjs` (final run 2026-11-12, Chrome 157.0.8103.52, no test suite running in parallel; other desktop applications were open. An earlier run on 157.0.8103.39 gave run-20 private 124.7–125.2 MB, peak 221.2–225.6 MB) on Windows 11, production build, 3 repetitions, after 2 forced GCs. The tab's renderer process was identified through `SystemInfo.getProcessInfo` as the renderer whose CPU time grew while run-20 loaded; then the Windows `Win32_Process` counters were read for it.

| Metric | Status | Runs list | run-20 (1M points), settled | Peak while run-20 loads |
| --- | --- | --- | --- | --- |
| JS heap (main thread, CDP) | Measured | 2.5 MB | 74.8–74.9 MB | not measured |
| Worker memory | Not separately measurable | n/a | 0 live workers after load (each worker is terminated when it answers) | included in the renderer peak: the dedicated worker runs inside the tab's renderer process |
| Full tab: renderer private bytes | Measured | 29.0–31.9 MB | 122.9–127.7 MB | 222.9–225.3 MB |
| Full tab: renderer working set | Measured | 79.7–82.4 MB | 186.1–190.8 MB | 284.4–286.2 MB |
| Chrome Task Manager "Memory footprint" | Not measured | — | — | — |

These are OS process counters, not Chrome's "Memory footprint" (a different accounting), and there is no earlier baseline or budget to compare against. GPU and browser-process memory are not included.

## 5. Blockers and non-blockers

**Blockers: none open.** The one high-severity defect found (dropped keystrokes) is fixed and covered by tests.

**Non-blockers (known, documented):**

1. The SPA rewrite for deep links is required at deployment time (Task 10).
2. No screen reader, real-device, Safari or forced-colours testing.
3. The Firefox axe workaround leaves six rules unchecked on one state, in Firefox only.
4. Heavy unit tests are sensitive to machine load (time limits raised, assertions unchanged).
5. The 60 s worker timeout is a last resort; a hung worker shows an error only after a minute.
6. Seven moderate `npm audit` findings in dev-only lint tooling.
7. DevTools CPU throttling does not slow Web Workers (Task 08 caveat), so slow-device load times are better than they would really be.
