import { expect, test, type Page, type Worker } from '@playwright/test';

/** Task 08: code splitting and Web Worker lifecycle, verified in a real browser. */

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

function trackScripts(page: Page) {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'script' || r.url().endsWith('.js')) urls.push(r.url());
  });
  return urls;
}

function trackWorkers(page: Page) {
  const workers: { worker: Worker; closed: boolean }[] = [];
  page.on('worker', (worker) => {
    const entry = { worker, closed: false };
    worker.on('close', () => {
      entry.closed = true;
    });
    workers.push(entry);
  });
  return workers;
}

test('the runs list does not download the chart code; a run page loads it on demand', async ({ page }) => {
  const scripts = trackScripts(page);
  await page.goto('/');
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(21);
  expect(scripts.some((u) => /RunCharts-/.test(u))).toBe(false);

  await page.getByRole('link', { name: 'baseline-350m-lr3e-4' }).click();
  await expect(page.getByTestId('metric-chart-loss').locator('svg')).toBeVisible();
  expect(scripts.some((u) => /RunCharts-/.test(u))).toBe(true);
});

test('a deep link to a run loads data in a Web Worker that is closed when done', async ({ page }) => {
  const workers = trackWorkers(page);
  await page.goto('/runs/run-12');
  await expect(page.getByTestId('metric-chart-loss').locator('svg')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Loss chart warnings' })).toContainText('600 invalid loss values');
  expect(workers.length).toBeGreaterThanOrEqual(1);
  await expect.poll(() => workers.every((w) => w.closed)).toBe(true);
});

test('rapid navigation closes superseded workers and shows only the last run', async ({ page }) => {
  await page.goto('/');
  const workers = trackWorkers(page);
  await page.evaluate(() => {
    for (const id of ['run-20', 'run-12', 'run-15']) {
      history.pushState({}, '', `/runs/${id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }
  });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('duplicate-steps-multi-rank-logging');
  await expect(page.getByTestId('quality-duplicates')).toContainText('50 conflicting');
  await expect(page.getByRole('list', { name: 'Loss chart warnings' })).not.toContainText('NaN');
  await expect.poll(() => workers.length > 0 && workers.every((w) => w.closed)).toBe(true);
});

test('the million-point run still draws the exact spike after the worker hand-off', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/runs/run-20');
  const max = page.getByRole('region', { name: 'Loss', exact: true }).locator('dt', { hasText: 'Maximum (finite)' }).locator('xpath=following-sibling::dd[1]');
  await expect(max).toHaveText('42.5 at step 500,123', { timeout: 30_000 });
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-input', '1000000');
  await expect(page.getByTestId('quality-overview')).toHaveText(/No data quality issues detected/);
});
