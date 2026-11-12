import { expect, test, type Page } from '@playwright/test';

/** Task 07 reliability checks in a real browser. Must match GRID in chartModel.ts. */
const GRID = { left: 76, right: 36, top: 28, bottom: 36 };

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function openRun(page: Page, id: string) {
  await page.goto(`/runs/${id}`);
  await page.getByTestId('metric-chart-loss').locator('svg').waitFor({ timeout: 30_000 });
}
async function applyRange(page: Page, from: string, to: string) {
  await page.getByLabel('From step').fill(from);
  await page.getByLabel('To step').fill(to);
  await page.getByRole('button', { name: 'Apply range' }).click();
}

test('rapid run switching (three navigations in one tick) shows only the last run', async ({ page }) => {
  await openRun(page, 'run-01');
  // Client-side navigations fired back to back, before any run finishes loading.
  await page.evaluate(() => {
    for (const id of ['run-12', 'run-14', 'run-15']) {
      history.pushState({}, '', `/runs/${id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('duplicate-steps-multi-rank-logging');
  await expect(page.getByTestId('quality-duplicates')).toContainText('50 conflicting');
  await expect(page.getByTestId('quality-invalid-values')).toContainText('None');
  const warnings = page.getByRole('list', { name: 'Loss chart warnings' });
  await expect(warnings).toContainText('50 steps were logged more than once');
  await expect(warnings).not.toContainText('NaN');
  await expect(warnings).not.toContainText('Infinity');
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-input', '2000');
});

for (const [locale, timezoneId] of [
  ['de-DE', 'Pacific/Kiritimati'], // UTC+14: run-04 (18:00 UTC) is already the next day locally
  ['ru-RU', 'Pacific/Pago_Pago'], // UTC-11
] as const) {
  test.describe(`${locale} browser in ${timezoneId}`, () => {
    test.use({ locale, timezoneId });

    test('dates stay on their UTC day and are labelled UTC; numbers use the fixed en-US format', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('columnheader', { name: 'Created (UTC)' })).toBeVisible();
      const run04 = page.getByRole('row').filter({ hasText: 'run-04' });
      await expect(run04.locator('time')).toHaveText('Nov 10, 2026');
      await expect(run04.locator('time')).toHaveAttribute('datetime', '2026-11-10T18:00:00.000Z');
      await expect(page.getByRole('row').filter({ hasText: 'run-20' })).toContainText('1,000,000');

      await openRun(page, 'run-20');
      const max = page.getByRole('region', { name: 'Loss', exact: true }).locator('dt', { hasText: 'Maximum (finite)' }).locator('xpath=following-sibling::dd[1]');
      await expect(max).toHaveText('42.5 at step 500,123');
      const lr = page.getByRole('region', { name: 'Learning rate', exact: true }).locator('dt', { hasText: 'Last recorded' }).locator('xpath=following-sibling::dd[1]');
      await expect(lr).toHaveText(/^2e-5 at step 999,999$/);
    });
  });
}

test('regression: y-axis tick labels stay distinct when values barely change', async ({ page }) => {
  test.setTimeout(60_000);
  await openRun(page, 'run-20');
  await applyRange(page, '500000', '500010');
  await expect(page.getByTestId('metric-chart-lr')).toHaveAttribute('data-x-min', '500000');
  const labels = await page.getByTestId('metric-chart-lr').evaluate((el, left) => {
    const svg = el.querySelector('svg');
    if (!svg) return [];
    const x0 = svg.getBoundingClientRect().left;
    return [...svg.querySelectorAll('text')].filter((t) => t.getBoundingClientRect().right - x0 < left).map((t) => t.textContent ?? '');
  }, GRID.left);
  expect(labels.length).toBeGreaterThan(2);
  expect(new Set(labels).size).toBe(labels.length);
});

test('regression: the range form rejects "5.000" and trims ranges to the data', async ({ page }) => {
  await openRun(page, 'run-01');
  await applyRange(page, '5.000', '6.000');
  await expect(page.getByRole('alert')).toContainText('steps are whole numbers');
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-min', '0');

  await applyRange(page, '19000', '25000');
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-min', '19000');
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-max', '19990');
  await expect(page.getByText("Adjusted to steps 19,000–19,990: this run's data covers 0–19,990.")).toBeVisible();
});

test('regression: hovering inside a gap names the cursor step, then the nearest observation', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hover needs a mouse');
  await openRun(page, 'run-17');
  await applyRange(page, '2900', '4100');
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-min', '2900');
  const chart = page.getByTestId('metric-chart-loss');
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  if (!box) throw new Error('no box');
  const x = box.x + GRID.left + ((3_500 - 2_900) / 1_200) * (box.width - GRID.left - GRID.right);
  await page.mouse.move(x, box.y + box.height / 2);
  const tip = page.locator('div').filter({ hasText: /^Cursor: step/ }).last();
  await expect(tip).toContainText(/^Cursor: step 3,5\d\d \(no observation at this step\)/);
  await expect(tip).toContainText('Nearest plotted observation: step');
  await expect(tip).toContainText('Missing steps 3,000–3,990');
});

test('zooming away from NaNs and resetting brings their markers back; a diverging run stays divergent', async ({ page }) => {
  await openRun(page, 'run-12');
  const texts = () => page.getByTestId('metric-chart-loss').evaluate((el) => [...el.querySelectorAll('svg text')].map((t) => t.textContent ?? ''));
  // The chart draws on the next animation frame (ECharts lazyUpdate), so the <svg> can exist
  // before anything is drawn in it: poll instead of reading once (Task 09: Edge read [] once).
  // 'drawn' requires axis labels, so an empty frame cannot satisfy the 'marker gone' check.
  const markers = async () => {
    const t = await texts();
    return { drawn: t.some((s) => /^[\d,]+$/.test(s)), nanMarker: t.includes('NaN ×600') };
  };
  await expect.poll(markers).toEqual({ drawn: true, nanMarker: true });
  await applyRange(page, '0', '5000');
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-max', '5000');
  await expect.poll(markers).toEqual({ drawn: true, nanMarker: false });
  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-max', '19990');
  await expect.poll(markers).toEqual({ drawn: true, nanMarker: true });

  await openRun(page, 'run-09');
  const yMax = Number(await page.getByTestId('metric-chart-loss').getAttribute('data-y-max'));
  expect(yMax).toBeGreaterThan(102.47); // the final blow-up (loss ≈ 102.47 at step 19,990) is inside the axis
});
