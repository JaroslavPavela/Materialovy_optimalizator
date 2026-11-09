import { readFileSync } from 'node:fs';
import DxfParser from 'dxf-parser';
import { expect, test, type Page } from '@playwright/test';
import { circle, dxf, line, rectPoly } from '../core/import/dxf-builder.ts';

/**
 * Deska 300 × 150 (OBRYS) s kruhovým otvorem (DIRY), ohybem přes celý díl
 * (OHYB) a kótou pod dílem (KOTY).
 */
const drawing = dxf({
  entities: [
    rectPoly(0, 0, 300, 150, [8, 'OBRYS']),
    circle(60, 75, 20, [8, 'DIRY']),
    line(150, 0, 150, 150, [8, 'OHYB']),
    line(0, -30, 300, -30, [8, 'KOTY']),
  ],
});
const file = { name: 'deska.dxf', mimeType: 'application/dxf', buffer: Buffer.from(drawing) };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

const report = (page: Page) => page.getByRole('status').filter({ hasText: 'deska.dxf' });

test('hladiny výkresu: volba rolí → plán → export DXF s původními hladinami; role se pamatují', async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await page.getByLabel('Soubory s díly').setInputFiles(file);
  // Výchozí role: vše vnější obrys – ohyb a kóta jsou neuzavřené kontury.
  await expect(report(page)).toContainText(/načteno 1 dílů, \d+ chyb/);
  for (const layer of ['DIRY', 'KOTY', 'OBRYS', 'OHYB']) {
    await expect(page.getByLabel(`Role hladiny ${layer}`)).toHaveValue('outer');
  }

  await page.getByLabel('Role hladiny OHYB').selectOption({ label: 'přidej k dílu' });
  await page.getByLabel('Role hladiny KOTY').selectOption({ label: 'ignoruj' });
  await page.getByLabel('Role hladiny DIRY').selectOption({ label: 'vnitřní obrys' });
  await expect(report(page)).toHaveText(/^deska\.dxf: načteno 1 dílů\.$/);
  await page.getByLabel('Počet dílu 1').fill('2');
  await page.getByLabel('Počet dílu 1').press('Enter');

  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByText(/^2 \/ 2 ks$/)).toBeVisible();
  const plan = page.getByRole('img', { name: /Plán tabule/ });
  await expect(plan.locator('path.part-marks')).toHaveCount(2);

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /^DXF tabule 1/ }).click();
  const path = testInfo.outputPath('hladiny.dxf');
  await (await pending).saveAs(path);
  const parsed = new DxfParser().parseSync(readFileSync(path, 'latin1'))!;
  const types = (layer: string) =>
    parsed.entities.filter((e) => e.layer === layer).map((e) => e.type);
  expect(types('OBRYS')).toEqual(['POLYLINE', 'POLYLINE']);
  expect(types('DIRY')).toEqual(['CIRCLE', 'CIRCLE']);
  expect(types('OHYB')).toEqual(['LINE', 'LINE']);
  expect(types('KOTY')).toEqual([]);
  expect(types('DILY')).toEqual([]);

  // Role se pamatují: po obnovení stránky se stejný výkres načte rovnou bez chyb.
  await page.reload();
  await page.getByRole('button', { name: 'Nový projekt' }).click();
  await page.getByLabel('Soubory s díly').setInputFiles(file);
  await expect(report(page)).toHaveText(/^deska\.dxf: načteno 1 dílů\.$/);
  await expect(page.getByLabel('Role hladiny OHYB')).toHaveValue('attach');
  await expect(page.getByLabel('Role hladiny DIRY')).toHaveValue('inner');
  expect(errors).toEqual([]);
});
