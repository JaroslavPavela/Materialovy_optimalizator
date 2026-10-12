import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { polygonsArea } from '../../../src/core/geometry/clipper.ts';
import { approximateSegment } from '../../../src/core/geometry/contour.ts';
import {
  pointInRing,
  pointRingDistance,
  ringOrientation,
} from '../../../src/core/geometry/polygon.ts';
import type { Contour, Point } from '../../../src/core/geometry/types.ts';
import type { Part, Sheet } from '../../../src/core/model.ts';
import {
  inflatedPartPolygon,
  inflatedZones,
  inflationDelta,
  NEST_ARC_TOL,
  NEST_SIMPLIFY_TOL,
  partPolygon,
  ShapeCache,
  usableArea,
} from '../../../src/core/nesting/shapes.ts';
import { arbStarRing } from '../arbitraries.ts';

/** Hustě vzorkovaná skutečná hranice obrysu (oblouky s odchylkou 0,001 mm). */
const truth = (c: Contour): Point[] =>
  c.flatMap((v, i) => [v, ...approximateSegment(v, c[(i + 1) % c.length]!, v.bulge, 0.001)]);

/** Nafouknutí nad s/2 nejvýš o rezervy (odchylky se mohou i sečíst). */
const MAX_EXTRA = NEST_ARC_TOL + NEST_SIMPLIFY_TOL + 1e-3;

/** Protíná lomená čára sama sebe? (vstupy property testu musí být jednoduché) */
function selfIntersects(pts: readonly Point[]): boolean {
  const n = pts.length;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j]!;
      const d = pts[(j + 1) % n]!;
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

const plate: Part = {
  id: 'p',
  name: 'Deska',
  width: 100,
  height: 60,
  quantity: 1,
  rotation: 'free',
  shape: {
    outer: [
      { x: 0, y: 0, bulge: 0 },
      { x: 70, y: 0, bulge: 1 },
      { x: 70, y: 60, bulge: 0 },
      { x: 0, y: 60, bulge: 0 },
    ],
    holes: [
      [
        { x: 20, y: 30, bulge: -1 },
        { x: 40, y: 30, bulge: -1 },
      ],
    ],
  },
};

describe('tvary pro nesting', () => {
  it('partPolygon: oblouky aproximované, orientace podle konvence', () => {
    const p = partPolygon(plate);
    expect(ringOrientation(p.outer)).toBe('ccw');
    expect(ringOrientation(p.holes[0]!)).toBe('cw');
    expect(p.outer.length).toBeGreaterThan(10);
    for (const q of truth(plate.shape!.outer)) {
      expect(pointRingDistance(q, p.outer)).toBeLessThanOrEqual(
        NEST_ARC_TOL + NEST_SIMPLIFY_TOL + 1e-9,
      );
    }
  });

  it('nafouknutý díl drží od skutečné hranice ≥ s/2 (vně i u otvoru) a ne o moc víc', () => {
    const s = 6;
    const inf = inflatedPartPolygon(plate, s);
    for (const q of truth(plate.shape!.outer)) {
      expect(pointInRing(q, inf.outer) || pointRingDistance(q, inf.outer) <= 1e-3).toBe(true);
      const d = pointRingDistance(q, inf.outer);
      expect(d).toBeGreaterThanOrEqual(s / 2 - 1e-3);
      expect(d).toBeLessThanOrEqual(s / 2 + MAX_EXTRA);
    }
    // Otvor ⌀20 se zmenší: nafouknutý otvor leží uvnitř skutečného o ≥ s/2.
    expect(inf.holes).toHaveLength(1);
    for (const q of inf.holes[0]!) {
      expect(Math.hypot(q.x - 30, q.y - 30)).toBeLessThanOrEqual(10 - s / 2 + 1e-3);
    }
  });

  it('property: náhodné tvary s oblouky – skutečná hranice uvnitř nafouknutého s rezervou ≥ s/2', () => {
    fc.assert(
      fc.property(
        arbStarRing(20, 300),
        fc.array(fc.double({ min: -0.25, max: 0.25, noNaN: true }), {
          minLength: 16,
          maxLength: 16,
        }),
        fc.constantFrom(0, 2, 6, 15),
        ({ ring }, bulges, s) => {
          const outer: Contour = ring.map((p, i) => ({ ...p, bulge: bulges[i]! }));
          fc.pre(!selfIntersects(truth(outer)));
          const part: Part = { ...plate, shape: { outer, holes: [] } };
          const inf = inflatedPartPolygon(part, s);
          for (const q of truth(outer)) {
            expect(pointInRing(q, inf.outer) || pointRingDistance(q, inf.outer) <= 1e-3).toBe(true);
            expect(pointRingDistance(q, inf.outer)).toBeGreaterThanOrEqual(s / 2 - 1e-3);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it('obdélník bez tvaru: nafouknutí o s/2 + rezervy', () => {
    const rect: Part = {
      id: 'r',
      name: 'R',
      width: 100,
      height: 50,
      quantity: 1,
      rotation: 'ortho',
    };
    const inf = inflatedPartPolygon(rect, 10);
    const d = inflationDelta(10);
    // Bez oblouků a bez zjednodušení: přesně (w + s) × (h + s), ostré rohy.
    expect(d).toBe(5);
    expect(polygonsArea([inf])).toBeCloseTo(110 * 60, 6);
  });

  it('užitná plocha: tabule − okraj + s/2; zóny nafouknuté o s/2', () => {
    const sheet: Sheet = {
      id: 's',
      name: 'S',
      width: 1000,
      height: 500,
      stock: null,
      margin: 10,
      forbiddenZones: [
        {
          id: 'z',
          polygon: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
            { x: 0, y: 50 },
          ],
        },
      ],
    };
    const u = usableArea(sheet, 6);
    expect(u.outer[0]).toEqual({ x: 7, y: 7 });
    expect(polygonsArea([u])).toBeCloseTo(986 * 486, 6);
    const z = inflatedZones(sheet, 6);
    // Zóna drží od každého bodu skutečné zóny ≥ s/2.
    const zp = sheet.forbiddenZones[0]!.polygon;
    const edgePoints = zp.flatMap((p, i) => {
      const q = zp[(i + 1) % zp.length]!;
      return [0, 0.25, 0.5, 0.75].map((t) => ({
        x: p.x + t * (q.x - p.x),
        y: p.y + t * (q.y - p.y),
      }));
    });
    for (const q of edgePoints) {
      expect(pointInRing(q, z[0]!.outer)).toBe(true);
      expect(pointRingDistance(q, z[0]!.outer)).toBeGreaterThanOrEqual(3);
    }
    expect(polygonsArea(z)).toBeLessThan(57 * 57);
    expect(inflatedZones({ ...sheet, forbiddenZones: [] }, 6)).toEqual([]);
  });

  it('cache: stejný objekt pro stejné natočení, otočení kolem lokálního počátku', () => {
    const cache = new ShapeCache(4);
    const a = cache.at(plate, 90);
    expect(cache.at(plate, 90)).toBe(a);
    const base = cache.inflated(plate);
    const p = base.outer[0]!;
    expect(a.outer[0]!.x).toBeCloseTo(-p.y, 9);
    expect(a.outer[0]!.y).toBeCloseTo(p.x, 9);
  });
});
