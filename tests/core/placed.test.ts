import { describe, expect, it } from 'vitest';
import type { Part } from '../../src/core/model.ts';
import { placePart, placedParts } from '../../src/core/placed.ts';

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
