import type { Page } from '@playwright/test';

/**
 * Vyplní číselná pole podle popisku (Enter potvrdí hodnotu). Testy tak
 * nezávisí na výchozí tabuli a dílu aplikace, které si uživatel může změnit.
 */
export async function fillFields(page: Page, fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) {
    const input = page.getByLabel(label, { exact: true });
    await input.fill(value);
    await input.press('Enter');
  }
}

/** Tabule 2800 × 2070 mm a díl 1 o rozměru 500 × 300 mm, 1 ks. */
export const TEST_SHEET_AND_PART = {
  'Šířka tabule 1': '2800',
  'Výška tabule 1': '2070',
  'Šířka dílu 1': '500',
  'Výška dílu 1': '300',
  'Počet dílu 1': '1',
};
