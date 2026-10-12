import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/dxf/${name}`, import.meta.url));

test('tvarový režim: průběh, zastavení a použití nejlepšího plánu', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');

  await page
    .getByLabel('Soubory s díly')
    .setInputFiles([fixture('blok.dxf'), fixture('spline.dxf'), fixture('zrcadleny-rozvin.dxf')]);
  for (let i = 1; i <= 3; i++) {
    await page.getByLabel(`Počet dílu ${i}`).fill('4');
    await page.getByLabel(`Počet dílu ${i}`).press('Enter');
  }
  await page.getByLabel('Režim skládání').selectOption('shape');
  await expect(page.getByLabel('Časový limit')).toHaveValue('30');
  await page.getByLabel('Časový limit').fill('60');
  await page.getByLabel('Časový limit').press('Enter');

  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByLabel('Průběh výpočtu')).toBeVisible();
  // Rychlý první výsledek (obdélníkové kombinace) se zobrazí už během výpočtu.
  await expect(page.getByRole('img', { name: /Plán tabule/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('progress-text')).toHaveText(/\d+ %/);
  await page.getByRole('button', { name: 'Zastavit a použít nejlepší' }).click();
  await expect(page.getByText('Výpočet zastaven')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^12 \/ 12 ks$/)).toBeVisible();
  await expect(page.getByRole('img', { name: /Plán tabule/ }).locator('path.part')).toHaveCount(12);

  expect(errors).toEqual([]);
});

test('tvarový režim doběhne do časového limitu sám', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByLabel('Soubory s díly').setInputFiles(fixture('dil-s-otvory.dxf'));
  await page.getByLabel('Počet dílu 1').fill('3');
  await page.getByLabel('Počet dílu 1').press('Enter');
  await page.getByLabel('Režim skládání').selectOption('shape');
  await page.getByLabel('Časový limit').fill('2');
  await page.getByLabel('Časový limit').press('Enter');
  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByRole('button', { name: 'Vypočítat' })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText('Výpočet zastaven')).toHaveCount(0);
  await expect(page.getByText(/^3 \/ 3 ks$/)).toBeVisible();
});
