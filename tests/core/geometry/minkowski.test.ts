import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { minkowskiSum, pointInIntRing, polygonsArea } from '../../../src/core/geometry/clipper.ts';
import {
  cleanRing,
  convexDecomposition,
  convexHull,
  convexMinkowski,
  holeInnerFit,
  minkowskiSumFast,
} from '../../../src/core/geometry/minkowski.ts';
import {
  pointRingDistance,
  ringArea,
  ringOrientation,
} from '../../../src/core/geometry/polygon.ts';
import type { Point, Polygon, Ring } from '../../../src/core/geometry/types.ts';
import { arbStarRing } from '../arbitraries.ts';

const sq = (x: number, y: number, w: number): Ring => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + w },
  { x, y: y + w },
];

const isConvexRing = (r: Ring) =>
  r.every((a, i) => {
    const b = r[(i + 1) % r.length]!;
    const c = r[(i + 2) % r.length]!;
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) >= -1e-9;
  });

const inside = (p: Point, polys: readonly Polygon[]) =>
  polys.some(
    (q) => pointInIntRing(p, q.outer) === 1 && q.holes.every((h) => pointInIntRing(p, h) === 0),
  );
const nearBoundary = (p: Point, polys: readonly Polygon[]) =>
  polys.some((q) => [q.outer, ...q.holes].some((r) => pointRingDistance(p, r) < 1e-3));

describe('minkowski přes konvexní rozklad', () => {
  it('cleanRing odstraní kolineární a duplicitní vrcholy, orientace CCW', () => {
    const r = cleanRing([
      { x: 0, y: 10 },
      { x: 5, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(r).toHaveLength(4);
    expect(ringOrientation(r)).toBe('ccw');
  });

  it('součet konvexních polygonů: čtverce i trojúhelník', () => {
    expect(ringArea(convexMinkowski(sq(0, 0, 10), sq(-2, -3, 4)))).toBeCloseTo(196, 9);
    const tri: Ring = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ];
    // Plocha A ⊕ B = |A| + |B| + 2·smíšený objem; pro čtverec 10 a trojúhelník: 100 + 6 + 10·(4 + 3).
    expect(ringArea(convexMinkowski(sq(0, 0, 10), tri))).toBeCloseTo(176, 9);
  });

  it('property: rozklad na konvexní části bez překryvu se stejnou plochou', () => {
    fc.assert(
      fc.property(arbStarRing(5, 80), ({ ring }) => {
        const parts = convexDecomposition(ring);
        expect(parts).not.toBeNull();
        for (const p of parts!) expect(isConvexRing(p)).toBe(true);
        const sum = parts!.reduce((s, p) => s + ringArea(p), 0);
        expect(sum).toBeCloseTo(ringArea(ring), 6);
      }),
    );
  });

  it('property: stejný výsledek jako Clipper MinkowskiSum (plocha, body uvnitř i vně)', () => {
    fc.assert(
      fc.property(
        arbStarRing(5, 60),
        arbStarRing(5, 60),
        fc.array(
          fc.record({
            x: fc.double({ min: -150, max: 150, noNaN: true }),
            y: fc.double({ min: -150, max: 150, noNaN: true }),
          }),
          { minLength: 20, maxLength: 20 },
        ),
        (a, b, probes) => {
          const fast = minkowskiSumFast(a.ring, b.ring);
          const ref = minkowskiSum(a.ring, b.ring);
          const area = polygonsArea(ref);
          expect(Math.abs(polygonsArea(fast) - area)).toBeLessThan(1e-4 * Math.max(1, area));
          for (const p of probes) {
            if (nearBoundary(p, ref) || nearBoundary(p, fast)) continue;
            expect(inside(p, fast)).toBe(inside(p, ref));
          }
        },
      ),
      { numRuns: 80 },
    );
  });

  /** Ozubené kolo: `teeth` zubů, každý 4 vrcholy (hlava a pata). */
  const gear = (teeth: number, r = 100, depth = 8): Ring =>
    Array.from({ length: teeth * 4 }, (_, i) => {
      const a = (2 * Math.PI * i) / (teeth * 4);
      const rr = i % 4 < 2 ? r : r - depth;
      return { x: rr * Math.cos(a), y: rr * Math.sin(a) };
    });
  /** Hřeben: `n` zubů šířky 4 a délky 30 na liště výšky 10 (CCW). */
  const comb = (n: number): Ring => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: n * 8, y: 0 },
    ];
    for (let k = n - 1; k >= 0; k--) {
      pts.push({ x: k * 8 + 8, y: 40 }, { x: k * 8 + 4, y: 40 }, { x: k * 8 + 4, y: 10 });
      pts.push({ x: k * 8, y: 10 });
    }
    return pts;
  };

  it.each([
    ['ozubení 12 zubů se sebou', gear(12), gear(12)],
    ['ozubení a hřeben', gear(12), comb(8)],
    ['hřeben se sebou (otočeným)', comb(10), comb(10).map((p) => ({ x: -p.x, y: -p.y }))],
  ])('%s: stejná plocha jako Clipper', (_, a, b) => {
    const fast = minkowskiSumFast(a, b);
    const ref = minkowskiSum(a, b);
    const area = polygonsArea(ref);
    expect(Math.abs(polygonsArea(fast) - area)).toBeLessThan(1e-4 * Math.max(1, area));
  });

  it('výkon: ozubení 24 zubů se sebou do 3 s', () => {
    // Jedno sjednocení všech |A|·|B| kusů trvalo ~30 s, kaskádové ~0,1 s
    // (mez s rezervou na souběžné testy).
    const t0 = performance.now();
    const fast = minkowskiSumFast(gear(24), gear(24));
    expect(performance.now() - t0).toBeLessThan(3000);
    // Obsahuje kruh o poloměru ~2·(100 − 8) – součet vepsaných kruhů.
    expect(polygonsArea(fast)).toBeGreaterThan(Math.PI * 180 ** 2);
  }, 20_000);
});

describe('IFP otvoru a konvexní obal', () => {
  it('convexHull: čtverec s vnitřními a kolineárními body', () => {
    const h = convexHull([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 3, y: 4 },
      { x: 0, y: 10 },
    ]);
    expect(h).toHaveLength(4);
    expect(ringArea(h)).toBe(100);
  });

  it('čtverec 20 v otvoru 100: posuny [0, 80]²; tvar L v otvoru tvaru L', () => {
    const ifp = holeInnerFit(sq(0, 0, 100).toReversed(), sq(0, 0, 20));
    expect(polygonsArea(ifp)).toBeCloseTo(80 * 80, 3);
    expect(inside({ x: 40, y: 40 }, ifp)).toBe(true);
    expect(inside({ x: 85, y: 40 }, ifp)).toBe(false);
    const lHole: Ring = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 100 },
      { x: 0, y: 100 },
    ];
    const lIfp = holeInnerFit(lHole, sq(0, 0, 20));
    // Čtverec 20 se do ramen L (šířka 30) vejde s vůlí 10 v jednom směru.
    expect(inside({ x: 50, y: 5 }, lIfp)).toBe(true);
    expect(inside({ x: 5, y: 50 }, lIfp)).toBe(true);
    expect(inside({ x: 50, y: 50 }, lIfp)).toBe(false);
    expect(holeInnerFit(sq(0, 0, 10), sq(0, 0, 20))).toEqual([]);
  });
});
