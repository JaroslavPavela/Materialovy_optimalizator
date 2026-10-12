import { contourArea } from './geometry/contour.ts';
import { EPS } from './geometry/eps.ts';
import { ringBBox } from './geometry/polygon.ts';
import type { Rect } from './geometry/types.ts';
import type {
  NestingInput,
  NestingMetrics,
  Part,
  Sheet,
  SheetLayout,
  SheetMetrics,
} from './model.ts';
import { placePart } from './placed.ts';

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

/**
 * Zbytek bez volných obdélníků (tvarový režim): větší z pruhů vpravo a nahoře
 * od obalových obdélníků dílů, s odstupem rozestupu od dílů i zakázaných zón
 * a uvnitř tabule zmenšené o okraj. `null`, když žádný pruh nezbývá.
 */
export function stripRemnant(input: NestingInput, sheet: Sheet, layout: SheetLayout): Rect | null {
  const parts = new Map(input.parts.map((p) => [p.id, p]));
  const s = input.params.spacing;
  const m = sheet.margin;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of layout.placements) {
    const part = parts.get(p.partId);
    if (!part) throw new RangeError(`Umístění odkazuje na neznámý díl „${p.partId}".`);
    const bb = placePart(part, p).bbox;
    maxX = Math.max(maxX, bb.x + bb.width);
    maxY = Math.max(maxY, bb.y + bb.height);
  }
  const x0 = layout.placements.length > 0 ? maxX + s : m;
  const y0 = layout.placements.length > 0 ? maxY + s : m;
  const candidates: Rect[] = [
    { x: x0, y: m, width: sheet.width - m - x0, height: sheet.height - 2 * m },
    { x: m, y: y0, width: sheet.width - 2 * m, height: sheet.height - m - y0 },
  ];
  const zones = sheet.forbiddenZones.map((z) => ringBBox(z.polygon));
  const free = candidates.filter(
    (r) =>
      r.width > EPS &&
      r.height > EPS &&
      zones.every(
        (z) =>
          z.x - s >= r.x + r.width ||
          r.x >= z.x + z.width + s ||
          z.y - s >= r.y + r.height ||
          r.y >= z.y + z.height + s,
      ),
  );
  if (free.length === 0) return null;
  return free.reduce((a, b) => (b.width * b.height > a.width * a.height + EPS ? b : a));
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
      remnant: layout.freeRects
        ? largestRemnant(layout.freeRects, input.params.spacing)
        : stripRemnant(input, sheet, layout),
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
