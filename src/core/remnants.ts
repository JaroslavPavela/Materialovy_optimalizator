import type { NestingInput, NestingResult, Sheet } from './model.ts';

/** Nejmenší rozměr zbytku, který má smysl uložit (mm). */
export const MIN_REMNANT_SIZE = 50;

/**
 * Zbytky výsledku jako nové tabule do skladu: obdélník zbytku (už uvnitř
 * užitné plochy a s odstupem od dílů), bez okraje, materiál a tloušťka podle
 * původní tabule, sklad 1, příznak `remnant` (při dalším výpočtu přednostně).
 * Zbytky menší než `minSize` v kterémkoli rozměru se vynechají.
 */
export function remnantSheets(
  input: NestingInput,
  result: NestingResult,
  newId: (index: number) => string,
  minSize = MIN_REMNANT_SIZE,
): Sheet[] {
  const sheets = new Map(input.sheets.map((s) => [s.id, s]));
  const out: Sheet[] = [];
  result.layouts.forEach((layout, i) => {
    const r = result.metrics.sheets[i]?.remnant;
    const sheet = sheets.get(layout.sheetId);
    if (!r || !sheet || r.width < minSize || r.height < minSize) return;
    const w = Math.floor(r.width);
    const h = Math.floor(r.height);
    out.push({
      id: newId(out.length),
      name: `Zbytek ${w} × ${h} z tabule ${i + 1} (${sheet.name})`,
      width: w,
      height: h,
      stock: 1,
      margin: 0,
      forbiddenZones: [],
      remnant: true,
      ...(sheet.material !== undefined && { material: sheet.material }),
      ...(sheet.thickness !== undefined && { thickness: sheet.thickness }),
    });
  });
  return out;
}
