import { AREA_EPS } from './eps.ts';
import type { Orientation } from './polygon.ts';
import { pointsBBox } from './polygon.ts';
import type { Contour, Point, Rect } from './types.ts';

/** |bulge| pod touto hodnotou se bere jako úsečka. */
const BULGE_EPS = 1e-12;

/** Kruhový oblouk segmentu `from → to` s daným bulge. */
export interface Arc {
  readonly center: Point;
  readonly radius: number;
  /** Úhel počátečního bodu ve stupních. */
  readonly startAngle: number;
  /** Středový úhel ve stupních, kladný = CCW, |sweep| < 360. */
  readonly sweep: number;
}

/**
 * Oblouk segmentu `from → to`, nebo `null`, pokud je segment úsečka
 * (bulge ≈ 0) nebo má nulovou délku.
 */
export function bulgeToArc(from: Point, to: Point, bulge: number): Arc | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (Math.abs(bulge) <= BULGE_EPS || chord === 0) return null;
  // Střed leží na ose tětivy: M + levá normála · (1 − b²) / (4b).
  const k = (1 - bulge * bulge) / (4 * bulge);
  const center = { x: (from.x + to.x) / 2 - dy * k, y: (from.y + to.y) / 2 + dx * k };
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const startAngle = (Math.atan2(from.y - center.y, from.x - center.x) * 180) / Math.PI;
  const sweep = (4 * Math.atan(bulge) * 180) / Math.PI;
  return { center, radius, startAngle, sweep };
}

/** Bod uprostřed oblouku (pro úsečku střed úsečky). */
export function segmentMidpoint(from: Point, to: Point, bulge: number): Point {
  // Výška oblouku nad tětivou = bulge · tětiva / 2, kladný bulge vpravo od směru.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { x: (from.x + to.x) / 2 + (dy * bulge) / 2, y: (from.y + to.y) / 2 - (dx * bulge) / 2 };
}

/**
 * Orientovaná plocha obrysu včetně kruhových úsečí, v mm².
 * Kladná pro CCW, záporná pro CW.
 */
export function contourSignedArea(contour: Contour): number {
  const n = contour.length;
  if (n === 0) return 0;
  const o = contour[0]!;
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const a = contour[i]!;
    const b = contour[(i + 1) % n]!;
    twice += (a.x - o.x) * (b.y - o.y) - (b.x - o.x) * (a.y - o.y);
  }
  let area = twice / 2;
  for (let i = 0; i < n; i++) {
    const a = contour[i]!;
    const arc = bulgeToArc(a, contour[(i + 1) % n]!, a.bulge);
    if (!arc) continue;
    const theta = (arc.sweep * Math.PI) / 180;
    // Kruhová úseč mezi tětivou a obloukem, se znaménkem podle směru.
    area += ((arc.radius * arc.radius) / 2) * (theta - Math.sin(theta));
  }
  return area;
}

export function contourArea(contour: Contour): number {
  return Math.abs(contourSignedArea(contour));
}

/** Orientace obrysu s oblouky; plocha ≤ AREA_EPS = degenerovaný. */
export function contourOrientation(contour: Contour): Orientation {
  const a = contourSignedArea(contour);
  if (a > AREA_EPS) return 'ccw';
  if (a < -AREA_EPS) return 'cw';
  return 'degenerate';
}

/**
 * Obrys s opačnou orientací. První vrchol zůstává první; bulge segmentu
 * se neguje a přechází na vrchol, ze kterého obrácený segment vychází.
 */
export function reverseContour(contour: Contour): Contour {
  const n = contour.length;
  return contour.map((_, j) => {
    const v = contour[(n - j) % n]!;
    const bulge = contour[(2 * n - j - 1) % n]!.bulge;
    return { x: v.x, y: v.y, bulge: bulge === 0 ? 0 : -bulge };
  });
}

/** Obrys s požadovanou orientací (degenerovaný beze změny). */
export function orientContour(contour: Contour, orientation: 'ccw' | 'cw'): Contour {
  const current = contourOrientation(contour);
  return current === 'degenerate' || current === orientation ? contour : reverseContour(contour);
}

/** Leží úhel `deg` na oblouku, který začíná v `start` a má středový úhel `sweep`? */
function angleOnArc(deg: number, start: number, sweep: number): boolean {
  const rel = sweep >= 0 ? deg - start : start - deg;
  const norm = ((rel % 360) + 360) % 360;
  return norm <= Math.abs(sweep);
}

/** Přesný obalový obdélník obrysu včetně krajních bodů oblouků. */
export function contourBBox(contour: Contour): Rect {
  const pts: Point[] = [];
  const n = contour.length;
  for (let i = 0; i < n; i++) {
    const a = contour[i]!;
    pts.push(a);
    const arc = bulgeToArc(a, contour[(i + 1) % n]!, a.bulge);
    if (!arc) continue;
    const { center: c, radius: r } = arc;
    const extremes: readonly [number, Point][] = [
      [0, { x: c.x + r, y: c.y }],
      [90, { x: c.x, y: c.y + r }],
      [180, { x: c.x - r, y: c.y }],
      [270, { x: c.x, y: c.y - r }],
    ];
    for (const [deg, p] of extremes) {
      if (angleOnArc(deg, arc.startAngle, arc.sweep)) pts.push(p);
    }
  }
  return pointsBBox(pts);
}
