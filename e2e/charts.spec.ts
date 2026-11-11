import { expect, test, type Page } from '@playwright/test';

/** Must match GRID in src/features/charts/model/chartModel.ts. */
const GRID = { left: 76, right: 36, top: 28, bottom: 36 };
const LINE_COLOR = '#0369a1';

/**
 * Read what the browser actually drew: every vertex of the metric's line paths
 * in the SVG, plus the chart's axis bounds (exposed as data attributes).
 */
async function drawnGeometry(page: Page, metric: string) {
  return page.getByTestId(`metric-chart-${metric}`).evaluate(
    (el, lineColor) => {
      const svg = el.querySelector('svg');
      if (!svg) throw new Error('no svg');
      const vertices: [number, number][] = [];
      let paths = 0;
      for (const p of svg.querySelectorAll('path')) {
        if ((p.getAttribute('stroke') ?? '').toLowerCase() !== lineColor) continue;
        paths++;
        const nums = (p.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?(e-?\d+)?/g)?.map(Number) ?? [];
        for (let i = 0; i + 1 < nums.length; i += 2) vertices.push([nums[i] ?? 0, nums[i + 1] ?? 0]);
      }
      const { width, height } = svg.getBoundingClientRect();
      const d = (el as HTMLElement).dataset;
      return {
        vertices,
        paths,
        width,
        height,
        xMin: Number(d.xMin),
        xMax: Number(d.xMax),
        yMin: Number(d.yMin),
        yMax: Number(d.yMax),
        texts: [...svg.querySelectorAll('text')].map((t) => t.textContent ?? ''),
      };
    },
    LINE_COLOR,
  );
}

/** Distance (px) from the expected pixel of (step, value) to the nearest drawn vertex. */
async function vertexDistance(page: Page, metric: string, step: number, value: number) {
  const g = await drawnGeometry(page, metric);
  const x = GRID.left + ((step - g.xMin) / (g.xMax - g.xMin)) * (g.width - GRID.left - GRID.right);
  const y = GRID.top + ((g.yMax - value) / (g.yMax - g.yMin)) * (g.height - GRID.top - GRID.bottom);
  return Math.min(...g.vertices.map(([vx, vy]) => Math.hypot(vx - x, vy - y)));
}

async function hoverStep(page: Page, metric: string, step: number) {
  const chart = page.getByTestId(`metric-chart-${metric}`);
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  if (!box) throw new Error('chart not visible');
  const g = await drawnGeometry(page, metric);
  const x = box.x + GRID.left + ((step - g.xMin) / (g.xMax - g.xMin)) * (box.width - GRID.left - GRID.right);
  await page.mouse.move(x, box.y + box.height / 2);
}
const tooltip = (page: Page) => page.locator('div').filter({ hasText: /^Step / }).last();

async function openRun(page: Page, id: string) {
  await page.goto(`/runs/${id}`);
  await page.getByTestId('metric-chart-loss').locator('svg').waitFor({ timeout: 30_000 });
}

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

test('the 1M-point spike is drawn at its exact position, full range and zoomed', async ({ page }) => {
  test.setTimeout(60_000);
  await openRun(page, 'run-20');
  expect(await vertexDistance(page, 'loss', 500_123, 42.5)).toBeLessThan(0.5);

  await page.getByLabel('From step').fill('500000');
  await page.getByLabel('To step').fill('500300');
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-min', '500000');
  expect(await vertexDistance(page, 'loss', 500_123, 42.5)).toBeLessThan(0.5);

  // Hovering a specific step needs several pixels per step: at 300 steps on a ~200 px mobile plot,
  // one pixel spans ~1.5 steps and the tooltip (correctly) shows the neighbour nearest the cursor.
  await page.getByLabel('From step').fill('500113');
  await page.getByLabel('To step').fill('500133');
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-min', '500113');
  expect(await vertexDistance(page, 'loss', 500_123, 42.5)).toBeLessThan(0.5);
  await hoverStep(page, 'loss', 500_123);
  await expect(tooltip(page)).toContainText('Step 500,123');
  await expect(tooltip(page)).toContainText('Loss: 42.5');

  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-max', '999999');
  expect(await vertexDistance(page, 'loss', 500_123, 42.5)).toBeLessThan(0.5);
});

test('a viewport beside the spike does not draw or scale for it', async ({ page }) => {
  test.setTimeout(60_000);
  await openRun(page, 'run-20');
  await page.getByLabel('From step').fill('500124');
  await page.getByLabel('To step').fill('510000');
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.getByTestId('metric-chart-loss')).toHaveAttribute('data-x-min', '500124');
  const yMax = Number(await page.getByTestId('metric-chart-loss').getAttribute('data-y-max'));
  expect(yMax).toBeLessThan(5);
});

test('drag zoom and keyboard zoom move all three charts together', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mouse drag and hardware keyboard are desktop interactions');
  await openRun(page, 'run-01');
  const loss = page.getByTestId('metric-chart-loss');
  await loss.scrollIntoViewIfNeeded();
  const box = await loss.boundingBox();
  if (!box) throw new Error('no box');
  await page.mouse.move(box.x + 300, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 110, { steps: 4 });
  await page.mouse.up();
  const range = await loss.evaluate((el) => [(el as HTMLElement).dataset.xMin, (el as HTMLElement).dataset.xMax]);
  expect(Number(range[1]) - Number(range[0])).toBeLessThan(19_990);
  for (const m of ['lr', 'grad_norm']) {
    await expect(page.getByTestId(`metric-chart-${m}`)).toHaveAttribute('data-x-min', range[0] ?? '');
  }

  await page.getByRole('button', { name: 'Reset zoom' }).focus();
  await page.keyboard.press('Enter');
  await expect(loss).toHaveAttribute('data-x-max', '19990');
  await page.getByRole('button', { name: 'Zoom in' }).focus();
  await page.keyboard.press('Enter');
  await expect(loss).toHaveAttribute('data-x-min', '4998');
  await expect(page.getByText('Showing steps 4,998–14,993 of 0–19,990')).toBeVisible();
});

test('gaps break the line and are labelled; hovering a gap explains it', async ({ page, isMobile }) => {
  await openRun(page, 'run-17');
  const g = await drawnGeometry(page, 'loss');
  expect(g.paths).toBe(4);
  expect(g.texts).toEqual(expect.arrayContaining(['gap ×100', 'gap ×1', 'gap ×200']));
  await expect(page.getByRole('list', { name: 'Loss chart warnings' })).toContainText('301 missing steps in 3 ranges');
  if (!isMobile) {
    await hoverStep(page, 'loss', 3_500);
    await expect(tooltip(page)).toContainText('Missing steps 3,000–3,990 (100 not recorded)');
  }
});

test('NaN, +Infinity and -Infinity are labelled markers, never plotted values', async ({ page }) => {
  await openRun(page, 'run-12');
  expect((await drawnGeometry(page, 'loss')).texts).toContain('NaN ×600');
  await expect(page.getByRole('list', { name: 'Loss chart warnings' })).toContainText('600 invalid loss values in view (600 NaN)');

  await openRun(page, 'run-14');
  expect((await drawnGeometry(page, 'loss')).texts).toContain('+Inf ×350');

  await openRun(page, 'run-19');
  const g = await drawnGeometry(page, 'loss');
  expect(g.texts).toEqual(expect.arrayContaining(['NaN', '-Inf']));
  expect(g.paths).toBe(4);
});

test('conflicting duplicates are flagged on the chart', async ({ page }) => {
  await openRun(page, 'run-15');
  await expect(page.getByRole('list', { name: 'Loss chart warnings' })).toContainText('50 steps were logged more than once with different loss values');
});

test('charts fit the viewport without horizontal overflow', async ({ page }) => {
  test.setTimeout(60_000);
  await openRun(page, 'run-20');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(await vertexDistance(page, 'loss', 500_123, 42.5)).toBeLessThan(0.5);
});
