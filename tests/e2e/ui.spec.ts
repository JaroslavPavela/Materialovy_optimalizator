import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/csv/${name}`, import.meta.url));

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test('ruční zadání dílu, tabule a zóny → výpočet → náhled', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Vypočítat' })).toBeDisabled();
  await page.getByRole('button', { name: '+ Přidat díl' }).click();
  await page.getByLabel('Název dílu 1').fill('Bok');
  await page.getByLabel('Šířka dílu 1').fill('720,5');
  await page.getByLabel('Šířka dílu 1').press('Enter');
  await page.getByLabel('Počet dílu 1').fill('6');
  await page.getByLabel('Počet dílu 1').press('Tab');
  await page.getByLabel('Rotace dílu 1').selectOption('locked');

  // Neplatná hodnota se označí a do store se nepropíše.
  await page.getByLabel('Počet dílu 1').fill('1,5');
  await page.getByLabel('Počet dílu 1').press('Enter');
  await expect(page.getByLabel('Počet dílu 1')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Počet dílu 1').fill('6');
  await page.getByLabel('Počet dílu 1').press('Enter');

  await page.getByRole('button', { name: '+ Zakázaná zóna' }).click();
  await page.getByLabel('Rozestup').fill('8');
  await page.getByLabel('Rozestup').press('Enter');

  await page.getByRole('button', { name: 'Vypočítat' }).click();
  await expect(page.getByTestId('utilization')).not.toHaveText('0,0 %');
  const plan = page.getByRole('img', { name: /Plán tabule/ });
  await expect(plan).toBeVisible();
  await expect(plan.locator('path.part')).toHaveCount(6);
  await expect(plan.locator('path.zone')).toHaveCount(1);
  await expect(plan.locator('text.part-label').first()).toHaveText('Bok');

  // Přiblížení, posun a návrat na celou tabuli mění výřez.
  const initial = await plan.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Přiblížit' }).click();
  expect(await plan.getAttribute('viewBox')).not.toBe(initial);
  const box = (await plan.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Celá tabule' }).click();
  expect(await plan.getAttribute('viewBox')).toBe(initial);

  // Změna zadání po výpočtu se ohlásí.
  await page.getByLabel('Název dílu 1').fill('Bok levý');
  await expect(page.getByText('Zadání se od výpočtu změnilo')).toBeVisible();

  expect(errors).toEqual([]);
});

test('import CSV → více tabulí → přepínání záložkami', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await page.getByLabel('Soubory s díly').setInputFiles(fixture('utf8-bom.csv'));
  await expect(page.getByRole('status').filter({ hasText: 'utf8-bom.csv' })).toBeVisible();
  await page.getByLabel('Šířka tabule 1').fill('1000');
  await page.getByLabel('Šířka tabule 1').press('Enter');
  await page.getByLabel('Výška tabule 1').fill('700');
  await page.getByLabel('Výška tabule 1').press('Enter');
  await page.getByRole('button', { name: 'Vypočítat' }).click();

  const tabs = page.getByRole('tab');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  expect(await tabs.count()).toBeGreaterThan(1);
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  const plan = page.getByRole('img', { name: /Plán tabule/ });
  await expect(plan.locator('path.part').first()).toBeVisible();
  await expect(page.getByText('Ďáblík – ozdoba').first()).toBeAttached();

  expect(errors).toEqual([]);
});

test('velký soubor: průběh, zastavení a přepínání výběrem', async ({ page }) => {
  // 10 389 kusů: jeden krok MaxRects trvá několik sekund (výkon řeší krok 5.7).
  // Lokátory jsou CSS – getByRole s názvem počítá přístupná jména všech
  // 8000 polí tabulky dílů při každém pokusu a test by zbytečně zdržoval.
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/');
  const button = (text: string) => page.locator('button', { hasText: text });
  const byLabel = (label: string) => page.locator(`[aria-label="${label}"]`);

  await byLabel('Soubory s díly').setInputFiles(fixture('velky-1000-dilu.csv'));
  await button('Vypočítat').click();
  await expect(byLabel('Průběh výpočtu')).toBeVisible();
  // Po prvním kroku je k dispozici nejlepší dosavadní výsledek.
  const select = page.locator('select[aria-label="Tabule"]');
  // Při zátěži stroje (souběžné testy) trvá první krok i desítky sekund.
  await expect(select).toBeVisible({ timeout: 60_000 });
  await button('Zastavit a použít nejlepší').click();
  await expect(page.locator('.calculate [role="status"]')).toContainText('Výpočet zastaven', {
    timeout: 60_000,
  });
  await expect(button('Vypočítat')).toBeEnabled();

  await expect(byLabel('Předchozí tabule')).toBeDisabled();
  await byLabel('Další tabule').click();
  await expect(select).toHaveValue('1');
  await select.selectOption('5');
  await expect(page.locator('svg path.part').first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('chybný CSV ukáže chyby s čísly řádků', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByLabel('Soubory s díly').setInputFiles(fixture('chyby.csv'));
  await expect(page.locator('.import-report .errors li').first()).toContainText(/řád/i);
  expect(errors).toEqual([]);
});
