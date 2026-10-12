import { expect, test } from '@playwright/test';

test('zbytek tabule se uloží do skladu a další výpočet ho použije přednostně', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.getByRole('button', { name: '+ Přidat díl' }).click();
  await page.getByRole('button', { name: 'Vypočítat' }).click();
  const save = page.getByRole('button', { name: /Uložit zbytky do skladu \(1\)/ });
  await save.click();
  await expect(page.getByText(/Přidáno tabulí ze zbytků: 1/)).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(page.getByLabel('Název tabule 2')).toHaveValue(/^Zbytek \d+ × \d+ z tabule 1/);
  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByRole('tab').first()).toContainText('Zbytek');
  expect(errors).toEqual([]);
});
