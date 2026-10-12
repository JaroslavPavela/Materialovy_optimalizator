import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

test('výpočet → SVG tabule, ZIP SVG a tisk do PDF (strana na tabuli)', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  // Dialog tisku nahradí zachycení tiskové podoby, kterou aplikace vloží do <body>.
  await page.addInitScript(() => {
    window.print = () => {
      const root = document.querySelector('.print-root');
      (window as unknown as { __print: string | null }).__print = root ? root.outerHTML : null;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '+ Přidat díl' }).click();
  await page.getByLabel('Název dílu 1').fill('Čelo <A>');
  await page.getByLabel('Počet dílu 1').fill('40');
  await page.getByLabel('Počet dílu 1').press('Enter');
  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByRole('tab').nth(1)).toBeVisible();
  const sheets = await page.getByRole('tab').count();

  const svgDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG tabule 1' }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe('narezovy-plan-tabule-01.svg');
  const svgPath = testInfo.outputPath('tabule.svg');
  await svg.saveAs(svgPath);
  const svgText = readFileSync(svgPath, 'utf8');
  expect(svgText).toContain('Čelo &lt;A&gt;');
  // Stažené SVG je platné XML a prohlížeč ho vykreslí.
  const ok = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    return !doc.querySelector('parsererror') && doc.querySelectorAll('path[fill-rule]').length;
  }, svgText);
  expect(ok).toBeGreaterThan(0);

  const zipDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG všech tabulí (ZIP)' }).click();
  const zipPath = testInfo.outputPath('svg.zip');
  await (await zipDownload).saveAs(zipPath);
  expect(Object.keys(unzipSync(new Uint8Array(readFileSync(zipPath))))).toHaveLength(sheets);

  await page.getByLabel('Formát papíru').selectOption('A3');
  await page.getByRole('button', { name: 'Tisk / PDF' }).click();
  const printed = await page.evaluate(() => (window as unknown as { __print: string }).__print);
  expect(printed).toContain('size: A3 landscape');
  expect(printed.match(/class="print-page"/g)).toHaveLength(sheets + 1);
  expect(printed).toContain('Nářezový plán');
  // Po tisku se tisková podoba odebere.
  await expect(page.locator('.print-root')).toHaveCount(0);

  // Tiskové CSS: aplikace skrytá, jedna tabule na stránku.
  await page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), printed);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#root')).toBeHidden();
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
  expect(pages).toHaveLength(sheets + 1);

  expect(errors).toEqual([]);
});

test('CSV → výpočet → stažení DXF, SVG a CSV bez chyby', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page
    .getByLabel('Soubor CSV s díly')
    .setInputFiles(
      fileURLToPath(new URL('../fixtures/csv/excel-cz-strednik-1250.csv', import.meta.url)),
    );
  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByRole('img', { name: /Plán tabule/ })).toBeVisible();
  const placed = Number((await page.getByText(/^\d+ \/ \d+ ks$/).innerText()).split(' / ')[0]);

  const save = async (button: string, name: RegExp) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).click();
    const d = await pending;
    expect(d.suggestedFilename()).toMatch(name);
    expect(await d.failure()).toBeNull();
    const path = testInfo.outputPath(d.suggestedFilename());
    await d.saveAs(path);
    return readFileSync(path);
  };

  const dxf = (await save('DXF tabule 1', /^narezovy-plan-tabule-01\.dxf$/)).toString('latin1');
  expect(dxf).toMatch(/^0\r\nSECTION\r\n/);
  expect(dxf.endsWith('0\r\nEOF\r\n')).toBe(true);
  expect(dxf.match(/\r\nDILY\r\n/g)?.length).toBeGreaterThan(0);

  const svg = (await save('SVG tabule 1', /^narezovy-plan-tabule-01\.svg$/)).toString('utf8');
  expect(svg).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg /);

  const csv = (await save('CSV seznam dílů', /^narezovy-plan-dily\.csv$/)).toString('utf8');
  expect(csv.startsWith('﻿tabule;formát;díl;počet;šířka;výška;rotace\r\n')).toBe(true);
  const body = csv.slice(1).split('\r\n').slice(1, csv.slice(1).split('\r\n').indexOf(''));
  expect(body.reduce((sum, line) => sum + Number(line.split(';')[3]), 0)).toBe(placed);
  expect(csv).toMatch(/\r\nsouhrn;tabulí;využití;umístěno;neumístěno;odpad;\r\n/);

  expect(errors).toEqual([]);
});
