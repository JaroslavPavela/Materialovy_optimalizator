import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/dwg/${name}`, import.meta.url));

test('DWG → díly se skutečnými tvary → plán', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');

  // Dva DWG najednou (AutoCAD 2018 a 2004 v palcích); čtení DWG se načte až teď.
  await page
    .getByLabel('Soubory s díly')
    .setInputFiles([fixture('dil-s-otvory-ac1032.dwg'), fixture('palce-ac1018.dwg')]);
  await expect(
    page.getByRole('status').filter({ hasText: 'dil-s-otvory-ac1032.dwg' }),
  ).toContainText('načteno 1 dílů');
  await expect(page.getByRole('status').filter({ hasText: 'palce-ac1018.dwg' })).toContainText(
    'načteno 1 dílů',
  );
  await expect(page.getByLabel('Šířka dílu 1')).toHaveText('400');
  await expect(page.getByLabel('Šířka dílu 2')).toHaveText('101,6');

  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByText(/^2 \/ 2 ks$/)).toBeVisible();
  const paths = await page
    .getByRole('img', { name: /Plán tabule/ })
    .locator('path.part')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? ''));
  expect(paths).toHaveLength(2);
  // Otvory dílů z DWG: víc podcest v jedné cestě.
  expect(paths.every((d) => (d.match(/M/g) ?? []).length >= 2)).toBe(true);

  expect(errors).toEqual([]);
});

test('DWG starší verze ukáže srozumitelnou chybu', async ({ page }) => {
  await page.goto('/');
  const r12 = Buffer.alloc(256);
  r12.write('AC1009');
  await page
    .getByLabel('Soubory s díly')
    .setInputFiles({ name: 'stary.dwg', mimeType: 'application/acad', buffer: r12 });
  const report = page.getByRole('status').filter({ hasText: 'stary.dwg' });
  await expect(report).toContainText('načteno 0 dílů, 1 chyb');
  await expect(report.locator('.errors li')).toContainText('AutoCAD R11/R12');
});
