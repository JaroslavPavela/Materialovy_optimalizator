import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  affineDeterminant,
  applyAffine,
  compose,
  IDENTITY,
  isSimilarity,
  maxScale,
  rotation,
  scaling,
  translation,
} from '../../../src/core/geometry/affine.ts';
import { approximateSegment, bulgeToArc } from '../../../src/core/geometry/contour.ts';
import { EPS } from '../../../src/core/geometry/eps.ts';
import { arbPoint } from '../arbitraries.ts';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-9) =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

describe('affine', () => {
  it('compose: nejdřív pravá transformace, pak levá', () => {
    const m = compose(translation(10, 0), rotation(90));
    expect(near(applyAffine(m, { x: 1, y: 0 }), { x: 10, y: 1 })).toBe(true);
    expect(compose()).toEqual(IDENTITY);
  });

  it('property: compose odpovídá postupnému použití', () => {
    const arbM = fc
      .record({
        r: fc.double({ min: -360, max: 360, noNaN: true }),
        sx: fc.double({ min: -5, max: 5, noNaN: true }).filter((v) => Math.abs(v) > 0.01),
        sy: fc.double({ min: -5, max: 5, noNaN: true }).filter((v) => Math.abs(v) > 0.01),
        dx: fc.double({ min: -1000, max: 1000, noNaN: true }),
        dy: fc.double({ min: -1000, max: 1000, noNaN: true }),
      })
      .map((v) => compose(translation(v.dx, v.dy), rotation(v.r), scaling(v.sx, v.sy)));
    fc.assert(
      fc.property(arbM, arbM, arbPoint, (m, n, p) => {
        const a = applyAffine(compose(m, n), p);
        const b = applyAffine(m, applyAffine(n, p));
        expect(near(a, b, 1e-6)).toBe(true);
      }),
    );
  });

  it('determinant, největší měřítko a podobnost', () => {
    expect(affineDeterminant(scaling(-1, 1))).toBe(-1);
    expect(maxScale(compose(rotation(30), scaling(2, 5)))).toBeCloseTo(5, 12);
    expect(maxScale(scaling(-3))).toBeCloseTo(3, 12);
    expect(isSimilarity(compose(rotation(37), scaling(-2, 2)))).toBe(true);
    expect(isSimilarity(compose(rotation(37), scaling(2, 3)))).toBe(false);
    expect(isSimilarity(scaling(0))).toBe(false);
  });
});

describe('approximateSegment', () => {
  it('úsečka vrátí jen koncový bod', () => {
    expect(approximateSegment({ x: 0, y: 0 }, { x: 5, y: 0 }, 0, 0.01)).toEqual([{ x: 5, y: 0 }]);
  });

  it('property: body leží na oblouku, tětivy se odchylují nejvýš o tol, konec přesně', () => {
    fc.assert(
      fc.property(
        arbPoint,
        arbPoint,
        fc.double({ min: -4, max: 4, noNaN: true }).filter((b) => Math.abs(b) > 0.05),
        fc.constantFrom(0.001, 0.01, 0.05, 1),
        (a, b, bulge, tol) => {
          const arc = bulgeToArc(a, b, bulge);
          if (!arc || arc.radius > 1e5) return;
          const pts = approximateSegment(a, b, bulge, tol);
          expect(pts.at(-1)).toEqual(b);
          let prev = a;
          for (const p of pts) {
            const r = Math.hypot(p.x - arc.center.x, p.y - arc.center.y);
            expect(Math.abs(r - arc.radius)).toBeLessThan(EPS);
            const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
            const dev = arc.radius - Math.hypot(mid.x - arc.center.x, mid.y - arc.center.y);
            expect(dev).toBeLessThanOrEqual(tol + 1e-9);
            prev = p;
          }
        },
      ),
    );
  });
});
