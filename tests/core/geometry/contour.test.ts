import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pointsNear, rectsNear } from '../../../src/core/geometry/compare.ts';
import {
  bulgeToArc,
  contourArea,
  contourBBox,
  contourOrientation,
  contourSignedArea,
  orientContour,
  reverseContour,
  segmentMidpoint,
} from '../../../src/core/geometry/contour.ts';
import { ringSignedArea } from '../../../src/core/geometry/polygon.ts';
import { rotateContour, translateContour } from '../../../src/core/geometry/transform.ts';
import type { Contour } from '../../../src/core/geometry/types.ts';
import { arbAngle, arbPoint, arbStarRing, expectRelNear } from '../arbitraries.ts';

const QUARTER = Math.tan(Math.PI / 8); // bulge oblouku 90°

/** Kruh o poloměru r se středem (cx, cy) ze dvou půlkruhů. */
const circle = (cx: number, cy: number, r: number, ccw = true): Contour => [
  { x: cx - r, y: cy, bulge: ccw ? 1 : -1 },
  { x: cx + r, y: cy, bulge: ccw ? 1 : -1 },
];

/** Obdélník w × h se zaoblenými rohy o poloměru r, CCW, levý dolní roh bbox v (0, 0). */
const roundedRect = (w: number, h: number, r: number): Contour => [
  { x: r, y: 0, bulge: 0 },
  { x: w - r, y: 0, bulge: QUARTER },
  { x: w, y: r, bulge: 0 },
  { x: w, y: h - r, bulge: QUARTER },
  { x: w - r, y: h, bulge: 0 },
  { x: r, y: h, bulge: QUARTER },
  { x: 0, y: h - r, bulge: 0 },
  { x: 0, y: r, bulge: QUARTER },
];

/** Obrys s náhodnými bulge na hvězdicovém polygonu (malé bulge, aby nevznikly smyčky). */
const arbArcContour = fc
  .tuple(
    arbStarRing(),
    fc.array(fc.double({ min: -0.3, max: 0.3, noNaN: true }), { minLength: 16, maxLength: 16 }),
  )
  .map(([{ ring }, bulges]) =>
    // + 0 převede −0 na +0 (reverseContour vrací vždy +0)
    ring.map((p, i) => ({ x: p.x, y: p.y, bulge: bulges[i]! + 0 })),
  );

describe('bulgeToArc', () => {
  it('půlkruh CCW z (10, 0) do (0, 0): střed (5, 0), r = 5, prochází (5, 5)', () => {
    const arc = bulgeToArc({ x: 10, y: 0 }, { x: 0, y: 0 }, 1)!;
    expect(pointsNear(arc.center, { x: 5, y: 0 })).toBe(true);
    expect(arc.radius).toBeCloseTo(5, 12);
    expect(arc.startAngle).toBeCloseTo(0, 12);
    expect(arc.sweep).toBeCloseTo(180, 12);
    expect(pointsNear(segmentMidpoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 1), { x: 5, y: 5 })).toBe(
      true,
    );
  });

  it('čtvrtkruh CCW z (0, 0) do (2, 0): střed (1, 1), r = √2', () => {
    const arc = bulgeToArc({ x: 0, y: 0 }, { x: 2, y: 0 }, QUARTER)!;
    expect(pointsNear(arc.center, { x: 1, y: 1 })).toBe(true);
    expect(arc.radius).toBeCloseTo(Math.SQRT2, 12);
    expect(arc.sweep).toBeCloseTo(90, 12);
  });

  it('CW oblouk má záporný sweep a střed na druhé straně', () => {
    const arc = bulgeToArc({ x: 0, y: 0 }, { x: 2, y: 0 }, -QUARTER)!;
    expect(pointsNear(arc.center, { x: 1, y: -1 })).toBe(true);
    expect(arc.sweep).toBeCloseTo(-90, 12);
  });

  it('úsečka a nulová délka nejsou oblouk', () => {
    expect(bulgeToArc({ x: 0, y: 0 }, { x: 1, y: 0 }, 0)).toBeNull();
    expect(bulgeToArc({ x: 1, y: 1 }, { x: 1, y: 1 }, 1)).toBeNull();
  });

  it('property: oba koncové body i střed oblouku leží na kružnici', () => {
    fc.assert(
      fc.property(
        arbPoint,
        arbPoint,
        fc.double({ min: -5, max: 5, noNaN: true }).filter((b) => Math.abs(b) > 1e-6),
        (a, b, bulge) => {
          fc.pre(Math.hypot(a.x - b.x, a.y - b.y) > 1e-3);
          const arc = bulgeToArc(a, b, bulge)!;
          const m = segmentMidpoint(a, b, bulge);
          for (const p of [a, b, m]) {
            expectRelNear(Math.hypot(p.x - arc.center.x, p.y - arc.center.y), arc.radius, 1e-7);
          }
        },
      ),
    );
  });
});

describe('plocha a orientace obrysu s oblouky', () => {
  it('kruh ze dvou půlkruhů má plochu πr², CCW kladnou, CW zápornou', () => {
    expect(contourSignedArea(circle(3, 4, 10))).toBeCloseTo(Math.PI * 100, 9);
    expect(contourSignedArea(circle(3, 4, 10, false))).toBeCloseTo(-Math.PI * 100, 9);
    expect(contourOrientation(circle(0, 0, 1))).toBe('ccw');
    expect(contourOrientation(circle(0, 0, 1, false))).toBe('cw');
  });

  it('zaoblený obdélník: w·h − (4 − π)·r²', () => {
    expect(contourArea(roundedRect(100, 50, 10))).toBeCloseTo(5000 - (4 - Math.PI) * 100, 9);
  });

  it('bez oblouků se shoduje s plochou polygonu', () => {
    fc.assert(
      fc.property(arbStarRing(), ({ ring }) => {
        const c = ring.map((p) => ({ ...p, bulge: 0 }));
        expectRelNear(contourSignedArea(c), ringSignedArea(ring));
      }),
    );
  });

  it('úsečka tam a zpět je degenerovaná', () => {
    expect(
      contourOrientation([
        { x: 0, y: 0, bulge: 0 },
        { x: 5, y: 0, bulge: 0 },
      ]),
    ).toBe('degenerate');
    expect(contourSignedArea([])).toBe(0);
  });

  it('property: plocha nezávisí na posunu a rotaci', () => {
    fc.assert(
      fc.property(arbArcContour, arbPoint, arbAngle, (c, d, deg) => {
        const a = contourSignedArea(c);
        expectRelNear(contourSignedArea(translateContour(c, d.x, d.y)), a, 1e-8);
        expectRelNear(contourSignedArea(rotateContour(c, deg)), a, 1e-8);
      }),
    );
  });
});

describe('reverseContour', () => {
  it('neguje bulge a přesune ho na protější vrchol', () => {
    const c: Contour = [
      { x: 0, y: 0, bulge: 0.1 },
      { x: 10, y: 0, bulge: 0.2 },
      { x: 10, y: 10, bulge: 0.3 },
    ];
    expect(reverseContour(c)).toEqual([
      { x: 0, y: 0, bulge: -0.3 },
      { x: 10, y: 10, bulge: -0.2 },
      { x: 10, y: 0, bulge: -0.1 },
    ]);
  });

  it('kruh CCW → CW se stejnou plochou', () => {
    const r = reverseContour(circle(0, 0, 5));
    expect(contourOrientation(r)).toBe('cw');
    expect(contourArea(r)).toBeCloseTo(Math.PI * 25, 9);
  });

  it('property: obrácení změní znaménko plochy, dvojí obrácení je identita', () => {
    fc.assert(
      fc.property(arbArcContour, (c) => {
        expectRelNear(contourSignedArea(reverseContour(c)), -contourSignedArea(c), 1e-9);
        expect(reverseContour(reverseContour(c))).toEqual(c);
      }),
    );
  });

  it('orientContour', () => {
    const cw = circle(0, 0, 5, false);
    expect(contourOrientation(orientContour(cw, 'ccw'))).toBe('ccw');
    expect(orientContour(cw, 'cw')).toBe(cw);
  });
});

describe('contourBBox', () => {
  it('kruh: bbox podle krajních bodů oblouků, ne vrcholů', () => {
    expect(rectsNear(contourBBox(circle(3, 4, 10)), { x: -7, y: -6, width: 20, height: 20 })).toBe(
      true,
    );
    expect(
      rectsNear(contourBBox(circle(3, 4, 10, false)), { x: -7, y: -6, width: 20, height: 20 }),
    ).toBe(true);
  });

  it('zaoblený obdélník', () => {
    expect(
      rectsNear(contourBBox(roundedRect(100, 50, 10)), { x: 0, y: 0, width: 100, height: 50 }),
    ).toBe(true);
  });

  it('malý oblouk nepřesahující vrcholy nepřidá krajní bod', () => {
    // oblouk 90° CCW z (0,0) do (2,0) se vyboulí dolů do y = 1 − √2
    const c: Contour = [
      { x: 0, y: 0, bulge: QUARTER },
      { x: 2, y: 0, bulge: 0 },
      { x: 1, y: 3, bulge: 0 },
    ];
    expect(
      rectsNear(contourBBox(c), { x: 0, y: 1 - Math.SQRT2, width: 2, height: 2 + Math.SQRT2 }),
    ).toBe(true);
  });

  it('property: bbox obsahuje vrcholy i středy oblouků a je tvarem posunutý', () => {
    fc.assert(
      fc.property(arbArcContour, arbPoint, (c, d) => {
        const bb = contourBBox(c);
        const n = c.length;
        for (let i = 0; i < n; i++) {
          const a = c[i]!;
          const m = segmentMidpoint(a, c[(i + 1) % n]!, a.bulge);
          for (const p of [a, m]) {
            expect(p.x).toBeGreaterThanOrEqual(bb.x - 1e-9);
            expect(p.y).toBeGreaterThanOrEqual(bb.y - 1e-9);
            expect(p.x).toBeLessThanOrEqual(bb.x + bb.width + 1e-9);
            expect(p.y).toBeLessThanOrEqual(bb.y + bb.height + 1e-9);
          }
        }
        const moved = contourBBox(translateContour(c, d.x, d.y));
        expect(
          rectsNear(
            moved,
            { x: bb.x + d.x, y: bb.y + d.y, width: bb.width, height: bb.height },
            1e-6,
          ),
        ).toBe(true);
      }),
    );
  });
});
