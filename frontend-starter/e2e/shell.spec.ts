import { expect, test } from './support/fixtures';

test('(g) thème sombre puis clair : choix persisté après rechargement', async ({ studio }) => {
  const { page } = studio;
  await studio.goto();
  const toggle = page.getByTestId('theme-toggle');
  const html = page.locator('html');

  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('film-pulse-theme'))).toBe('light');
});

test('(h) navigation Studio, Découvrir, Amis sans erreur console', async ({ studio }) => {
  const { page } = studio;
  await studio.goto();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });

  await nav.getByRole('link', { name: 'Découvrir' }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Découvrir' })).toBeVisible();

  await nav.getByRole('link', { name: 'Amis' }).click();
  await expect(page).toHaveURL(/\/friends$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Amis' })).toBeVisible();

  await nav.getByRole('link', { name: 'Studio' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();

  expect(studio.api.unhandled).toEqual([]);
  expect(studio.consoleErrors).toEqual([]);
});
