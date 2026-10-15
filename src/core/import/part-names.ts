import { contourArea, contourBBox, contourToRing } from '../geometry/contour.ts';
import { EPS } from '../geometry/eps.ts';
import { pointInRing, pointSegmentDistance } from '../geometry/polygon.ts';
import type { Contour, Point, Rect, Ring } from '../geometry/types.ts';
import type { PartShape } from '../model.ts';
import type { ShapeRegion } from './contours.ts';
import type { DxfText } from './dxf.ts';

/** Tolerance aproximace oblouků pro testy polohy (mm). */
const RING_TOL = 0.01;
/** Největší odchylka obrysů, které se berou jako stejný tvar (mm). */
export const SAME_SHAPE_TOL = 0.05;

const inBox = (p: Point, b: Rect) =>
  p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height;

/**
 * Název každé oblasti podle textu uvnitř. Text patří nejhlouběji vnořené
 * oblasti, v jejímž vnějším obrysu leží jeho střed (text v dílu vloženém do
 * otvoru patří vloženému dílu). V oblasti vyhraje text v materiálu před
 * textem v otvoru (poznámka v otvoru ani nedokreslený díl v něm nepřebije
 * název), pak větší písmo, při shodě první ve výkresu. Bez textu `null`.
 */
export function regionLabels(
  regions: readonly ShapeRegion[],
  texts: readonly DxfText[],
): (string | null)[] {
  if (texts.length === 0) return regions.map(() => null);
  const outlines = regions.map((r) => ({
    ring: contourToRing(r.outer, RING_TOL),
    box: contourBBox(r.outer),
    holes: r.holes.map((h) => ({ ring: contourToRing(h, RING_TOL), box: contourBBox(h) })),
    depth: r.depth,
  }));
  const best: ({ text: DxfText; material: boolean } | null)[] = regions.map(() => null);
  for (const t of texts) {
    let owner = -1;
    outlines.forEach((o, i) => {
      if (owner >= 0 && outlines[owner]!.depth >= o.depth) return;
      if (inBox(t.at, o.box) && pointInRing(t.at, o.ring)) owner = i;
    });
    if (owner < 0) continue;
    const material = !outlines[owner]!.holes.some(
      (h) => inBox(t.at, h.box) && pointInRing(t.at, h.ring),
    );
    const cur = best[owner];
    const better =
      !cur ||
      (material && !cur.material) ||
      (material === cur.material && t.height > cur.text.height + EPS);
    if (better) best[owner] = { text: t, material };
  }
  return best.map((b) => b?.text.text ?? null);
}

/**
 * Mřížka hran obrysu: hrana je v každé buňce, kterou zasahuje její obalový
 * obdélník zvětšený o `margin`. Bod do vzdálenosti `margin` od hrany tak
 * leží v některé z jejích buněk – stačí projít hrany jeho buňky.
 */
interface EdgeGrid {
  readonly margin: number;
  readonly x0: number;
  readonly y0: number;
  readonly size: number;
  readonly cols: number;
  readonly rows: number;
  readonly cells: Map<number, number[]>;
}

function buildGrid(ring: Ring, box: Rect, margin: number): EdgeGrid {
  const x0 = box.x - margin;
  const y0 = box.y - margin;
  const w = box.width + 2 * margin;
  const h = box.height + 2 * margin;
  // Zhruba jedna hrana na buňku, ale buňka ne menší než 2 · margin.
  const size = Math.max(2 * margin, Math.max(w, h) / Math.max(1, Math.sqrt(ring.length)));
  const cols = Math.max(1, Math.ceil(w / size));
  const rows = Math.max(1, Math.ceil(h / size));
  const cells = new Map<number, number[]>();
  const clampCol = (x: number) => Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / size)));
  const clampRow = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - y0) / size)));
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    const c0 = clampCol(Math.min(a.x, b.x) - margin);
    const c1 = clampCol(Math.max(a.x, b.x) + margin);
    const r0 = clampRow(Math.min(a.y, b.y) - margin);
    const r1 = clampRow(Math.max(a.y, b.y) + margin);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = r * cols + c;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
    }
  });
  return { margin, x0, y0, size, cols, rows, cells };
}

/** Obrys připravený k porovnání: lomená čára s body na hranách a obalový obdélník. */
interface PreparedContour {
  readonly ring: Ring;
  /** Vrcholy a body ve ¼, ½ a ¾ každé hrany – odhalí zářez mezi vrcholy. */
  readonly samples: readonly Point[];
  readonly box: Rect;
  /** Mřížka hran – vytvoří se až při prvním plném porovnání. */
  grid: EdgeGrid | null;
}

/** Leží bod nejvýš `margin` od obrysu? */
function nearContour(p: Point, c: PreparedContour, margin: number): boolean {
  if (!c.grid || c.grid.margin !== margin) c.grid = buildGrid(c.ring, c.box, margin);
  const g = c.grid;
  const col = Math.floor((p.x - g.x0) / g.size);
  const row = Math.floor((p.y - g.y0) / g.size);
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return false;
  const edges = g.cells.get(row * g.cols + col);
  if (!edges) return false;
  return edges.some(
    (i) => pointSegmentDistance(p, c.ring[i]!, c.ring[(i + 1) % c.ring.length]!) <= margin,
  );
}

/** Tvar připravený k opakovanému porovnání (`sameShape`). */
export interface PreparedShape {
  readonly outer: PreparedContour;
  readonly holes: readonly PreparedContour[];
  readonly area: number;
}

function prepareContour(c: Contour): PreparedContour {
  const ring = contourToRing(c, RING_TOL);
  const samples: Point[] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    samples.push(a);
    for (const f of [0.25, 0.5, 0.75])
      samples.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  });
  return { ring, samples, box: contourBBox(c), grid: null };
}

export function prepareShape(shape: PartShape): PreparedShape {
  return {
    outer: prepareContour(shape.outer),
    holes: shape.holes.map(prepareContour),
    area: contourArea(shape.outer),
  };
}

const sameBox = (a: Rect, b: Rect, tol: number) =>
  Math.abs(a.x - b.x) <= tol &&
  Math.abs(a.y - b.y) <= tol &&
  Math.abs(a.width - b.width) <= tol &&
  Math.abs(a.height - b.height) <= tol;

/** Leží všechny vzorky `a` nejvýš `tol` od obrysu `b` a naopak? */
const sameContour = (a: PreparedContour, b: PreparedContour, tol: number) =>
  sameBox(a.box, b.box, tol) &&
  a.samples.every((p) => nearContour(p, b, tol + RING_TOL)) &&
  b.samples.every((p) => nearContour(p, a, tol + RING_TOL));

/**
 * Stejný tvar dílu (už posunutého do počátku): obrysy včetně otvorů se liší
 * nejvýš o `tol`, nezávisle na počátečním vrcholu, dělení hran a pořadí
 * otvorů. Natočená kopie stejný tvar není.
 */
export function samePreparedShape(
  a: PreparedShape,
  b: PreparedShape,
  tol = SAME_SHAPE_TOL,
): boolean {
  if (a.holes.length !== b.holes.length || !sameBox(a.outer.box, b.outer.box, tol)) return false;
  // Plocha se může lišit o pruh šířky tol podél obvodu (s rezervou 2×);
  // jen rychlé vyřazení, rozhoduje porovnání obrysů.
  const areaTol = 2 * tol * 2 * (a.outer.box.width + a.outer.box.height);
  if (Math.abs(a.area - b.area) > areaTol) return false;
  if (!sameContour(a.outer, b.outer, tol)) return false;
  const unmatched = [...b.holes];
  for (const h of a.holes) {
    // Kandidáti podle obalového obdélníku – plné porovnání jen u nich.
    const i = unmatched.findIndex((g) => sameBox(h.box, g.box, tol) && sameContour(h, g, tol));
    if (i < 0) return false;
    unmatched.splice(i, 1);
  }
  return true;
}

export function sameShape(a: PartShape, b: PartShape, tol = SAME_SHAPE_TOL): boolean {
  return samePreparedShape(prepareShape(a), prepareShape(b), tol);
}
