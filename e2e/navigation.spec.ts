import { expect, test } from '@playwright/test';

test('runs list page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Runs · Training Run Monitor');
  await expect(page.getByRole('heading', { level: 1, name: 'Training runs' })).toBeVisible();
});

test('run details route loads directly', async ({ page }) => {
  await page.goto('/runs/run-07');
  await expect(page.getByRole('heading', { level: 1, name: 'plateau-lr-too-low' })).toBeVisible();
  await expect(page).toHaveTitle('plateau-lr-too-low · Training Run Monitor');
});

test('navigates between list and details', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'baseline-350m-lr3e-4' }).click();
  await expect(page).toHaveURL(/\/runs\/run-01$/);
  await expect(page.getByRole('heading', { level: 1, name: 'baseline-350m-lr3e-4' })).toBeVisible();

  await page.getByRole('link', { name: /All runs/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Training runs' })).toBeVisible();
});

test('skip link is the first focusable element and targets main', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard navigation check is desktop-only');
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});
