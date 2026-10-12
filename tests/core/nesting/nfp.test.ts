import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  intersectPolygons,
  pointInIntRing,
  polygonsArea,
} from '../../../src/core/geometry/clipper.ts';
import { pointRingDistance, rectToPolygon } from '../../../src/core/geometry/polygon.ts';
import { translatePolygon, translateRing } from '../../../src/core/geometry/transform.ts';
import type { Point, Polygon, Ring } from '../../../src/core/geometry/types.ts';
import type { Part } from '../../../src/core/model.ts';
import { feasibleRegion, ifpRect, nfp, NfpCache, SLACK } from '../../../src/core/nesting/nfp.ts';
import { ShapeCache } from '../../../src/core/nesting/shapes.ts';
import { arbStarRing } from '../arbitraries.ts';

const sq = (x: number, y: number, w: number, h = w) =>
  rectToPolygon({ x, y, width: w, height: h }).outer;

/** Poloha bodu vůči NFP: uvnitř (1), na hranici (−1), vně (0) – s otvory. */
function inside(p: Point, polys: readonly Polygon[]): number {
  for (const poly of polys) {
    const o = pointInIntRing(p, poly.outer);
    if (o === 0) continue;
    if (o === -1) return -1;
    for (const h of poly.holes) {
      const r = pointInIntRing(p, h);
      if (r === -1) return -1;
      if (r === 1) return 0;
    }
    return 1;
  }
  return 0;
}

/** Vzdálenost bodu od hranice NFP (vnějších obrysů i otvorů). */
const boundaryDist = (p: Point, polys: readonly Polygon[]) =>
  Math.min(...polys.flatMap((q) => [q.outer, ...q.holes].map((r) => pointRingDistance(p, r))));

const overlap = (a: Ring, b: Ring, t: Point) =>
  polygonsArea(
    intersectPolygons(
      [{ outer: a, holes: [] }],
      [{ outer: translateRing(b, t.x, t.y), holes: [] }],
    ),
  );

describe('nfp', () => {
  it('dva čtverce: NFP je čtverec součtu, hranice = dotyk', () => {
    const r = nfp(sq(0, 0, 10), sq(0, 0, 4));
    expect(polygonsArea(r)).toBeCloseTo(196, 6);
    expect(inside({ x: -4, y: 0 }, r)).toBe(-1);
    expect(overlap(sq(0, 0, 10), sq(0, 0, 4), { x: -4, y: 0 })).toBeCloseTo(0, 9);
    expect(inside({ x: -3.9, y: 0 }, r)).toBe(1);
    expect(inside({ x: -4.1, y: 0 }, r)).toBe(0);
  });

  it('otevřená dutina U je volná; uzavřená dutina s úzkým vstupem dá NFP s otvorem', () => {
    const u: Ring = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
      { x: 20, y: 30 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 0, y: 30 },
    ];
    const open = nfp(u, sq(0, 0, 6));
    expect(inside({ x: 12, y: 15 }, open)).toBe(0);
    expect(overlap(u, sq(0, 0, 6), { x: 12, y: 15 })).toBeCloseTo(0, 9);
    // Tvar C: dutina 20 × 20 se vstupem širokým 2 – díl 6 × 6 dovnitř neprojde,
    // ale uvnitř dutiny je přípustná „kapsa" = otvor NFP.
    const c: Ring = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 21, y: 40 },
      { x: 21, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 19, y: 30 },
      { x: 19, y: 40 },
      { x: 0, y: 40 },
    ];
    const pocket = nfp(c, sq(0, 0, 6));
    expect(pocket).toHaveLength(1);
    expect(pocket[0]!.holes).toHaveLength(1);
    expect(polygonsArea([{ outer: pocket[0]!.holes[0]!, holes: [] }])).toBeCloseTo(14 * 14, 6);
    expect(inside({ x: 17, y: 17 }, pocket)).toBe(0);
    expect(overlap(c, sq(0, 0, 6), { x: 17, y: 17 })).toBeCloseTo(0, 9);
  });

  it('property: posun hluboko v NFP = překryv, posun vně NFP = žádný překryv', () => {
    fc.assert(
      fc.property(
        arbStarRing(5, 60),
        arbStarRing(5, 40),
        fc.record({
          x: fc.double({ min: -150, max: 150, noNaN: true }),
          y: fc.double({ min: -150, max: 150, noNaN: true }),
        }),
        (a, b, t) => {
          const A = translateRing(a.ring, -a.center.x, -a.center.y);
          const B = translateRing(b.ring, -b.center.x, -b.center.y);
          const r = nfp(A, B);
          const where = inside(t, r);
          const area = overlap(A, B, t);
          if (where === 1 && boundaryDist(t, r) > 1e-2) expect(area).toBeGreaterThan(1e-6);
          if (where === 0) expect(area).toBeLessThan(1e-3);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('ifpRect', () => {
  it('rohy IFP = díl se dotýká okrajů užitné plochy', () => {
    const b = sq(-5, 2, 10, 4); // obalový obdélník [-5, 5] × [2, 6]
    const ifp = ifpRect({ x: 0, y: 0, width: 100, height: 50 }, b)!;
    // Rozšířeno o SLACK (tolerance skládání).
    expect(ifp.outer[0]!.x).toBeCloseTo(5 - SLACK, 9);
    expect(ifp.outer[0]!.y).toBeCloseTo(-2 - SLACK, 9);
    expect(ifp.outer[2]!.x).toBeCloseTo(95 + SLACK, 9);
    expect(ifp.outer[2]!.y).toBeCloseTo(44 + SLACK, 9);
  });

  it('díl větší než plocha → null, přesně na míru → úzký pruh o šířce EPS', () => {
    expect(ifpRect({ x: 0, y: 0, width: 10, height: 10 }, sq(0, 0, 11, 5))).toBeNull();
    const exact = ifpRect({ x: 0, y: 0, width: 10, height: 10 }, sq(0, 0, 10, 5))!;
    expect(polygonsArea([exact])).toBeGreaterThan(0);
  });
});

describe('feasibleRegion a cache', () => {
  const part = (id: string, w: number, h: number): Part => ({
    id,
    name: id,
    width: w,
    height: h,
    quantity: 1,
    rotation: 'ortho',
  });

  it('přípustná oblast vynechá pozice překryvu s umístěným dílem', () => {
    const shapes = new ShapeCache(0, { arcTol: 0.05, simplifyTol: 0.02 });
    const cache = new NfpCache(shapes);
    const a = part('a', 50, 50);
    const b = part('b', 20, 20);
    const ifp = ifpRect({ x: 0, y: 0, width: 100, height: 100 }, shapes.at(b, 0).outer)!;
    const free = feasibleRegion(ifp, [{ nfp: cache.parts(a, 0, b, 0), at: { x: 0, y: 0 } }]);
    // B (20 × 20, nafouknutý jen o rezervy) se nevejde do levého dolního rohu, kde je A.
    expect(inside({ x: 10, y: 10 }, free)).toBe(0);
    expect(inside({ x: 70, y: 10 }, free)).toBe(1);
    for (const q of free) {
      for (const p of q.outer) {
        const area = polygonsArea(
          intersectPolygons([shapes.at(a, 0)], [translatePolygon(shapes.at(b, 0), p.x, p.y)]),
        );
        // Překryv nejvýš do hloubky SLACK podél hrany (B má obvod ≈ 80 mm).
        expect(area).toBeLessThan(80 * SLACK);
      }
    }
  });

  it('cache vrací stejný NFP pro stejné natočení, jiný pro jiné', () => {
    const cache = new NfpCache(new ShapeCache(4));
    const a = part('a', 50, 20);
    const b = part('b', 30, 10);
    const n1 = cache.parts(a, 0, b, 0);
    expect(cache.parts(a, 0, b, 0)).toBe(n1);
    expect(cache.parts(a, 0, b, 90)).not.toBe(n1);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(2);
    const z = cache.zone('s:0', { outer: sq(0, 0, 10), holes: [] }, b, 0);
    expect(cache.zone('s:0', { outer: sq(0, 0, 10), holes: [] }, b, 0)).toBe(z);
  });
});
