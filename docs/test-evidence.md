# Final test evidence (Task 10)

Final verification on 2026-11-12, on the final code. Environment: Windows 11 Pro, Node 24.13.1, Chrome 157, Microsoft Edge (Chromium), Playwright's Firefox build. Every number below is copied from the log file named in its row, except production run 1, which has no saved log and is marked as reported by the candidate. The full, unedited output is in [qa/logs/](qa/logs/) (ANSI colour codes stripped).

## Results

| Check | Command | Passed | Skipped | Failed | Log |
| --- | --- | --- | --- | --- | --- |
| Lint | `npm run lint` | exit 0 | — | 0 | [lint.log](qa/logs/lint.log) |
| Typecheck | `npm run typecheck` | exit 0 | — | 0 | [typecheck.log](qa/logs/typecheck.log) |
| Unit and component tests | `npm run test` | 564 (35 files) | 0 | 0 | [unit.log](qa/logs/unit.log) |
| Production build | `npm run build` | exit 0 | — | — | [build.log](qa/logs/build.log) |
| e2e, Chrome (desktop + Pixel 7) | `PW_CHANNEL=chrome npm run test:e2e` | 86 | 8 | 0 | [e2e-chrome.log](qa/logs/e2e-chrome.log) |
| e2e, Edge (desktop + Pixel 7) | `PW_CHANNEL=msedge npm run test:e2e` | 86 | 8 | 0 | [e2e-edge.log](qa/logs/e2e-edge.log) |
| e2e, Firefox (desktop) | `PW_BROWSER=firefox npm run test:e2e` | 46 | 1 | 0 | [e2e-firefox.log](qa/logs/e2e-firefox.log) |
| Production smoke test on emulated Vercel routing (before deployment) | `PW_BASE_URL=http://localhost:4400 … e2e/production-smoke.spec.ts` | Chrome 12, Edge 12, Firefox 6 | 0 | 0 | [smoke-emulated-vercel.log](qa/logs/smoke-emulated-vercel.log) |
| Production smoke test on the **live Vercel deployment**, Chrome | see [below](#production-smoke-test-on-the-live-vercel-deployment) | 12 with 1 worker; 9 or 12 with 4 workers | 0 | 0 with 1 worker; 3 in one of two 4-worker runs | see below |
| Security audit, production dependencies | `npm audit --omit=dev` | 0 vulnerabilities | — | — | [npm-audit.log](qa/logs/npm-audit.log) |
| Security audit, all dependencies | `npm audit` | — | — | 7 moderate, dev-only | [npm-audit.log](qa/logs/npm-audit.log) |

Real output excerpts:

```text
$ npm run test
 Test Files  35 passed (35)
      Tests  564 passed (564)

$ PW_CHANNEL=chrome npm run test:e2e
  8 skipped
  86 passed (1.8m)

$ PW_BROWSER=firefox npm run test:e2e
  1 skipped
  46 passed (3.5m)

$ npm audit --omit=dev
found 0 vulnerabilities
```

## Production smoke test on the live Vercel deployment

- **URL:** https://training-run-monitor-gold.vercel.app/
- **Deployed commit:** `20654d3` on `main`, as confirmed by the candidate in the Vercel dashboard. The agent cannot see the Vercel dashboard. It did check that the deployed files are this source: the live site serves `index-DaVtcVt0.js` and `RunCharts-CvB9KPLL.js`, the same content-hashed names as the local build in [build.log](qa/logs/build.log). The only later commit, `d2a798b`, adds log files and no source.
- **Scope:** 12 tests = 6 tests × 2 Playwright projects (desktop Chrome, and Pixel 7 emulation in Chrome). Edge and Firefox were **not** run against production.
- **Base command:** `PW_BASE_URL=https://training-run-monitor-gold.vercel.app PW_CHANNEL=chrome npx playwright test e2e/production-smoke.spec.ts`. The default is 4 workers. The sequential runs add `--workers=1 --reporter=line`.

| # | Run | Who ran it | Passed | Failed | Duration | Original log |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Parallel, 4 workers (first run) | Candidate | 12 | 0 | 28.6 s | **Not saved.** Result as reported by the candidate. |
| 2 | Parallel, 4 workers (rerun) | Candidate | 9 | **3** | 2.0 min | [production-smoke-vercel.log](qa/logs/production-smoke-vercel.log) |
| 3 | Sequential, 1 worker | Candidate | 12 | 0 | 1.4 min in the log (the candidate recalled 2.2 min) | [production-smoke-sequential.log](qa/logs/production-smoke-sequential.log) |
| 4 | Sequential, 1 worker (independent rerun, 2026-11-12 09:11 UTC) | AI agent | 12 | 0 | 1.3 min | [production-smoke-agent-sequential.log](qa/logs/production-smoke-agent-sequential.log) |

The logs are kept exactly as captured. The candidate's two logs are UTF-16 PowerShell output, and their `✓`/`›` symbols appear garbled in some viewers. The log of the failed run 2 is kept as it is and has not been replaced by a passing one. Its file name does not say "parallel", but the log shows "Running 12 tests using 4 workers".

**Failures in run 2, copied from its log:**
1. `[chromium]` million-point run: `locator.waitFor: Timeout 30000ms exceeded` while waiting for the loss chart's SVG (`openRun`, line 37).
2. `[mobile-chromium]` direct navigation and refresh: `Test timeout of 90000ms exceeded`.
3. `[mobile-chromium]` static assets: `Test timeout of 30000ms exceeded` / `apiRequestContext.get: Request context disposed`. The call log shows the server had already answered `200 OK`, `content-type: application/javascript`, `x-vercel-cache: HIT`. The response arrived, but the request did not finish within the test's time limit.

**Known intermittent behaviour:** with 4 parallel workers against production, these tests can time out. The cause is **not confirmed**. Possible factors include CPU contention between parallel browsers (each one parses the 1,000,000-point run in its own Web Worker) and network conditions, but neither was measured. No code, test or time limit was changed in response, so this instability is **not fixed**. Both 1-worker runs passed.

**Route and asset check by the agent** ([production-routes-agent-curl.log](qa/logs/production-routes-agent-curl.log)): `/`, `/?status=failed&quality=nan_loss`, `/runs/run-01`, `/runs/run-20`, `/runs/nope` and `/does-not-exist/deeper` → `200 text/html`. Both JS chunks → `200 application/javascript`. `/assets/does-not-exist-0000.js` → `404`.

## Skipped tests (all intentional, with the reason written in the test)

- **Mobile project, 6 per Chromium browser:** hardware-keyboard tests (5) and a mouse-hover test (1). A phone has neither a hardware keyboard nor a mouse; the same tests run on the desktop project.
- **"deployment: a missing asset is a real 404", 2 in Chromium browsers and 1 in Firefox:** this checks the `vercel.json` rule. It only runs with `PW_BASE_URL` (a deployment or the local emulation). It passed on the emulation and in every production run whose log was saved. Locally the suite runs on `vite preview`, whose own fallback serves `index.html` for every path (checked: `/assets/missing` returns 200 `text/html` on `vite preview` and 404 on the emulation).

## Failures seen during Task 10, and what they were

- **First final run, all three browsers (5 failures):** the new 404 check ran against `vite preview`. This was a test-design mistake, not an app bug. It is now deployment-only (see above).
- **One Firefox run, 19 of 47 failures in 18.5 min:** the machine ran out of resources. The shell could not fork new processes ("Resource temporarily unavailable"), the local server refused connections (`NS_ERROR_CONNECTION_REFUSED`), and Firefox's own context teardown crashed. The next run, with free resources, passed 46/46 (1 skip). That run's log was not kept in the repository.
- **One Firefox smoke run:** a console error from Playwright's Firefox driver itself (`chrome://juggler/…/WorkerMain.js`, `NS_BINDING_ABORTED`) appeared when run-20 was reloaded while its worker was loading. Messages from `chrome://juggler/` are now ignored, with the reason in the test; all other console errors still fail it. The smoke test then passed in 4 consecutive Firefox runs.

## Not verified

- **The live deployment beyond Chrome:** the production smoke test ran only in Chrome (desktop and Pixel 7 emulation). Edge, Firefox and Safari were not run against production. The full e2e suite (86/46 tests) ran only against the local production build, not against the live URL.
- **The cause of the 4-worker timeouts on production** (see above).
- **Vercel routing for other paths:** only the paths listed above were checked.
- **Manual and device checks:** screen readers, Safari/WebKit, real phones, real browser zoom and forced colours. See [final-qa-report.md](final-qa-report.md).

## Accessibility (from Task 09)

- **axe** (WCAG 2.0/2.1/2.2 A and AA tags): 0 violations in every tested state, light and dark. These scans are part of the e2e suites above (`e2e/final-qa.spec.ts`).
- **Firefox:** six axe rules are skipped on one state, because they crash Playwright's Firefox build.
- **Checked outside axe:** chart colour contrast (unit test), focus visibility and reflow (e2e), and keyboard order (walked through by the AI agent). None of these was a manual check by the candidate. This is not a certification.
