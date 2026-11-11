# Engineering rules

These rules apply to every contributor, human or AI agent, working in this repository.

## Honesty about results

- **Never fabricate test results.** Only report pass/fail counts copied from a command you actually ran.
- **Never invent performance measurements.** Every number (timings, FPS, memory, bundle size) must come from a real, reproducible measurement. State the command, the environment and the dataset.
- **Do not claim a check passed unless it was actually executed.** If you could not run lint, typecheck, tests, build or e2e, say so and say why.
- **Never hide failed tests.** Do not delete, skip (`.skip`, `test.fixme`), weaken or loosen assertions just to turn a run green. If a test is skipped on purpose, write the reason in the code and in the report.
- **Report unresolved issues explicitly.** Known bugs, limitations, flaky tests and environment problems go into the task report or the README, not into silence.

## Data integrity

- **Never silently convert `NaN` or `Infinity` to zero.** Non-finite values are signals (for example, a diverged run). Preserve them in the raw data, surface them in diagnostics, and render them in a distinct, visible way.
- **Preserve data integrity.** Raw points stay as received. Normalization (sorting, de-duplication, gap detection) produces new derived structures and reports every change it makes through `DataQualityDiagnostics`. It never mutates the input.
- `null` means "not recorded". `NaN` means "recorded but invalid". Do not merge the two.
- Downsampling must preserve extremes, such as isolated spikes. It must never drop or average away anomalous points without saying so.

## Scope

- **Keep changes focused on the current task.** Do not implement features that belong to later tasks. Do not refactor unrelated code.
- Do not add placeholder files or speculative abstractions.

## Code standards

- TypeScript strict mode, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Do not use `any`, and do not use `@ts-ignore` or `eslint-disable` without a comment explaining why.
- Before reporting work as done, run `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build`. Also run `npm run test:e2e` when browsers are available.
- UI must be accessible: semantic HTML, labelled landmarks, keyboard operable, visible focus.
