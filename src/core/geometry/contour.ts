import { AREA_EPS, EPS } from './eps.ts';
import type { Orientation } from './polygon.ts';
import { pointsBBox } from './polygon.ts';
import type { Contour, Point, Rect, Ring } from './types.ts';

/**
 * Segment s výškou oblouku nad tětivou (sagitou) do této hodnoty se bere jako
 * úsečka. Práh podle sagity (ne podle bulge) zabrání numerické nestabilitě
 * u šumu z CAD: malý bulge na dlouhé tětivě by dal střed ~10¹² mm daleko.
 */
const SAGITTA_EPS = EPS / 10;

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
 * (sagita ≤ SAGITTA_EPS, včetně nulové délky).
 */
export function bulgeToArc(from: Point, to: Point, bulge: number): Arc | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if ((Math.abs(bulge) * chord) / 2 <= SAGITTA_EPS) return null;
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
    area += ((arc.radius * arc.radius) / 2) * thetaMinusSin(theta);
  }
  return area;
}

/** θ − sin θ bez ztráty přesnosti odčítáním pro malé θ (Taylorova řada). */
function thetaMinusSin(theta: number): number {
  if (Math.abs(theta) >= 1e-2) return theta - Math.sin(theta);
  const t2 = theta * theta;
  return ((theta * t2) / 6) * (1 - (t2 / 20) * (1 - t2 / 42));
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

/**
 * Body segmentu `from → to` s daným bulge: oblouk rozdělený na úsečky tak,
 * aby se tětiva od oblouku odchýlila nejvýš o `tol` (mm). Vrací body bez
 * počátečního, s koncovým (úsečka = jen `to`).
 */
export function approximateSegment(from: Point, to: Point, bulge: number, tol: number): Point[] {
  const arc = bulgeToArc(from, to, bulge);
  if (!arc) return [to];
  const { center, radius, startAngle, sweep } = arc;
  // Odchylka tětivy se středovým úhlem φ je r·(1 − cos(φ/2)).
  const maxStep = tol >= radius ? Math.PI : 2 * Math.acos(1 - tol / radius);
  const sweepRad = (Math.abs(sweep) * Math.PI) / 180;
  const n = Math.max(1, Math.ceil(sweepRad / maxStep - 1e-9));
  const out: Point[] = [];
  for (let i = 1; i < n; i++) {
    const t = ((startAngle + (sweep * i) / n) * Math.PI) / 180;
    out.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
  }
  out.push(to);
  return out;
}

/** Obrys s oblouky jako lomený obrys (oblouky aproximované s tolerancí `tol`). */
export function contourToRing(contour: Contour, tol: number): Ring {
  const out: Point[] = [];
  contour.forEach((v, i) => {
    const next = contour[(i + 1) % contour.length]!;
    out.push({ x: v.x, y: v.y });
    const pts = approximateSegment(v, next, v.bulge, tol);
    pts.pop();
    out.push(...pts);
  });
  return out;
}
