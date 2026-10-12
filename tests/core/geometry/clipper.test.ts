import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  differencePolygons,
  fromIntPath,
  intersectPolygons,
  minkowskiSum,
  offsetPolygons,
  pointInIntRing,
  polygonsArea,
  toIntPath,
  unionPolygons,
} from '../../../src/core/geometry/clipper.ts';
import {
  pointRingDistance,
  rectToPolygon,
  ringOrientation,
  simplifyRing,
} from '../../../src/core/geometry/polygon.ts';
import type { Point } from '../../../src/core/geometry/types.ts';
import { arbStarRing } from '../arbitraries.ts';

const sq = (x: number, y: number, w: number, h = w) => rectToPolygon({ x, y, width: w, height: h });

describe('clipper', () => {
  it('převod mm ↔ celá čísla (0,1 µm)', () => {
    const ring = [
      { x: 1.23456, y: -7.5 },
      { x: 10, y: 0 },
    ];
    expect(toIntPath(ring)).toEqual([
      { X: 12346, Y: -75000 },
      { X: 100000, Y: 0 },
    ]);
    expect(fromIntPath(toIntPath(ring))[0]!.x).toBeCloseTo(1.2346, 9);
  });

  it('offset čtverce: plocha (a + 2d)² − (4 − π)d², orientace CCW', () => {
    const [p] = offsetPolygons([sq(0, 0, 100)], 5, 'round', 0.01);
    expect(ringOrientation(p!.outer)).toBe('ccw');
    expect(polygonsArea([p!])).toBeCloseTo(110 * 110 - (4 - Math.PI) * 25, 0);
  });

  it('nafouknutí zmenší otvor, velké nafouknutí ho zruší; záporný offset zmenšuje', () => {
    const plate = { outer: sq(0, 0, 100).outer, holes: [sq(40, 40, 20).outer.toReversed()] };
    const [a] = offsetPolygons([plate], 3);
    expect(a!.holes).toHaveLength(1);
    expect(ringOrientation(a!.holes[0]!)).toBe('cw');
    expect(polygonsArea([{ outer: a!.holes[0]!, holes: [] }])).toBeCloseTo(14 * 14, 6);
    expect(offsetPolygons([plate], 11)[0]!.holes).toEqual([]);
    expect(polygonsArea(offsetPolygons([sq(0, 0, 100)], -10))).toBeCloseTo(6400, 6);
    // Ostré rohy (výchozí): obdélník zůstane obdélníkem přesně o 2d větším.
    expect(polygonsArea(offsetPolygons([sq(0, 0, 100, 50)], 5))).toBeCloseTo(110 * 60, 6);
  });

  it('sjednocení, rozdíl, průnik', () => {
    expect(polygonsArea(unionPolygons([sq(0, 0, 10), sq(5, 0, 10)]))).toBeCloseTo(150, 6);
    expect(polygonsArea(differencePolygons([sq(0, 0, 10)], [sq(5, 0, 10)]))).toBeCloseTo(50, 6);
    expect(polygonsArea(intersectPolygons([sq(0, 0, 10)], [sq(5, 5, 10)]))).toBeCloseTo(25, 6);
    const ring = differencePolygons([sq(0, 0, 10)], [sq(2, 2, 6)]);
    expect(ring).toHaveLength(1);
    expect(ring[0]!.holes).toHaveLength(1);
  });

  it('Minkowského součet čtverců je čtverec součtu (i když je B větší než A)', () => {
    const [m] = minkowskiSum(sq(0, 0, 10).outer, sq(-2, -3, 4).outer);
    expect(polygonsArea([m!])).toBeCloseTo(196, 6);
    expect(m!.holes).toEqual([]);
    expect(m!.outer.map((p) => p.x).sort((a, b) => a - b)[0]).toBeCloseTo(-2, 6);
    expect(polygonsArea(minkowskiSum(sq(0, 0, 4).outer, sq(0, 0, 10).outer))).toBeCloseTo(196, 6);
    expect(polygonsArea(minkowskiSum(sq(0, 0, 1).outer, sq(0, 0, 100).outer))).toBeCloseTo(
      10201,
      6,
    );
  });

  it('nekonvexní tvar C: součet je komutativní a dutina zůstane', () => {
    const c = [
      [0, 0],
      [40, 0],
      [40, 40],
      [21, 40],
      [21, 30],
      [30, 30],
      [30, 10],
      [10, 10],
      [10, 30],
      [19, 30],
      [19, 40],
      [0, 40],
    ].map(([x, y]) => ({ x: x!, y: y! }));
    const ab = minkowskiSum(c, sq(0, 0, 6).outer);
    const ba = minkowskiSum(sq(0, 0, 6).outer, c);
    expect(polygonsArea(ab)).toBeCloseTo(polygonsArea(ba), 6);
    expect(ab[0]!.holes).toHaveLength(1);
    expect(ba[0]!.holes).toHaveLength(1);
  });

  it('property: součet je komutativní a obsahuje všechny a + b (vrcholy i vnitřní body)', () => {
    fc.assert(
      fc.property(arbStarRing(1, 80), arbStarRing(1, 80), (a, b) => {
        const ab = minkowskiSum(a.ring, b.ring);
        const ba = minkowskiSum(b.ring, a.ring);
        const area = polygonsArea(ab);
        expect(Math.abs(area - polygonsArea(ba))).toBeLessThan(1e-6 * Math.max(1, area));
        // Body na hranici může zaokrouhlení na 0,1 µm posunout o jednotku ven.
        const nearBoundary = (p: Point) =>
          ab.some((poly) =>
            [poly.outer, ...poly.holes].some((r) => pointRingDistance(p, r) <= 2e-4),
          );
        const covered = (p: Point) =>
          nearBoundary(p) ||
          ab.some(
            (poly) =>
              pointInIntRing(p, poly.outer) !== 0 &&
              poly.holes.every((h) => pointInIntRing(p, h) !== 1),
          );
        for (const pa of [...a.ring, a.center]) {
          for (const pb of [...b.ring, b.center]) {
            expect(covered({ x: pa.x + pb.x, y: pa.y + pb.y })).toBe(true);
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('bod v obrysu: uvnitř, na hranici, vně', () => {
    const r = sq(0, 0, 10).outer;
    expect(pointInIntRing({ x: 5, y: 5 }, r)).toBe(1);
    expect(pointInIntRing({ x: 10, y: 5 }, r)).toBe(-1);
    expect(pointInIntRing({ x: 15, y: 5 }, r)).toBe(0);
  });
});

describe('simplifyRing (Ramer–Douglas–Peucker)', () => {
  it('property: každý původní vrchol leží do tol od zjednodušeného obrysu, vrcholy jsou podmnožinou', () => {
    fc.assert(
      fc.property(arbStarRing(10, 500), fc.constantFrom(0.01, 0.1, 1, 5), ({ ring }, tol) => {
        // Zahuštění hran, aby bylo co zjednodušovat.
        const dense: Point[] = ring.flatMap((a, i) => {
          const b = ring[(i + 1) % ring.length]!;
          return Array.from({ length: 10 }, (_, k) => ({
            x: a.x + ((b.x - a.x) * k) / 10,
            y: a.y + ((b.y - a.y) * k) / 10 + (k % 2 ? tol / 3 : 0),
          }));
        });
        const s = simplifyRing(dense, tol);
        expect(s.length).toBeLessThanOrEqual(dense.length);
        expect(s.every((p) => dense.includes(p))).toBe(true);
        for (const p of dense) expect(pointRingDistance(p, s)).toBeLessThanOrEqual(tol + 1e-9);
      }),
    );
  });

  it('malé obrysy beze změny', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(simplifyRing(tri, 10)).toBe(tri);
  });
});
