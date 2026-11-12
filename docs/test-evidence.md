# Final test evidence (Task 10)

Final verification on 2026-11-12, on the final code. Environment: Windows 11 Pro, Node 24.13.1, Chrome 157, Microsoft Edge (Chromium), Playwright's Firefox build. Every number below is copied from the log file named in its row. The full, unedited output is in [qa/logs/](qa/logs/) (ANSI colour codes stripped).

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
| Production smoke test on emulated Vercel routing | `PW_BASE_URL=http://localhost:4400 … e2e/production-smoke.spec.ts` | Chrome 12, Edge 12, Firefox 6 | 0 | 0 | [smoke-emulated-vercel.log](qa/logs/smoke-emulated-vercel.log) |
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

## Skipped tests (all intentional, with the reason written in the test)

- **Mobile project, 6 per Chromium browser:** hardware-keyboard tests (5) and a mouse-hover test (1). A phone has neither a hardware keyboard nor a mouse; the same tests run on the desktop project.
- **"deployment: a missing asset is a real 404", 2 in Chromium browsers and 1 in Firefox:** this checks the `vercel.json` rule. It only runs with `PW_BASE_URL` (a deployment or the local emulation), and it passed there. Locally the suite runs on `vite preview`, whose own fallback serves `index.html` for every path (checked: `/assets/missing` returns 200 `text/html` on `vite preview` and 404 on the emulation).

## Failures seen during Task 10, and what they were

- **First final run, all three browsers (5 failures):** the new 404 check ran against `vite preview`. This was a test-design mistake, not an app bug. It is now deployment-only (see above).
- **One Firefox run, 19 of 47 failures in 18.5 min:** the machine ran out of resources. The shell could not fork new processes ("Resource temporarily unavailable"), the local server refused connections (`NS_ERROR_CONNECTION_REFUSED`), and Firefox's own context teardown crashed. The next run, with free resources, passed 46/46 (1 skip). That run's log was not kept in the repository.
- **One Firefox smoke run:** a console error from Playwright's Firefox driver itself (`chrome://juggler/…/WorkerMain.js`, `NS_BINDING_ABORTED`) appeared when run-20 was reloaded while its worker was loading. Messages from `chrome://juggler/` are now ignored, with the reason in the test; all other console errors still fail it. The smoke test then passed in 4 consecutive Firefox runs.

## Not verified

- **The real Vercel deployment.** Routing was checked only against a local emulation of Vercel's documented routing. Re-run the smoke test with `PW_BASE_URL=<deployed URL>` once the site is deployed.
- **Manual and device checks:** screen readers, Safari/WebKit, real phones, real browser zoom and forced colours. See [final-qa-report.md](final-qa-report.md).

## Accessibility (from Task 09)

- **axe** (WCAG 2.0/2.1/2.2 A and AA tags): 0 violations in every tested state, light and dark. These scans are part of the e2e suites above (`e2e/final-qa.spec.ts`).
- **Firefox:** six axe rules are skipped on one state, because they crash Playwright's Firefox build.
- **Checked by hand:** chart colour contrast, focus visibility, keyboard order and reflow. This is not a certification.
