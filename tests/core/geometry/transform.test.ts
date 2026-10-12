import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pointsNear, polygonsNear, rectsNear } from '../../../src/core/geometry/compare.ts';
import {
  polygonArea,
  polygonBBox,
  rectToPolygon,
  ringOrientation,
} from '../../../src/core/geometry/polygon.ts';
import {
  cosSinDeg,
  placeContour,
  placePolygon,
  rotateContour,
  rotatePoint,
  rotatePolygon,
  translateContour,
  translatePolygon,
  translationForCorner,
} from '../../../src/core/geometry/transform.ts';
import type { Contour } from '../../../src/core/geometry/types.ts';
import { arbAngle, arbAnyPolygon, arbPoint, arbPolygon, expectRelNear } from '../arbitraries.ts';

/** Tolerance pro souřadnice po několika rotacích v rozsahu ±10 m. */
const TOL = 1e-6;

describe('cosSinDeg', () => {
  it('přesné hodnoty pro násobky 90°', () => {
    expect(cosSinDeg(0)).toEqual([1, 0]);
    expect(cosSinDeg(90)).toEqual([0, 1]);
    expect(cosSinDeg(180)).toEqual([-1, 0]);
    expect(cosSinDeg(270)).toEqual([0, -1]);
    expect(cosSinDeg(-90)).toEqual([0, -1]);
    expect(cosSinDeg(450)).toEqual([0, 1]);
  });

  it('obecný úhel', () => {
    const [c, s] = cosSinDeg(30);
    expect(c).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(s).toBeCloseTo(0.5, 12);
  });
});

describe('rotatePoint', () => {
  it('otočení o 90° CCW kolem počátku: (1, 0) → (0, 1)', () => {
    expect(rotatePoint({ x: 1, y: 0 }, 90)).toEqual({ x: 0, y: 1 });
    expect(rotatePoint({ x: 1, y: 0 }, -90)).toEqual({ x: 0, y: -1 });
  });

  it('otočení kolem zadaného středu', () => {
    expect(rotatePoint({ x: 2, y: 1 }, 180, { x: 1, y: 1 })).toEqual({ x: 0, y: 1 });
  });

  it('otočení o 45°', () => {
    const p = rotatePoint({ x: 1, y: 0 }, 45);
    expect(p.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(p.y).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('property: rotace zachová vzdálenost od středu', () => {
    fc.assert(
      fc.property(arbPoint, arbAngle, arbPoint, (p, deg, c) => {
        const q = rotatePoint(p, deg, c);
        expectRelNear(Math.hypot(q.x - c.x, q.y - c.y), Math.hypot(p.x - c.x, p.y - c.y), 1e-12);
      }),
    );
  });
});

describe('rotace a posun polygonu – property testy', () => {
  it('rotace o 360° je identita', () => {
    fc.assert(
      fc.property(arbAnyPolygon, arbPoint, (poly, c) => {
        expect(polygonsNear(rotatePolygon(poly, 360, c), poly, TOL)).toBe(true);
      }),
    );
  });

  it('rotace o úhel a zpět je identita', () => {
    fc.assert(
      fc.property(arbPolygon, arbAngle, arbPoint, (poly, deg, c) => {
        expect(polygonsNear(rotatePolygon(rotatePolygon(poly, deg, c), -deg, c), poly, TOL)).toBe(
          true,
        );
      }),
    );
  });

  it('čtyři rotace o 90° jsou přesně identita', () => {
    fc.assert(
      fc.property(arbPolygon, (poly) => {
        let p = poly;
        for (let i = 0; i < 4; i++) p = rotatePolygon(p, 90);
        expect(p).toEqual(poly);
      }),
    );
  });

  it('plocha nezávisí na posunu', () => {
    fc.assert(
      fc.property(arbAnyPolygon, arbPoint, (poly, d) => {
        expectRelNear(polygonArea(translatePolygon(poly, d.x, d.y)), polygonArea(poly), 1e-8);
      }),
    );
  });

  it('plocha nezávisí na rotaci a rotace zachová orientaci obrysů', () => {
    fc.assert(
      fc.property(arbAnyPolygon, arbAngle, (poly, deg) => {
        const r = rotatePolygon(poly, deg);
        expectRelNear(polygonArea(r), polygonArea(poly), 1e-8);
        expect(ringOrientation(r.outer)).toBe(ringOrientation(poly.outer));
        r.holes.forEach((h, i) => expect(ringOrientation(h)).toBe(ringOrientation(poly.holes[i]!)));
      }),
    );
  });

  it('posun tam a zpět je identita', () => {
    fc.assert(
      fc.property(arbPolygon, arbPoint, (poly, d) => {
        const back = translatePolygon(translatePolygon(poly, d.x, d.y), -d.x, -d.y);
        expect(polygonsNear(back, poly, TOL)).toBe(true);
      }),
    );
  });
});

describe('placePolygon a translationForCorner', () => {
  it("obdélník 100 × 40 otočený o 90°: p' = R·p + (x, y)", () => {
    const rect = rectToPolygon({ x: 0, y: 0, width: 100, height: 40 });
    expect(polygonBBox(placePolygon(rect, 90, 50, 20))).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 100,
    });
    // posun pro levý dolní roh v (10, 20) – příklad z dokumentace Placement
    const t = translationForCorner(polygonBBox(rotatePolygon(rect, 90)), { x: 10, y: 20 });
    expect(t).toEqual({ x: 50, y: 20 });
  });

  it('při 0° je posun přímo levý dolní roh', () => {
    const rect = rectToPolygon({ x: 0, y: 0, width: 100, height: 40 });
    expect(polygonBBox(placePolygon(rect, 0, 7, 3))).toEqual({
      x: 7,
      y: 3,
      width: 100,
      height: 40,
    });
  });

  it("property: placePolygon odpovídá vzorci x' = x + px·cos − py·sin, y' = y + px·sin + py·cos", () => {
    fc.assert(
      fc.property(arbAnyPolygon, arbAngle, arbPoint, (poly, deg, at) => {
        const placed = placePolygon(poly, deg, at.x, at.y);
        const rad = (deg * Math.PI) / 180;
        const [c, s] = [Math.cos(rad), Math.sin(rad)];
        poly.outer.forEach((p, i) => {
          const q = placed.outer[i]!;
          expect(Math.abs(q.x - (at.x + p.x * c - p.y * s))).toBeLessThan(1e-7);
          expect(Math.abs(q.y - (at.y + p.x * s + p.y * c))).toBeLessThan(1e-7);
        });
        expectRelNear(polygonArea(placed), polygonArea(poly), 1e-8);
      }),
    );
  });

  it('property: translationForCorner dá levý dolní roh bbox do zadaného bodu', () => {
    fc.assert(
      fc.property(arbPolygon, arbAngle, arbPoint, (poly, deg, corner) => {
        const rotatedBB = polygonBBox(rotatePolygon(poly, deg));
        const t = translationForCorner(rotatedBB, corner);
        const bb = polygonBBox(placePolygon(poly, deg, t.x, t.y));
        expect(
          rectsNear(bb, { ...corner, width: rotatedBB.width, height: rotatedBB.height }, TOL),
        ).toBe(true);
      }),
    );
  });
});

describe('transformace obrysu s oblouky', () => {
  // Půlkruh: úsečka (0,0)→(10,0), pak oblouk CCW zpět (bulge 1 = 180°).
  const halfDisk: Contour = [
    { x: 0, y: 0, bulge: 0 },
    { x: 10, y: 0, bulge: 1 },
  ];

  it('rotace zachová bulge a otočí vrcholy', () => {
    const r = rotateContour(halfDisk, 90);
    expect(r.map((v) => v.bulge)).toEqual([0, 1]);
    expect(pointsNear(r[1]!, { x: 0, y: 10 })).toBe(true);
  });

  it('posun zachová bulge', () => {
    const t = translateContour(halfDisk, 5, -2);
    expect(t).toEqual([
      { x: 5, y: -2, bulge: 0 },
      { x: 15, y: -2, bulge: 1 },
    ]);
  });

  it('placeContour otočí a posune vrcholy, bulge zachová', () => {
    const p = placeContour(halfDisk, 180, 100, 0);
    expect(p).toEqual([
      { x: 100, y: 0, bulge: 0 },
      { x: 90, y: 0, bulge: 1 },
    ]);
  });
});
