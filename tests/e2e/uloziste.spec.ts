import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Počká na automatické uložení (prodleva 400 ms) a obnoví stránku. */
async function reloadAfterSave(page: Page) {
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Materiálový optimalizátor' })).toBeVisible();
}

test('projekt a knihovna formátů přežijí obnovení stránky', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await page.getByRole('button', { name: '+ Přidat díl' }).click();
  await page.getByLabel('Název dílu 1').fill('Police');
  await page.getByLabel('Název tabule 1').fill('Plech 3000');
  await page.getByLabel('Okraj tabule 1').fill('15');
  await page.getByLabel('Okraj tabule 1').press('Enter');
  await page.getByRole('button', { name: 'Uložit do knihovny' }).click();
  await reloadAfterSave(page);

  await expect(page.getByLabel('Název dílu 1')).toHaveValue('Police');
  await expect(page.getByLabel('Okraj tabule 1')).toHaveValue('15');
  await expect(page.getByRole('button', { name: 'Přidat formát Plech 3000' })).toBeVisible();

  // Nový projekt smaže díly, knihovna zůstane a formát jde přidat.
  await page.getByRole('button', { name: 'Nový projekt' }).click();
  await page.getByRole('button', { name: 'Ano, nový projekt' }).click();
  await expect(page.getByLabel('Název dílu 1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Přidat formát Plech 3000' }).click();
  await expect(page.getByLabel('Název tabule 2')).toHaveValue('Plech 3000');
  await expect(page.getByLabel('Okraj tabule 2')).toHaveValue('15');
  await reloadAfterSave(page);
  await expect(page.getByLabel('Název tabule 2')).toHaveValue('Plech 3000');

  expect(errors).toEqual([]);
});

test('uložení projektu do JSON a jeho načtení', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: '+ Přidat díl' }).click();
  await page.getByLabel('Název dílu 1').fill('Dvířka');
  await page.getByLabel('Rozestup').fill('4,5');
  await page.getByLabel('Rozestup').press('Enter');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Uložit jako JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^narezovy-plan-\d{4}-\d{2}-\d{2}\.json$/);
  const path = testInfo.outputPath('projekt.json');
  await download.saveAs(path);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
    format: 'materialovy-optimalizator/projekt',
    params: { spacing: 4.5 },
  });

  await page.getByRole('button', { name: 'Nový projekt' }).click();
  await page.getByRole('button', { name: 'Ano, nový projekt' }).click();
  await expect(page.getByLabel('Rozestup')).toHaveValue('6');

  await page.getByLabel('Soubor projektu JSON').setInputFiles(path);
  await expect(page.getByText('projekt.json: projekt načten.')).toBeVisible();
  await expect(page.getByLabel('Název dílu 1')).toHaveValue('Dvířka');
  await expect(page.getByLabel('Rozestup')).toHaveValue('4,5');

  // Cizí soubor se odmítne a zadání zůstane.
  await page.getByLabel('Soubor projektu JSON').setInputFiles({
    name: 'cizi.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"a": 1}'),
  });
  await expect(page.getByText('cizi.json: projekt nelze načíst.')).toBeVisible();
  await expect(page.getByLabel('Název dílu 1')).toHaveValue('Dvířka');

  expect(errors).toEqual([]);
});
