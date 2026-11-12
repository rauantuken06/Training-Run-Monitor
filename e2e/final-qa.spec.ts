import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Task 09 release checks: accessibility, keyboard focus, reflow, URL state and failure paths. */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function openRun(page: Page, id: string) {
  await page.goto(`/runs/${id}`);
  await page.getByTestId('metric-chart-loss').locator('svg').waitFor({ timeout: 30_000 });
}

async function axeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`axe WCAG 2.x A/AA, ${colorScheme} theme`, () => {
    test.use({ colorScheme });
    // One axe scan of the runs list takes 3.5–6 s in Playwright's Firefox
    // (Task 09 measurement); only the time limit is raised, not any expectation.
    test.beforeEach(({ browserName }) => {
      test.slow(browserName === 'firefox', 'axe is slow in Firefox');
    });

    test('runs list (default, filtered, empty) has no violations', async ({ page }) => {
      for (const url of ['/', '/?status=failed&quality=nan_loss', '/?q=zzz']) {
        await page.goto(url);
        await page.getByRole('heading', { level: 1 }).waitFor();
        expect(await axeViolations(page), url).toEqual([]);
      }
    });

    test('run pages with anomalies, open details and a form error have no violations', async ({ page, browserName }) => {
      test.setTimeout(browserName === 'firefox' ? 360_000 : 120_000);
      const openDetails = (p: Page) =>
        p.evaluate(() => {
          document.querySelectorAll('details').forEach((d) => {
            d.open = true;
          });
        });
      const showFormError = async (p: Page) => {
        await p.getByLabel('From step').fill('5.000');
        await p.getByLabel('To step').fill('6');
        await p.getByRole('button', { name: 'Apply range' }).click();
        await expect(p.getByRole('alert')).toBeVisible();
      };
      for (const id of ['run-01', 'run-12', 'run-15', 'run-20']) {
        if (browserName !== 'firefox') {
          await openRun(page, id);
          await openDetails(page);
          await showFormError(page);
          expect(await axeViolations(page), id).toEqual([]);
          continue;
        }
        // Task 09 finding (Playwright's Firefox build only): after these six axe rules run on a
        // run page, the next user input in that document crashes the content process, and running
        // them after the range form was submitted crashes it too (reproduced 6/6; the app itself
        // works: the same form interactions pass in the other Firefox tests). So Firefox scans each
        // state in a fresh page and never interacts after a scan: the details state with every
        // rule, the form-error state without these six. Chromium runs every rule in every state.
        const crashing = ['aria-allowed-attr', 'aria-conditional-attr', 'aria-prohibited-attr', 'label-content-name-mismatch', 'nested-interactive', 'target-size'];
        test.info().annotations.push({ type: 'firefox-axe-workaround', description: `${id}: form-error state scanned without ${crashing.join(', ')}` });
        const details = await page.context().newPage();
        await openRun(details, id);
        await openDetails(details);
        expect(await axeViolations(details), `${id} (details open)`).toEqual([]);
        await details.close();
        const formError = await page.context().newPage();
        await openRun(formError, id);
        await showFormError(formError);
        const result = await new AxeBuilder({ page: formError }).withTags(WCAG_TAGS).disableRules(crashing).analyze();
        expect(result.violations.map((v) => v.id), `${id} (form error)`).toEqual([]);
        await formError.close();
      }
    });

    test('unknown run and unknown route pages have no violations', async ({ page }) => {
      for (const url of ['/runs/nope', '/does-not-exist']) {
        await page.goto(url);
        await page.getByRole('heading', { level: 1 }).waitFor();
        expect(await axeViolations(page), url).toEqual([]);
      }
    });
  });
}

test('every keyboard focus stop shows a visible focus outline', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hardware-keyboard check is desktop-only');
  for (const url of ['/', '/runs/run-15']) {
    if (url === '/') {
      await page.goto(url);
      await page.getByRole('table').waitFor();
    } else await openRun(page, 'run-15');
    const problems: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          id: `${el.tagName}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}:${Math.round(el.getBoundingClientRect().top + scrollY)}`,
          visible: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
        };
      });
      if (!stop || seen.has(stop.id)) break;
      seen.add(stop.id);
      if (!stop.visible) problems.push(stop.id);
    }
    expect(seen.size, url).toBeGreaterThan(5);
    expect(problems, url).toEqual([]);
  }
});

test('reflow: no horizontal page scrolling at 320 px and at 200% zoom (640 px)', async ({ browser }) => {
  test.setTimeout(90_000);
  for (const width of [320, 640]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    for (const url of ['/', '/runs/run-12', '/runs/run-20']) {
      await page.goto(url);
      if (url === '/') await page.getByRole('table').waitFor();
      else await page.getByTestId('metric-chart-loss').locator('svg').waitFor({ timeout: 30_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${width}px ${url}`).toBeLessThanOrEqual(0);
      if (url !== '/') await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    }
    await context.close();
  }
});

test('URL filters survive a reload and the browser Back button', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Status' }).selectOption('failed');
  await page.getByRole('combobox', { name: 'Data quality' }).selectOption('nan_loss');
  await expect(page).toHaveURL(/status=failed/);
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows).toHaveCount(3); // header + run-12 + run-19

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('failed');
  await expect(rows).toHaveCount(3);

  await page.getByRole('link', { name: 'nan-loss-fp16-overflow' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('nan-loss-fp16-overflow');
  await page.goBack();
  await expect(page).toHaveURL(/status=failed&quality=nan_loss/);
  await expect(page.getByRole('combobox', { name: 'Data quality' })).toHaveValue('nan_loss');
  await expect(rows).toHaveCount(3);
});

test('a failing Web Worker shows a visible error, and Retry recovers', async ({ page }) => {
  await page.route(/run\.worker-.*\.js/, (route) => route.abort());
  await page.goto('/runs/run-12');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText("Could not load this run's data.");
  await expect(alert).toContainText('Run worker crashed');
  await expect(page.getByTestId('metric-chart-loss')).toHaveCount(0);

  await page.unroute(/run\.worker-.*\.js/);
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('list', { name: 'Loss chart warnings' })).toContainText('600 invalid loss values', { timeout: 30_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('if the chart code cannot be downloaded, the page says so and keeps the summaries', async ({ page }) => {
  await page.route(/RunCharts-.*\.js/, (route) => route.abort());
  await page.goto('/runs/run-12');
  await expect(page.getByRole('alert')).toContainText('The chart component could not be loaded');
  await expect(page.getByTestId('quality-invalid-values')).toContainText('600');
  await expect(page.getByRole('region', { name: 'Loss', exact: true })).toContainText('NaN');
});

test('regression: fast typing in the search box keeps every character, even on a slow CPU', async ({ page, browserName }) => {
  // Task 09: the input's value came straight from the URL, which the router updates
  // asynchronously, so fast typing dropped characters ("loss" → "lss" in Firefox;
  // "nan-loss-fp16" → "nan-los-fp6" in Chrome at 6x CPU throttling, 5/5 runs).
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  }
  await page.goto('/');
  await page.getByRole('table').waitFor();
  const search = page.getByRole('searchbox', { name: 'Search' });
  for (const word of ['nan-loss-fp16', 'loss']) {
    await search.fill('');
    await search.focus();
    await page.keyboard.type(word);
    await expect(search).toHaveValue(word);
    await expect(page).toHaveURL(new RegExp(`[?&]q=${word}(&|$)`));
  }
});
