import { expect, test, type Page } from '@playwright/test';

const bodyRows = (page: Page) => page.getByRole('table').getByRole('row').filter({ has: page.getByRole('rowheader') });

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('lists all 20 runs without horizontal page overflow', async ({ page }) => {
  await page.goto('/');
  await expect(bodyRows(page)).toHaveCount(20);
  await expect(page.getByText('Showing 20 of 20 runs')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('filters and sorts with the keyboard only', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hardware-keyboard interaction is desktop-only');
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search' }).focus();
  await page.keyboard.type('loss');
  await page.keyboard.press('Tab'); // → Status
  await expect(page.getByRole('combobox', { name: 'Status' })).toBeFocused();
  await page.keyboard.type('Failed'); // native select type-ahead
  await expect(page.getByText('Showing 2 of 20 runs')).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(2);

  // Sort by points via the column header button, using Enter twice (ascending, then descending).
  await page.getByRole('button', { name: /^Points/ }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('columnheader', { name: /Points/ })).toHaveAttribute('aria-sort', 'descending');

  await page.getByRole('button', { name: 'Clear filters' }).focus();
  await page.keyboard.press('Enter');
  await expect(bodyRows(page)).toHaveCount(20);
});

test('empty results offer a way back', async ({ page }) => {
  await page.goto('/?q=does-not-exist');
  await expect(page.getByRole('heading', { name: 'No runs match your filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).last().click();
  await expect(bodyRows(page)).toHaveCount(20);
});

test('back link restores the filtered list', async ({ page }) => {
  await page.goto('/?status=failed');
  await page.getByRole('link', { name: 'inf-loss-overflow' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'inf-loss-overflow' })).toBeVisible();
  await page.getByRole('link', { name: /All runs/ }).click();
  await expect(page).toHaveURL(/\?status=failed$/);
  await expect(bodyRows(page)).toHaveCount(4);
});

test('run-12 shows its NaN ending as NaN with a warning', async ({ page }) => {
  await page.goto('/runs/run-12');
  const loss = page.getByRole('region', { name: 'Loss', exact: true });
  await expect(loss.getByText(/the run ends without a valid loss value/i)).toBeVisible();
  await expect(loss.locator('dd data[value="NaN"]').first()).toHaveText('NaN');
  await expect(page.getByText(/Loss is invalid for the last 600 steps/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('run-15 conflicting duplicates can be expanded with the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hardware-keyboard interaction is desktop-only');
  await page.goto('/runs/run-15');
  const duplicates = page.getByTestId('quality-duplicates');
  await expect(duplicates).toContainText('50 conflicting · 1 identical');
  await duplicates.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(duplicates.getByText('Conflict', { exact: true }).first()).toBeVisible();
  await expect(duplicates.getByText(/\(displayed, last recorded\)/).first()).toBeVisible();
});

// The loading state is too short-lived to assert without flakiness; it was verified
// separately by recording animation frames in Chrome (see README, Task 05 notes).
test('the million-point run loads and shows the exact spike maximum', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/runs/run-20');
  await expect(page.getByRole('heading', { level: 1, name: 'large-1m-steps-loss-spike' })).toBeVisible();
  const loss = page.getByRole('region', { name: 'Loss', exact: true });
  const max = loss.locator('dt', { hasText: 'Maximum (finite)' }).locator('xpath=following-sibling::dd[1]');
  await expect(max).toContainText('42.5', { timeout: 30_000 });
  await expect(max).toContainText('at step 500,123');
  await expect(max.locator('data')).toHaveAttribute('value', '42.5');
  await expect(page.getByTestId('quality-overview')).toHaveText(/No data quality issues detected/);
  await expectNoHorizontalOverflow(page);
});
