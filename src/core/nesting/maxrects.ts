import { EPS } from '../geometry/eps.ts';
import { ringBBox } from '../geometry/polygon.ts';
import { translationForCorner } from '../geometry/transform.ts';
import { placePart } from '../placed.ts';
import type { Rect } from '../geometry/types.ts';
import {
  rectRotations,
  sheetMatchesPart,
  type NestingInput,
  type Part,
  type Placement,
  type Sheet,
  type SheetLayout,
  type UnplacedPart,
  type UnplacedReason,
} from '../model.ts';

/**
 * Heuristiky výběru volného obdélníku (Jylänki, „A Thousand Ways to Pack the Bin"):
 * - `BSSF` – nejmenší kratší zbytek, pak nejmenší delší zbytek,
 * - `BLSF` – nejmenší delší zbytek, pak nejmenší kratší,
 * - `BAF` – nejmenší volný obdélník (plochou), pak nejmenší kratší zbytek,
 * - `BL` – nejnižší horní hrana, pak nejlevější.
 */
export type RectHeuristic = 'BSSF' | 'BLSF' | 'BAF' | 'BL';
export const RECT_HEURISTICS: readonly RectHeuristic[] = ['BSSF', 'BLSF', 'BAF', 'BL'];

/** Řazení kusů před skládáním (vždy sestupně). */
export type PartOrder = 'area' | 'longSide' | 'perimeter' | 'height';
export const PART_ORDERS: readonly PartOrder[] = ['area', 'longSide', 'perimeter', 'height'];

export interface MaxRectsOptions {
  readonly heuristics?: readonly RectHeuristic[];
  readonly orders?: readonly PartOrder[];
}

export interface MaxRectsLayout extends SheetLayout {
  /**
   * Volné obdélníky po skládání v souřadnicích tabule, v prostoru nafouknutých
   * dílů (užitná plocha = tabule − okraj + rozestup/2).
   */
  readonly freeRects: readonly Rect[];
}

export interface MaxRectsResult {
  readonly layouts: readonly MaxRectsLayout[];
  readonly unplaced: readonly UnplacedPart[];
  readonly heuristic: RectHeuristic;
  readonly order: PartOrder;
}

/** Užitná plocha tabule pro nafouknuté díly: tabule − okraj + rozestup/2. */
export function usableRect(sheet: Sheet, spacing: number): Rect {
  const half = spacing / 2;
  return {
    x: sheet.margin - half,
    y: sheet.margin - half,
    width: sheet.width - 2 * sheet.margin + spacing,
    height: sheet.height - 2 * sheet.margin + spacing,
  };
}

/**
 * Zakázané zóny jako obsazené obdélníky: obalový obdélník zóny nafouknutý
 * o rozestup/2 (v obdélníkovém režimu konzervativně i pro nepravoúhlé zóny).
 */
export function zoneObstacles(sheet: Sheet, spacing: number): Rect[] {
  const half = spacing / 2;
  return sheet.forbiddenZones.map((z) => {
    const bb = ringBBox(z.polygon);
    return {
      x: bb.x - half,
      y: bb.y - half,
      width: bb.width + spacing,
      height: bb.height + spacing,
    };
  });
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - EPS &&
  b.x < a.x + a.width - EPS &&
  a.y < b.y + b.height - EPS &&
  b.y < a.y + a.height - EPS;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.width <= outer.x + outer.width + EPS &&
  inner.y + inner.height <= outer.y + outer.height + EPS;

interface Candidate {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotated: boolean;
  readonly score1: number;
  readonly score2: number;
}

function score(free: Rect, w: number, h: number, heuristic: RectHeuristic): [number, number] {
  const dw = free.width - w;
  const dh = free.height - h;
  const short = Math.min(dw, dh);
  const long = Math.max(dw, dh);
  switch (heuristic) {
    case 'BSSF':
      return [short, long];
    case 'BLSF':
      return [long, short];
    case 'BAF':
      return [free.width * free.height - w * h, short];
    case 'BL':
      return [free.y + h, free.x];
  }
}

/** Jedna tabule v algoritmu MaxRects (seznam maximálních volných obdélníků). */
export class MaxRectsBin {
  private free: Rect[];

  constructor(usable: Rect, obstacles: readonly Rect[] = []) {
    this.free = usable.width > EPS && usable.height > EPS ? [usable] : [];
    for (const o of obstacles) this.occupy(o);
  }

  get freeRects(): readonly Rect[] {
    return this.free;
  }

  /**
   * Nejlepší pozice pro obdélník w × h (případně otočený o 90°), nebo `null`.
   * Při shodě skóre vyhrává dřívější volný obdélník a neotočená varianta.
   */
  find(w: number, h: number, allowRotate: boolean, heuristic: RectHeuristic): Candidate | null {
    let best: Candidate | null = null;
    const variants: [number, number, boolean][] = [[w, h, false]];
    if (allowRotate && Math.abs(w - h) > EPS) variants.push([h, w, true]);
    for (const f of this.free) {
      for (const [vw, vh, rotated] of variants) {
        if (vw > f.width + EPS || vh > f.height + EPS) continue;
        const [s1, s2] = score(f, vw, vh, heuristic);
        if (
          !best ||
          s1 < best.score1 - EPS ||
          (Math.abs(s1 - best.score1) <= EPS && s2 < best.score2 - EPS)
        ) {
          best = { x: f.x, y: f.y, width: vw, height: vh, rotated, score1: s1, score2: s2 };
        }
      }
    }
    return best;
  }

  /** Označí obdélník jako obsazený: rozdělí protínající volné obdélníky a odstraní obsažené. */
  occupy(r: Rect): void {
    const kept: Rect[] = [];
    const created: Rect[] = [];
    for (const f of this.free) {
      if (!overlaps(f, r)) {
        kept.push(f);
        continue;
      }
      const fRight = f.x + f.width;
      const fTop = f.y + f.height;
      const rRight = r.x + r.width;
      const rTop = r.y + r.height;
      if (r.x - f.x > EPS) created.push({ x: f.x, y: f.y, width: r.x - f.x, height: f.height });
      if (fRight - rRight > EPS) {
        created.push({ x: rRight, y: f.y, width: fRight - rRight, height: f.height });
      }
      if (r.y - f.y > EPS) created.push({ x: f.x, y: f.y, width: f.width, height: r.y - f.y });
      if (fTop - rTop > EPS) {
        created.push({ x: f.x, y: rTop, width: f.width, height: fTop - rTop });
      }
    }
    // Prune jen proti nově vzniklým: staré obdélníky byly maximální už předtím.
    const fresh = created.filter(
      (c, i) =>
        !kept.some((k) => contains(k, c)) &&
        !created.some((o, j) => j !== i && contains(o, c) && (!contains(c, o) || j < i)),
    );
    this.free = [...kept, ...fresh];
  }
}

/** Kus dílu k umístění. */
interface Item {
  readonly part: Part;
  readonly partIndex: number;
  readonly instance: number;
}

function orderKey(p: Part, order: PartOrder): number {
  switch (order) {
    case 'area':
      return p.width * p.height;
    case 'longSide':
      return Math.max(p.width, p.height);
    case 'perimeter':
      return p.width + p.height;
    case 'height':
      return p.height;
  }
}

function sortItems(items: readonly Item[], order: PartOrder): Item[] {
  return [...items].sort(
    (a, b) =>
      orderKey(b.part, order) - orderKey(a.part, order) ||
      a.partIndex - b.partIndex ||
      a.instance - b.instance,
  );
}

const canRotate = (p: Part) => rectRotations(p.rotation).includes(90);

/** Placement z levého dolního rohu nafouknutého obdélníku. */
function toPlacement(item: Item, c: Candidate, spacing: number): Placement {
  const { width, height } = item.part;
  const rotation = c.rotated ? 90 : 0;
  // Obalový obdélník dílu otočeného kolem lokálního počátku (90° CCW: [−h, 0] × [0, w]).
  const rotatedBBox = c.rotated
    ? { x: -height, y: 0, width: height, height: width }
    : { x: 0, y: 0, width, height };
  const t = translationForCorner(rotatedBBox, { x: c.x + spacing / 2, y: c.y + spacing / 2 });
  return { partId: item.part.id, instance: item.instance, x: t.x, y: t.y, rotation };
}

interface FilledSheet {
  readonly placements: Placement[];
  readonly placedArea: number;
  readonly remaining: Item[];
  readonly bin: MaxRectsBin;
}

/** Naplní jednu novou tabuli kusy v daném pořadí; co se nevejde, zůstane. */
function fillSheet(
  sheet: Sheet,
  items: readonly Item[],
  spacing: number,
  heuristic: RectHeuristic,
): FilledSheet {
  const bin = new MaxRectsBin(usableRect(sheet, spacing), zoneObstacles(sheet, spacing));
  const placements: Placement[] = [];
  const remaining: Item[] = [];
  let placedArea = 0;
  for (const item of items) {
    if (!sheetMatchesPart(item.part, sheet)) {
      remaining.push(item);
      continue;
    }
    const w = item.part.width + spacing;
    const h = item.part.height + spacing;
    const c = bin.find(w, h, canRotate(item.part), heuristic);
    if (!c) {
      remaining.push(item);
      continue;
    }
    bin.occupy(c);
    placements.push(toPlacement(item, c, spacing));
    placedArea += item.part.width * item.part.height;
  }
  return { placements, placedArea, remaining, bin };
}

/**
 * Proč se kus nevejde na žádnou prázdnou vhodnou tabuli; `null` = vejde se.
 * Materiál se posuzuje vůči všem formátům, rozměry jen vůči formátům se skladem.
 */
function unplaceableReason(
  part: Part,
  sheets: readonly Sheet[],
  spacing: number,
): UnplacedReason | null {
  const matchingAny = sheets.filter((s) => sheetMatchesPart(part, s));
  if (matchingAny.length === 0) return 'no-matching-sheet';
  // Formáty se skladem 0 se nepoužijí – když jiné vhodné nejsou, „došly tabule".
  const matching = matchingAny.filter((s) => s.stock !== 0);
  if (matching.length === 0) return 'out-of-sheets';
  const w = part.width + spacing;
  const h = part.height + spacing;
  const rotate = canRotate(part);
  const fitsRect = (r: Rect) =>
    (w <= r.width + EPS && h <= r.height + EPS) ||
    (rotate && h <= r.width + EPS && w <= r.height + EPS);
  const sizeOk = matching.filter((s) => fitsRect(usableRect(s, spacing)));
  if (sizeOk.length === 0) return 'too-large';
  const fitsEmpty = sizeOk.some((s) =>
    new MaxRectsBin(usableRect(s, spacing), zoneObstacles(s, spacing)).find(w, h, rotate, 'BL'),
  );
  return fitsEmpty ? null : 'blocked';
}

/** Jedno skládání pro danou heuristiku a řazení. */
export function packRects(
  input: NestingInput,
  heuristic: RectHeuristic,
  order: PartOrder,
): MaxRectsResult {
  const { parts, sheets, params } = input;
  const spacing = params.spacing;
  const unplaced: UnplacedPart[] = [];
  const all: Item[] = [];
  parts.forEach((part, partIndex) => {
    const reason = unplaceableReason(part, sheets, spacing);
    for (let instance = 0; instance < part.quantity; instance++) {
      if (reason) unplaced.push({ partId: part.id, instance, reason });
      else all.push({ part, partIndex, instance });
    }
  });

  let remaining = sortItems(all, order);
  const stock = sheets.map((s) => s.stock);
  const layouts: MaxRectsLayout[] = [];

  while (remaining.length > 0) {
    // Zkusit každý formát se skladem; přednost mají zbytky, pak největší
    // umístěná plocha, pak menší tabule, pak pořadí formátů.
    let best: { index: number; fill: FilledSheet } | null = null;
    sheets.forEach((sheet, index) => {
      if (stock[index] === 0) return;
      const fill = fillSheet(sheet, remaining, spacing, heuristic);
      if (fill.placements.length === 0) return;
      if (!best) {
        best = { index, fill };
        return;
      }
      const b: { index: number; fill: FilledSheet } = best;
      const bs = sheets[b.index]!;
      const remnantFirst = Number(!!sheet.remnant) - Number(!!bs.remnant);
      const better =
        remnantFirst > 0 ||
        (remnantFirst === 0 &&
          (fill.placedArea > b.fill.placedArea + EPS ||
            (Math.abs(fill.placedArea - b.fill.placedArea) <= EPS &&
              sheet.width * sheet.height < bs.width * bs.height - EPS)));
      if (better) best = { index, fill };
    });
    if (!best) break;
    const chosen: { index: number; fill: FilledSheet } = best;
    const s = stock[chosen.index];
    if (s !== null && s !== undefined) stock[chosen.index] = s - 1;
    layouts.push({
      sheetId: sheets[chosen.index]!.id,
      placements: chosen.fill.placements,
      freeRects: chosen.fill.bin.freeRects,
    });
    remaining = chosen.fill.remaining;
  }

  for (const item of remaining) {
    unplaced.push({ partId: item.part.id, instance: item.instance, reason: 'out-of-sheets' });
  }
  unplaced.sort((a, b) =>
    a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : a.instance - b.instance,
  );
  return { layouts, unplaced, heuristic, order };
}

/** Výsledek k porovnání (MaxRects i tvarový; volné obdélníky jen u MaxRects). */
export interface ComparableResult {
  readonly layouts: readonly (SheetLayout & { readonly freeRects?: readonly Rect[] })[];
  readonly unplaced: readonly UnplacedPart[];
}

const sheetArea = (input: NestingInput, r: ComparableResult) =>
  r.layouts.reduce((sum, l) => {
    const s = input.sheets.find((x) => x.id === l.sheetId)!;
    return sum + s.width * s.height;
  }, 0);

const unplacedArea = (input: NestingInput, r: ComparableResult) =>
  r.unplaced.reduce((sum, u) => {
    const p = input.parts.find((x) => x.id === u.partId)!;
    return sum + p.width * p.height;
  }, 0);

const lastRemnantArea = (r: ComparableResult) => {
  const last = r.layouts[r.layouts.length - 1];
  return last?.freeRects ? Math.max(0, ...last.freeRects.map((f) => f.width * f.height)) : 0;
};

const hasFreeRects = (r: ComparableResult) => r.layouts.at(-1)?.freeRects !== undefined;

/**
 * Volný pruh na poslední tabuli: větší z pruhů vpravo a nahoře od obalových
 * obdélníků umístěných dílů (v ploše tabule bez okraje).
 */
function lastStripArea(input: NestingInput, r: ComparableResult): number {
  const last = r.layouts.at(-1);
  if (!last) return 0;
  const sheet = input.sheets.find((s) => s.id === last.sheetId)!;
  const parts = new Map(input.parts.map((p) => [p.id, p]));
  const m = sheet.margin;
  let maxX = m;
  let maxY = m;
  for (const p of last.placements) {
    const bb = placePart(parts.get(p.partId)!, p).bbox;
    maxX = Math.max(maxX, bb.x + bb.width);
    maxY = Math.max(maxY, bb.y + bb.height);
  }
  const w = sheet.width - 2 * m;
  const h = sheet.height - 2 * m;
  return Math.max(0, (sheet.width - m - maxX) * h, (sheet.height - m - maxY) * w);
}

/**
 * Porovnání dvou výsledků: záporné číslo = `a` je lepší.
 * (1) menší plocha neumístěných kusů, (2) méně neumístěných kusů,
 * (3) menší plocha použitých tabulí, (4) méně tabulí,
 * (5) větší zbytek na poslední tabuli.
 */
export function compareRectResults(
  input: NestingInput,
  a: ComparableResult,
  b: ComparableResult,
): number {
  const missA = unplacedArea(input, a);
  const missB = unplacedArea(input, b);
  if (Math.abs(missA - missB) > EPS) return missA - missB;
  if (a.unplaced.length !== b.unplaced.length) return a.unplaced.length - b.unplaced.length;
  const areaA = sheetArea(input, a);
  const areaB = sheetArea(input, b);
  if (Math.abs(areaA - areaB) > EPS) return areaA - areaB;
  if (a.layouts.length !== b.layouts.length) return a.layouts.length - b.layouts.length;
  // Zbytek: u dvou výsledků MaxRects největší volný obdélník; jinak (tvarový
  // výsledek nemá volné obdélníky) pro oba stejně – volný pruh na poslední tabuli.
  const rects = hasFreeRects(a) && hasFreeRects(b);
  const remA = rects ? lastRemnantArea(a) : lastStripArea(input, a);
  const remB = rects ? lastRemnantArea(b) : lastStripArea(input, b);
  if (Math.abs(remA - remB) > EPS) return remB - remA;
  return 0;
}

/**
 * Obdélníkový nesting: vyzkouší všechny kombinace heuristik a řazení
 * a vrátí nejlepší výsledek. Deterministické; vstup musí projít
 * `validateNestingInput`.
 */
export function nestRects(input: NestingInput, options: MaxRectsOptions = {}): MaxRectsResult {
  const heuristics = options.heuristics ?? RECT_HEURISTICS;
  const orders = options.orders ?? PART_ORDERS;
  let best: MaxRectsResult | null = null;
  for (const order of orders) {
    for (const heuristic of heuristics) {
      const r = packRects(input, heuristic, order);
      if (!best || compareRectResults(input, r, best) < 0) best = r;
    }
  }
  if (!best) throw new RangeError('Není zadána žádná heuristika nebo řazení.');
  return best;
}
