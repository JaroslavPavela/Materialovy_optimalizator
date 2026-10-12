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
    const [p] = offsetPolygons([sq(0, 0, 100)], 5, 0.01);
    expect(ringOrientation(p!.outer)).toBe('ccw');
    expect(polygonsArea([p!])).toBeCloseTo(110 * 110 - (4 - Math.PI) * 25, 0);
  });

  it('nafouknutí zmenší otvor, velké nafouknutí ho zruší; záporný offset zmenšuje', () => {
    const plate = { outer: sq(0, 0, 100).outer, holes: [sq(40, 40, 20).outer.toReversed()] };
    const [a] = offsetPolygons([plate], 3, 0.01);
    expect(a!.holes).toHaveLength(1);
    expect(ringOrientation(a!.holes[0]!)).toBe('cw');
    expect(polygonsArea([{ outer: a!.holes[0]!, holes: [] }])).toBeCloseTo(14 * 14, 6);
    expect(offsetPolygons([plate], 11, 0.01)[0]!.holes).toEqual([]);
    expect(polygonsArea(offsetPolygons([sq(0, 0, 100)], -10, 0.01))).toBeCloseTo(6400, 6);
  });

  it('sjednocení, rozdíl, průnik', () => {
    expect(polygonsArea(unionPolygons([sq(0, 0, 10), sq(5, 0, 10)]))).toBeCloseTo(150, 6);
    expect(polygonsArea(differencePolygons([sq(0, 0, 10)], [sq(5, 0, 10)]))).toBeCloseTo(50, 6);
    expect(polygonsArea(intersectPolygons([sq(0, 0, 10)], [sq(5, 5, 10)]))).toBeCloseTo(25, 6);
    const ring = differencePolygons([sq(0, 0, 10)], [sq(2, 2, 6)]);
    expect(ring).toHaveLength(1);
    expect(ring[0]!.holes).toHaveLength(1);
  });

  it('Minkowského součet čtverců je čtverec součtu', () => {
    const [m] = minkowskiSum(sq(0, 0, 10).outer, sq(-2, -3, 4).outer);
    expect(polygonsArea([m!])).toBeCloseTo(196, 6);
    expect(m!.outer.map((p) => p.x).sort((a, b) => a - b)[0]).toBeCloseTo(-2, 6);
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
