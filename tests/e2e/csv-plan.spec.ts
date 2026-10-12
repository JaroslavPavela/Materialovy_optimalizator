import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/csv/${name}`, import.meta.url));

/** Využití „78,4 %" → 0,784. */
const parsePercent = (text: string) => Number(text.replace(/\s|%/g, '').replace(',', '.')) / 100;

for (const name of [
  'utf8-bom.csv',
  'excel-cz-strednik-1250.csv',
  'carka-tecka.csv',
  'tabulator.tsv',
  'excel-unicode-utf16.txt',
]) {
  test(`CSV ${name} → plán a využití > 0 %`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');

    await page.getByLabel('Soubor CSV s díly').setInputFiles(fixture(name));
    const report = page.getByRole('status').filter({ hasText: name });
    await expect(report).toContainText(/načteno [1-9]\d* dílů/);
    await expect(report).not.toContainText('chyb');

    await page.getByRole('button', { name: 'Vypočítat' }).click();
    const plan = page.getByRole('img', { name: /Plán tabule/ });
    await expect(plan.locator('path.part').first()).toBeVisible();

    const utilization = parsePercent(await page.getByTestId('utilization').innerText());
    expect(utilization).toBeGreaterThan(0);
    expect(utilization).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
