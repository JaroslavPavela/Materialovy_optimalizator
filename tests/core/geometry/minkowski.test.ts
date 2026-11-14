import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  differencePolygons,
  minkowskiSum,
  pointInIntRing,
  polygonsArea,
  unionPolygons,
} from '../../../src/core/geometry/clipper.ts';
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
    // Širší, ale nižší díl než otvor (dřív zbyl falešný pruh šířky jednotek Clipperu).
    const wide: Ring = [
      { x: 0, y: 0 },
      { x: 108.5, y: 0 },
      { x: 108.5, y: 20 },
      { x: 0, y: 20 },
    ];
    const tall: Ring = [
      { x: 0, y: 0 },
      { x: 24.5, y: 0 },
      { x: 24.5, y: 65.5 },
      { x: 0, y: 65.5 },
    ];
    expect(holeInnerFit(tall.toReversed(), wide)).toEqual([]);
  });
});

describe('holeInnerFit – kaskádové sjednocení (code-review)', () => {
  /** Kruhový otvor s n hranami (CW) a hřeben s 5 zuby natočený o 14°. */
  const circle = (r: number, n: number): Ring =>
    Array.from({ length: n }, (_, i) => {
      const a = (-2 * Math.PI * i) / n;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  const comb = (): Ring => {
    const out: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    for (let k = 4; k >= 0; k--) {
      const a = (20 * (k + 0.6)) / 5;
      const b = (20 * (k + 0.1)) / 5;
      out.push({ x: a, y: 20 }, { x: a, y: 100 }, { x: b, y: 100 }, { x: b, y: 20 });
    }
    out.push({ x: 0, y: 20 });
    const c = Math.cos((14 * Math.PI) / 180);
    const s = Math.sin((14 * Math.PI) / 180);
    return out.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
  };

  it('dá stejnou oblast jako jedno sjednocení všech tažení a nezdrží se', () => {
    const hole = circle(133, 116);
    const b = comb();
    const start = performance.now();
    const fit = holeInnerFit(hole, b);
    const ms = performance.now() - start;
    // Reference: jedno sjednocení (původní postup).
    const pieces = convexDecomposition(b.map((p) => ({ x: -p.x, y: -p.y })))!;
    const sweeps: Polygon[] = [];
    hole.forEach((p, i) => {
      const q = hole[(i + 1) % hole.length]!;
      for (const piece of pieces) {
        sweeps.push({
          outer: convexHull([
            ...piece.map((v) => ({ x: v.x + p.x, y: v.y + p.y })),
            ...piece.map((v) => ({ x: v.x + q.x, y: v.y + q.y })),
          ]),
          holes: [],
        });
      }
    });
    const b0 = b[0]!;
    const reference = differencePolygons(
      [{ outer: hole.map((p) => ({ x: p.x - b0.x, y: p.y - b0.y })).toReversed(), holes: [] }],
      unionPolygons(sweeps),
    );
    expect(polygonsArea(fit)).toBeGreaterThan(1000);
    expect(polygonsArea(fit)).toBeCloseTo(polygonsArea(reference), 1);
    // Střed otvoru je přípustný jen tehdy, leží-li tam celý hřeben.
    expect(inside({ x: -5, y: -50 }, fit)).toBe(true);
    expect(inside({ x: 100, y: 0 }, fit)).toBe(false);
    // Pojistka výkonu (měřeno ~100 ms, jedno sjednocení ~320 ms).
    expect(ms).toBeLessThan(2000);
  });
});
