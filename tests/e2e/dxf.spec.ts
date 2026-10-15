import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { contourArea } from '../../src/core/geometry/contour.ts';
import { partsFromDxf } from '../../src/core/import/dxf-parts.ts';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/dxf/${name}`, import.meta.url));

test('DXF → plán se skutečnými tvary → export DXF se stejnými díly', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');

  // Dva soubory najednou: deska s otvory a díl se splajnem a eliptickým otvorem.
  await page
    .getByLabel('Soubory s díly')
    .setInputFiles([fixture('dil-s-otvory.dxf'), fixture('spline.dxf')]);
  await expect(page.getByRole('status').filter({ hasText: 'dil-s-otvory.dxf' })).toContainText(
    'načteno 1 dílů',
  );
  await expect(page.getByRole('status').filter({ hasText: 'spline.dxf' })).toContainText(
    'načteno 1 dílů',
  );
  // Rozměry dílů z DXF jsou jen ke čtení.
  await expect(page.getByLabel('Šířka dílu 1')).toHaveText('400');
  await expect(page.getByLabel('Výška dílu 2')).toHaveText('71,32');
  await page.getByLabel('Počet dílu 1').fill('3');
  await page.getByLabel('Počet dílu 1').press('Enter');
  await page.getByLabel('Počet dílu 2').fill('4');
  await page.getByLabel('Počet dílu 2').press('Enter');

  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByText(/^7 \/ 7 ks$/)).toBeVisible();

  // Náhled: obrysy s oblouky (příkaz A) a otvory (víc podcest v jedné cestě).
  const plan = page.getByRole('img', { name: /Plán tabule/ });
  const paths = await plan
    .locator('path.part')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? ''));
  expect(paths).toHaveLength(7);
  expect(paths.some((d) => d.includes('A'))).toBe(true);
  expect(paths.every((d) => (d.match(/M/g) ?? []).length >= 2)).toBe(true);

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DXF tabule 1' }).click();
  const download = await pending;
  const path = testInfo.outputPath('plan.dxf');
  await download.saveAs(path);

  // Export zpět importem: stejné díly (plochy včetně otvorů) jako vstup.
  const exported = partsFromDxf('plan.dxf', new Uint8Array(readFileSync(path)), {
    mode: 'multi',
    layer: (l) => l === 'DILY' || l === 'OTVORY',
  });
  expect(exported.errors).toEqual([]);
  const net = (p: (typeof exported.parts)[number]) =>
    contourArea(p.shape!.outer) - p.shape!.holes.reduce((s, h) => s + contourArea(h), 0);
  const source = ['dil-s-otvory.dxf', 'spline.dxf'].map(
    (f) => partsFromDxf(f, new Uint8Array(readFileSync(fixture(f)))).parts[0]!,
  );
  const want = [...Array(3).fill(net(source[0]!)), ...Array(4).fill(net(source[1]!))].sort();
  // Díly se pojmenují podle popisků z exportu; stejně natočené kopie se
  // sloučí (počet kusů), jinak natočené zůstanou zvlášť s příponou -2, -3…
  const copies = exported.parts.flatMap((p) => Array<typeof p>(p.quantity).fill(p));
  const got = copies.map(net).sort();
  expect(got).toHaveLength(7);
  got.forEach((a, i) => expect(Math.abs(a - want[i]!)).toBeLessThan(1));
  expect(copies.map((p) => p.shape!.holes.length).sort()).toEqual([1, 1, 1, 1, 6, 6, 6]);
  const perName = (base: string) =>
    exported.parts
      .filter((p) => new RegExp(`^${base}(-\\d+)?$`).test(p.name))
      .reduce((s, p) => s + p.quantity, 0);
  expect([perName('dil-s-otvory'), perName('spline')]).toEqual([3, 4]);
  expect(exported.parts.length).toBeLessThan(7);

  expect(errors).toEqual([]);
});

test('DXF s chybami ukáže hlášení a platné díly použije', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Soubory s díly').setInputFiles(fixture('neuzavrena.dxf'));
  const report = page.getByRole('status').filter({ hasText: 'neuzavrena.dxf' });
  await expect(report).toContainText('načteno 1 dílů, 1 chyb');
  await expect(report.locator('.errors li')).toContainText('Kontura není uzavřená');
});
