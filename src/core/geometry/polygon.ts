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

/** Obalový obdélník bodů. Pro prázdný vstup nebo NaN/±∞ vyhodí `RangeError`. */
export function pointsBBox(points: Iterable<Point>): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new RangeError(`Neplatné souřadnice bodu (${p.x}, ${p.y}).`);
    }
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

/** Vzdálenost bodu od úsečky a–b. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Vzdálenost bodu od obrysu (hranice) uzavřeného lomeného obrysu. */
export function pointRingDistance(p: Point, ring: Ring): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(best, pointSegmentDistance(p, ring[i]!, ring[(i + 1) % ring.length]!));
  }
  return best;
}

/**
 * Leží bod uvnitř obrysu? Paprsková metoda (sudý–lichý); pro bod na hranici
 * je výsledek nedefinovaný – volající ho vyloučí přes `pointRingDistance`.
 */
export function pointInRing(p: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Zjednodušení uzavřeného obrysu (Ramer–Douglas–Peucker): vynechá vrcholy,
 * dokud každý původní vrchol leží nejvýš `tol` od výsledného obrysu.
 * Na rozdíl od postupného mazání vrcholů se odchylka nesčítá.
 */
export function simplifyRing(ring: Ring, tol: number): Ring {
  const n = ring.length;
  if (n <= 4) return ring;
  // Rozdělení na dva otevřené řetězce mezi vrcholem 0 a nejvzdálenějším vrcholem.
  let far = 0;
  let farD = -1;
  ring.forEach((p, i) => {
    const d = Math.hypot(p.x - ring[0]!.x, p.y - ring[0]!.y);
    if (d > farD) {
      far = i;
      farD = d;
    }
  });
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, n],
  ];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const pa = ring[a % n]!;
    const pb = ring[b % n]!;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistance(ring[i]!, pa, pb);
      if (d > bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : ring;
}
