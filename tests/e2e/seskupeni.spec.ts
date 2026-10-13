import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

test('stejné tabule: seskupení s počtem opakování, přepnutí na všechny, export', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');

  // 40 čtverců 500 × 500 na tabuli 1000 × 1000 bez okraje a rozestupu = 10 stejných tabulí.
  const fill = async (label: string, value: string) => {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Enter');
  };
  await fill('Šířka tabule 1', '1000');
  await fill('Výška tabule 1', '1000');
  await fill('Okraj tabule 1', '0');
  await fill('Rozestup', '0');
  await page.getByRole('button', { name: '+ Přidat díl' }).click();
  await page.getByLabel('Název dílu 1').fill('Čtverec');
  await fill('Šířka dílu 1', '500');
  await fill('Výška dílu 1', '500');
  await fill('Počet dílu 1', '40');
  await page.getByRole('button', { name: 'Vypočítat' }).click();

  const grouped = page.getByLabel('Seskupit stejné tabule');
  await expect(grouped).toBeChecked();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toContainText('× 10');
  await expect(page.getByText('10 tabulí, různých: 1')).toBeVisible();
  await expect(page.getByText('Tato tabule se opakuje 10× (tabule 1–10).')).toBeVisible();

  const save = async (button: string) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).click();
    const d = await pending;
    const path = testInfo.outputPath(d.suggestedFilename());
    await d.saveAs(path);
    return { name: d.suggestedFilename(), data: readFileSync(path) };
  };

  expect((await save('DXF tabule 1 (× 10)')).name).toBe('narezovy-plan-tabule-01-10x.dxf');
  const zip = unzipSync(new Uint8Array((await save('DXF všech tabulí (ZIP)')).data));
  expect(Object.keys(zip)).toEqual(['narezovy-plan-tabule-01-10x.dxf']);
  const csv = (await save('CSV seznam dílů')).data.toString('utf8');
  expect(csv).toContain(
    'tabule;opakování;formát;díl;počet na tabuli;počet celkem;šířka;výška;rotace\r\n',
  );
  expect(csv).toMatch(/\r\n1;10;[^;]*;Čtverec;4;40;500;500;0\r\n/);

  // Všechny tabule: 10 záložek a soubor na každou.
  await grouped.uncheck();
  await expect(tabs).toHaveCount(10);
  await tabs.nth(3).click();
  await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true');
  expect((await save('DXF tabule 4')).name).toBe('narezovy-plan-tabule-04.dxf');
  const all = unzipSync(new Uint8Array((await save('DXF všech tabulí (ZIP)')).data));
  expect(Object.keys(all)).toHaveLength(10);
  const plain = (await save('CSV seznam dílů')).data.toString('utf8');
  expect(plain.startsWith('﻿tabule;formát;díl;počet;šířka;výška;rotace\r\n')).toBe(true);

  // Zpět seskupit: zobrazená tabule 4 patří do jediné skupiny.
  await grouped.check();
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');

  expect(errors).toEqual([]);
});
