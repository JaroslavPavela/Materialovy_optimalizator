import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

test('výpočet → stažení DXF tabule a ZIP všech tabulí', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');

  await page.getByRole('button', { name: '+ Přidat díl' }).click();
  await page.getByLabel('Název dílu 1').fill('Čelo');
  await page.getByLabel('Počet dílu 1').fill('40');
  await page.getByLabel('Počet dílu 1').press('Enter');
  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByRole('tab').nth(1)).toBeVisible();

  const dxfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DXF tabule 1' }).click();
  const dxf = await dxfDownload;
  expect(dxf.suggestedFilename()).toBe('narezovy-plan-tabule-01.dxf');
  const dxfPath = testInfo.outputPath('tabule.dxf');
  await dxf.saveAs(dxfPath);
  const text = readFileSync(dxfPath, 'utf8');
  expect(text).toContain('AC1009');
  expect(text).toContain('\\U+010Celo');

  const zipDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DXF všech tabulí (ZIP)' }).click();
  const zip = await zipDownload;
  expect(zip.suggestedFilename()).toBe('narezovy-plan-dxf.zip');
  const zipPath = testInfo.outputPath('vse.zip');
  await zip.saveAs(zipPath);
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const names = Object.keys(files);
  expect(names.length).toBe(await page.getByRole('tab').count());
  expect(names[0]).toBe('narezovy-plan-tabule-01.dxf');
  expect(strFromU8(files[names[0]!]!)).toBe(text);

  expect(errors).toEqual([]);
});
