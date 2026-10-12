import { AREA_EPS } from './eps.ts';
import type { Point, Polygon, Rect, Ring } from './types.ts';

export type Orientation = 'ccw' | 'cw' | 'degenerate';

/** Orientovaná plocha obrysu (vzorec shoelace): kladná pro CCW, záporná pro CW, v mm². */
export function ringSignedArea(ring: Ring): number {
  const n = ring.length;
  if (n < 3) return 0;
  // Počítáno relativně k prvnímu bodu – menší ztráta přesnosti u vzdálených souřadnic.
  const o = ring[0]!;
  let sum = 0;
  for (let i = 1; i < n - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    sum += (a.x - o.x) * (b.y - o.y) - (b.x - o.x) * (a.y - o.y);
  }
  return sum / 2;
}

/** Plocha obrysu bez ohledu na orientaci, v mm². */
export function ringArea(ring: Ring): number {
  return Math.abs(ringSignedArea(ring));
}

/** Plocha polygonu = vnější obrys − otvory, v mm². */
export function polygonArea(polygon: Polygon): number {
  return polygon.holes.reduce((area, hole) => area - ringArea(hole), ringArea(polygon.outer));
}

/** Orientace obrysu; obrys s plochou ≤ AREA_EPS je degenerovaný. */
export function ringOrientation(ring: Ring): Orientation {
  const a = ringSignedArea(ring);
  if (a > AREA_EPS) return 'ccw';
  if (a < -AREA_EPS) return 'cw';
  return 'degenerate';
}

/** Obrys s opačným pořadím vrcholů. První bod zůstává první. */
export function reverseRing(ring: Ring): Ring {
  if (ring.length === 0) return [];
  return [ring[0]!, ...ring.slice(1).reverse()];
}

/** Obrys s požadovanou orientací (degenerovaný obrys beze změny). */
export function orientRing(ring: Ring, orientation: 'ccw' | 'cw'): Ring {
  const current = ringOrientation(ring);
  return current === 'degenerate' || current === orientation ? ring : reverseRing(ring);
}

/** Polygon podle konvence: vnější obrys CCW, otvory CW. */
export function normalizePolygon(polygon: Polygon): Polygon {
  return {
    outer: orientRing(polygon.outer, 'ccw'),
    holes: polygon.holes.map((h) => orientRing(h, 'cw')),
  };
}

/** Obalový obdélník bodů. Pro prázdný vstup vyhodí `RangeError`. */
export function pointsBBox(points: Iterable<Point>): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX > maxX) throw new RangeError('Obalový obdélník prázdné množiny bodů neexistuje.');
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Obalový obdélník obrysu. */
export function ringBBox(ring: Ring): Rect {
  return pointsBBox(ring);
}

/** Obalový obdélník polygonu (otvory leží uvnitř vnějšího obrysu, stačí ten). */
export function polygonBBox(polygon: Polygon): Rect {
  return ringBBox(polygon.outer);
}

/** Polygon z osově rovnoběžného obdélníku (CCW, bez otvorů). */
export function rectToPolygon(r: Rect): Polygon {
  return {
    outer: [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
    ],
    holes: [],
  };
}
