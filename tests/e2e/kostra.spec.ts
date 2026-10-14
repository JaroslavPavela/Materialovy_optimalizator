import { expect, test } from '@playwright/test';

test('aplikace se načte bez chyb v konzoli', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Materiálový optimalizátor' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Logo' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText(
    'Vytvořil Jaroslav Pavela s Claude Code 2026',
  );
  expect(errors).toEqual([]);
});
