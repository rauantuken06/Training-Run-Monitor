import { expect, test, type Page } from '@playwright/test';

/**
 * Production smoke test (Task 10). Runs against the local production build like every
 * spec, or against a deployed URL:
 *
 *   PW_BASE_URL=https://<deployment> PW_CHANNEL=chrome npx playwright test e2e/production-smoke.spec.ts
 *
 * With PW_BASE_URL set, no local server is started (see playwright.config.ts).
 */

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Ignored: errors raised inside Playwright's own Firefox driver ("juggler"), not by the
    // app. Seen once (Task 10): reloading run-20 while its worker script was still loading
    // logged NS_BINDING_ABORTED from chrome://juggler/content/content/WorkerMain.js.
    if (m.type() === 'error' && !m.text().includes('chrome://juggler/')) errors.push(m.text());
  });
});
test.afterEach(() => {
  expect(errors, 'console errors').toEqual([]);
});

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const chartTexts = (page: Page, metric: string) =>
  page.getByTestId(`metric-chart-${metric}`).evaluate((el) => [...el.querySelectorAll('svg text')].map((t) => t.textContent ?? ''));

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function openRun(page: Page, id: string) {
  await page.goto(`/runs/${id}`);
  await page.getByTestId('metric-chart-loss').locator('svg').waitFor({ timeout: 30_000 });
}

test('direct navigation and browser refresh work on every kind of URL', async ({ page }) => {
  test.setTimeout(90_000);
  const cases: [string, string | RegExp][] = [
    ['/', 'Training runs'],
    ['/?status=failed&quality=nan_loss', 'Training runs'],
    ['/runs/run-01', /\S/],
    ['/runs/run-20', /\S/],
    ['/runs/nope', 'Run not found'],
    ['/does-not-exist/deeper', 'Page not found'],
  ];
  for (const [url, title] of cases) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBe(200);
    await expect(heading(page), url).toHaveText(title);
    const before = await heading(page).textContent();
    await page.reload();
    await expect(heading(page), `${url} after reload`).toHaveText(before ?? '');
    await noHorizontalOverflow(page);
  }
  await page.goto('/?status=failed&quality=nan_loss');
  await expect(page.getByRole('status')).toHaveText('Showing 2 of 20 runs');
});

test('static assets are served as JavaScript files', async ({ page, request }) => {
  await page.goto('/');
  const scriptSrc = await page.locator('script[type="module"]').first().getAttribute('src');
  expect(scriptSrc).toMatch(/^\/assets\/.+\.js$/);
  const script = await request.get(scriptSrc ?? '');
  expect(script.status()).toBe(200);
  expect(script.headers()['content-type']).toMatch(/javascript/);
});

test('deployment: a missing asset is a real 404, not the app page', async ({ request }) => {
  // This checks the vercel.json rewrite (which excludes /assets/), so it only means something
  // against a deployment. Locally the suite runs on `vite preview`, whose own SPA fallback
  // serves index.html (200) for every unknown path, including /assets/ (checked in Task 10).
  test.skip(!process.env.PW_BASE_URL, 'Needs PW_BASE_URL: vite preview does not apply vercel.json rewrites');
  const missing = await request.get('/assets/does-not-exist-0000.js');
  expect(missing.status()).toBe(404);
});

test('the runs list shows all 20 runs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('table').getByRole('row').filter({ has: page.getByRole('rowheader') })).toHaveCount(20);
  await expect(page.getByRole('status')).toHaveText('Showing 20 of 20 runs');
  await noHorizontalOverflow(page);
});

test('million-point run: the spike at step 500,123 (loss 42.5) is in range, zooms and hovers exactly', async ({ page }) => {
  test.setTimeout(90_000);
  await openRun(page, 'run-20');
  await expect(page.getByText('1,000,000', { exact: false }).first()).toBeVisible();
  const loss = page.getByTestId('metric-chart-loss');
  await expect(loss).toHaveAttribute('data-x-max', '999999');
  expect(Number(await loss.getAttribute('data-y-max'))).toBeGreaterThanOrEqual(42.5);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(loss).not.toHaveAttribute('data-x-max', '999999');

  await page.getByLabel('From step').fill('500113');
  await page.getByLabel('To step').fill('500133');
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(loss).toHaveAttribute('data-x-min', '500113');
  await expect(loss).toHaveAttribute('data-x-max', '500133');
  expect(Number(await loss.getAttribute('data-y-max'))).toBeGreaterThanOrEqual(42.5);

  // Hover at the spike's step: the plot spans GRID.left 76 … width − 36 px (chartModel.ts).
  await loss.scrollIntoViewIfNeeded();
  const box = await loss.boundingBox();
  if (!box) throw new Error('chart not visible');
  const x = box.x + 76 + ((500_123 - 500_113) / 20) * (box.width - 76 - 36);
  await page.mouse.move(x, box.y + box.height / 2);
  const tip = page.locator('div').filter({ hasText: /^(Step |Cursor: )/ }).last();
  await expect(tip).toContainText('Step 500,123');
  await expect(tip).toContainText('Loss: 42.5');

  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(loss).toHaveAttribute('data-x-max', '999999');
  await noHorizontalOverflow(page);
});

test('NaN and ±Infinity are shown as labelled warnings, not plotted values', async ({ page }) => {
  test.setTimeout(90_000);
  await openRun(page, 'run-12');
  await expect(page.getByRole('list', { name: 'Loss chart warnings' })).toContainText('600 invalid loss values in view (600 NaN)');
  await expect.poll(() => chartTexts(page, 'loss')).toContain('NaN ×600');

  await openRun(page, 'run-14');
  await expect.poll(() => chartTexts(page, 'loss')).toContain('+Inf ×350');

  await openRun(page, 'run-19');
  await expect.poll(() => chartTexts(page, 'loss')).toEqual(expect.arrayContaining(['NaN', '-Inf']));
  await noHorizontalOverflow(page);
});
