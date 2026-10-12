import { contourArea } from './geometry/contour.ts';
import { EPS } from './geometry/eps.ts';
import type { Rect } from './geometry/types.ts';
import type { NestingInput, NestingMetrics, Part, SheetLayout, SheetMetrics } from './model.ts';

/** Skutečná plocha dílu v mm²: tvar s odečtenými otvory, jinak obdélník. */
export function partArea(part: Part): number {
  if (!part.shape) return part.width * part.height;
  return part.shape.holes.reduce(
    (area, hole) => area - contourArea(hole),
    contourArea(part.shape.outer),
  );
}

/**
 * Zbytek z volných obdélníků MaxRects (v prostoru dílů nafouknutých o s/2):
 * největší z nich zmenšený o s/2 z každé strany. Výsledek leží uvnitř tabule
 * zmenšené o okraj a od dílů i zakázaných zón drží celý rozestup.
 * `null`, když žádný volný obdélník nemá kladné rozměry.
 */
export function largestRemnant(freeRects: readonly Rect[], spacing: number): Rect | null {
  let best: Rect | null = null;
  for (const f of freeRects) {
    const r: Rect = {
      x: f.x + spacing / 2,
      y: f.y + spacing / 2,
      width: f.width - spacing,
      height: f.height - spacing,
    };
    if (r.width <= EPS || r.height <= EPS) continue;
    if (!best || r.width * r.height > best.width * best.height + EPS) best = r;
  }
  return best;
}

/** Rozložení tabule, volitelně s volnými obdélníky z MaxRects (pro zbytek). */
export interface MeasuredLayout extends SheetLayout {
  readonly freeRects?: readonly Rect[];
}

/**
 * Metriky výsledku: využití po tabulích i celkem, odpad a zbytky.
 * Využití = plocha dílů (s odečtenými otvory) / plocha tabule.
 */
export function computeMetrics(
  input: NestingInput,
  layouts: readonly MeasuredLayout[],
  unplacedCount: number,
): NestingMetrics {
  const parts = new Map(input.parts.map((p) => [p.id, p]));
  const sheets = new Map(input.sheets.map((s) => [s.id, s]));
  const areaOf = new Map<string, number>();
  const area = (id: string) => {
    let a = areaOf.get(id);
    if (a === undefined) {
      const part = parts.get(id);
      if (!part) throw new RangeError(`Umístění odkazuje na neznámý díl „${id}".`);
      a = partArea(part);
      areaOf.set(id, a);
    }
    return a;
  };

  let placedCount = 0;
  const perSheet: SheetMetrics[] = layouts.map((layout) => {
    const sheet = sheets.get(layout.sheetId);
    if (!sheet) throw new RangeError(`Rozložení odkazuje na neznámou tabuli „${layout.sheetId}".`);
    const partAreaSum = layout.placements.reduce((sum, p) => sum + area(p.partId), 0);
    placedCount += layout.placements.length;
    const sheetArea = sheet.width * sheet.height;
    return {
      partArea: partAreaSum,
      sheetArea,
      utilization: sheetArea > 0 ? partAreaSum / sheetArea : 0,
      remnant: layout.freeRects ? largestRemnant(layout.freeRects, input.params.spacing) : null,
    };
  });

  const totalParts = perSheet.reduce((s, m) => s + m.partArea, 0);
  const totalSheets = perSheet.reduce((s, m) => s + m.sheetArea, 0);
  const utilization = totalSheets > 0 ? totalParts / totalSheets : 0;
  return {
    sheets: perSheet,
    utilization,
    waste: totalSheets > 0 ? 1 - utilization : 0,
    placedCount,
    unplacedCount,
  };
}
