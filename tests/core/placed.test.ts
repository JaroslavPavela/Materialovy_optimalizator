import { describe, expect, it } from 'vitest';
import type { Part } from '../../src/core/model.ts';
import { partContours, placedContours, placePart, placedParts } from '../../src/core/placed.ts';
import { contourBBox, contourOrientation } from '../../src/core/geometry/contour.ts';

const part: Part = { id: 'a', name: 'A', width: 100, height: 40, quantity: 1, rotation: 'ortho' };

describe('placePart', () => {
  it('0°: obdélník od (x, y)', () => {
    const p = placePart(part, { partId: 'a', instance: 0, x: 10, y: 20, rotation: 0 });
    expect(p.bbox).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(p.labelAt).toEqual({ x: 60, y: 40 });
    expect(p.outline.holes).toEqual([]);
  });

  it("90°: p' = R·p + (x, y) – roh obalového obdélníku v (x − výška, y)", () => {
    const p = placePart(part, { partId: 'a', instance: 0, x: 50, y: 20, rotation: 90 });
    expect(p.bbox).toEqual({ x: 10, y: 20, width: 40, height: 100 });
  });

  it('placedParts najde díly podle ID, neznámé ID je chyba', () => {
    const layout = {
      sheetId: 's',
      placements: [{ partId: 'a', instance: 0, x: 0, y: 0, rotation: 0 }],
    };
    expect(placedParts([part], layout)).toHaveLength(1);
    expect(() => placedParts([], layout)).toThrow(RangeError);
  });
});

describe('partContours / placedContours', () => {
  it('obdélník bez tvaru: CCW obrys [0, š] × [0, v] bez otvorů', () => {
    const c = partContours(part);
    expect(contourOrientation(c.outer)).toBe('ccw');
    expect(contourBBox(c.outer)).toEqual({ x: 0, y: 0, width: 100, height: 40 });
    expect(c.holes).toEqual([]);
  });

  it('tvar z DXF se vrátí beze změny', () => {
    const shape = {
      outer: [
        { x: 0, y: 5, bulge: 1 },
        { x: 10, y: 5, bulge: 1 },
      ],
      holes: [],
    };
    expect(partContours({ ...part, width: 10, height: 10, shape })).toBe(shape);
  });

  it("umístění: p' = R·p + (x, y), bulge a orientace zůstanou", () => {
    const shape = {
      outer: [
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0.5 },
        { x: 10, y: 10, bulge: 0 },
      ],
      holes: [
        [
          { x: 4, y: 2, bulge: -1 },
          { x: 6, y: 2, bulge: -1 },
        ],
      ],
    };
    const p = { ...part, width: 10, height: 10, shape };
    const c = placedContours(p, { partId: 'a', instance: 0, x: 100, y: 50, rotation: 90 });
    expect(c.outer).toEqual([
      { x: 100, y: 50, bulge: 0 },
      { x: 100, y: 60, bulge: 0.5 },
      { x: 90, y: 60, bulge: 0 },
    ]);
    expect(c.holes[0]).toEqual([
      { x: 98, y: 54, bulge: -1 },
      { x: 98, y: 56, bulge: -1 },
    ]);
    expect(contourOrientation(c.outer)).toBe('ccw');
    expect(contourOrientation(c.holes[0]!)).toBe('cw');
  });
});
