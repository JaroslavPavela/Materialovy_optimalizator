import fc from 'fast-check';
import { EPS } from '../../../src/core/geometry/eps.ts';
import { describe, expect, it } from 'vitest';
import {
  pointsNear,
  polygonsNear,
  rectsNear,
  ringsNear,
} from '../../../src/core/geometry/compare.ts';
import {
  normalizePolygon,
  orientRing,
  pointsBBox,
  polygonArea,
  polygonBBox,
  rectToPolygon,
  reverseRing,
  ringArea,
  ringOrientation,
  ringSignedArea,
} from '../../../src/core/geometry/polygon.ts';
import type { Polygon, Ring } from '../../../src/core/geometry/types.ts';
import { arbPoint, arbPolygon, arbStarRing, expectRelNear } from '../arbitraries.ts';

const square: Ring = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
const holeCw: Ring = [
  { x: 2, y: 2 },
  { x: 2, y: 4 },
  { x: 4, y: 4 },
  { x: 4, y: 2 },
];

describe('plocha a orientace', () => {
  it('čtverec 10 × 10 CCW má plochu +100', () => {
    expect(ringSignedArea(square)).toBe(100);
    expect(ringOrientation(square)).toBe('ccw');
  });

  it('obrácený čtverec je CW se zápornou plochou', () => {
    const cw = reverseRing(square);
    expect(cw[0]).toEqual(square[0]);
    expect(ringSignedArea(cw)).toBe(-100);
    expect(ringOrientation(cw)).toBe('cw');
    expect(ringArea(cw)).toBe(100);
  });

  it('trojúhelník (0,0),(4,0),(0,3) má plochu 6', () => {
    expect(
      ringSignedArea([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 3 },
      ]),
    ).toBe(6);
  });

  it('méně než 3 body a kolineární body jsou degenerované', () => {
    expect(ringSignedArea([])).toBe(0);
    expect(ringSignedArea(square.slice(0, 2))).toBe(0);
    expect(
      ringOrientation([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBe('degenerate');
  });

  it('plocha polygonu odečítá otvory bez ohledu na jejich orientaci', () => {
    expect(polygonArea({ outer: square, holes: [holeCw] })).toBe(96);
    expect(polygonArea({ outer: square, holes: [reverseRing(holeCw)] })).toBe(96);
  });

  it('přesná plocha i daleko od počátku', () => {
    const far = square.map((p) => ({ x: p.x + 1e7, y: p.y + 1e7 }));
    expect(ringSignedArea(far)).toBe(100);
  });
});

describe('normalizace orientace', () => {
  it('vnější obrys CCW, otvory CW', () => {
    const wrong: Polygon = { outer: reverseRing(square), holes: [reverseRing(holeCw)] };
    const n = normalizePolygon(wrong);
    expect(ringOrientation(n.outer)).toBe('ccw');
    expect(ringOrientation(n.holes[0]!)).toBe('cw');
  });

  it('správně orientovaný polygon se nemění', () => {
    const p: Polygon = { outer: square, holes: [holeCw] };
    const n = normalizePolygon(p);
    expect(n.outer).toBe(p.outer);
    expect(n.holes[0]).toBe(holeCw);
  });

  it('degenerovaný obrys zůstane beze změny', () => {
    const line: Ring = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ];
    expect(orientRing(line, 'cw')).toBe(line);
  });

  it('property: normalizace dá CCW/CW a zachová plochu', () => {
    fc.assert(
      fc.property(arbPolygon, fc.boolean(), (poly, flip) => {
        const input: Polygon = flip
          ? { outer: reverseRing(poly.outer), holes: poly.holes.map(reverseRing) }
          : poly;
        const n = normalizePolygon(input);
        expect(ringOrientation(n.outer)).toBe('ccw');
        n.holes.forEach((h) => expect(ringOrientation(h)).toBe('cw'));
        expectRelNear(polygonArea(n), polygonArea(poly));
      }),
    );
  });

  it('property: obrácení obrysu změní znaménko plochy', () => {
    fc.assert(
      fc.property(arbStarRing(), ({ ring }) => {
        expectRelNear(ringSignedArea(reverseRing(ring)), -ringSignedArea(ring));
      }),
    );
  });
});

describe('obalový obdélník', () => {
  it('bbox čtverce a polygonu', () => {
    expect(pointsBBox(square)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(polygonBBox({ outer: square, holes: [holeCw] })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });

  it('prázdná množina bodů vyhodí chybu', () => {
    expect(() => pointsBBox([])).toThrow(RangeError);
  });

  it('obdélník → polygon → bbox je identita, plocha = š × v, CCW', () => {
    const r = { x: -3, y: 7, width: 120.5, height: 40 };
    const p = rectToPolygon(r);
    expect(polygonBBox(p)).toEqual(r);
    expect(polygonArea(p)).toBeCloseTo(120.5 * 40, 9);
    expect(ringOrientation(p.outer)).toBe('ccw');
  });

  it('property: všechny body leží v bbox a každá hrana bbox se nějakého bodu dotýká', () => {
    fc.assert(
      fc.property(fc.array(arbPoint, { minLength: 1, maxLength: 50 }), (pts) => {
        const bb = pointsBBox(pts);
        expect(bb.width).toBeGreaterThanOrEqual(0);
        expect(bb.height).toBeGreaterThanOrEqual(0);
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(bb.x);
          expect(p.y).toBeGreaterThanOrEqual(bb.y);
          expect(p.x).toBeLessThanOrEqual(bb.x + bb.width + 1e-9);
          expect(p.y).toBeLessThanOrEqual(bb.y + bb.height + 1e-9);
        }
        expect(pts.some((p) => p.x === bb.x)).toBe(true);
        expect(pts.some((p) => p.y === bb.y)).toBe(true);
      }),
    );
  });
});

describe('porovnání s tolerancí', () => {
  it('body a obdélníky', () => {
    expect(pointsNear({ x: 1, y: 2 }, { x: 1 + EPS / 2, y: 2 - EPS / 2 })).toBe(true);
    expect(pointsNear({ x: 1, y: 2 }, { x: 1 + 2 * EPS, y: 2 })).toBe(false);
    expect(pointsNear({ x: 1, y: 2 }, { x: 1.1, y: 2 }, 0.2)).toBe(true);
    expect(
      rectsNear({ x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1.1 }),
    ).toBe(false);
  });

  it('obrysy: cyklický posun ano, opačná orientace ne, jiný počet ne', () => {
    const shifted = [...square.slice(2), ...square.slice(0, 2)];
    expect(ringsNear(square, shifted)).toBe(true);
    expect(ringsNear(square, reverseRing(square))).toBe(false);
    expect(ringsNear(square, square.slice(0, 3))).toBe(false);
    expect(ringsNear([], [])).toBe(true);
  });

  it('polygony včetně otvorů', () => {
    const a: Polygon = { outer: square, holes: [holeCw] };
    expect(polygonsNear(a, { outer: square, holes: [holeCw] })).toBe(true);
    expect(polygonsNear(a, { outer: square, holes: [] })).toBe(false);
  });
});
