import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RectIndex, rectsTouch } from '../../../src/core/geometry/rect-index.ts';
import type { Rect } from '../../../src/core/geometry/types.ts';

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

const brute = (rects: readonly Rect[], q: Rect, pad: number) =>
  rects.flatMap((r, i) => (rectsTouch(r, q, pad) ? [i] : []));

describe('RectIndex', () => {
  it('vrátí překrývající se i dotýkající se obdélníky, vzestupně', () => {
    const rects = [
      rect(0, 0, 10, 10),
      rect(20, 0, 10, 10),
      rect(10, 10, 5, 5),
      rect(100, 100, 1, 1),
    ];
    const index = new RectIndex(rects);
    expect(index.query(rect(5, 5, 5, 5))).toEqual([0, 2]);
    expect(index.query(rect(12, 2, 6, 6))).toEqual([]);
    expect(index.query(rect(12, 2, 6, 6), 2)).toEqual([0, 1, 2]);
    expect(index.query(rect(-50, -50, 500, 500))).toEqual([0, 1, 2, 3]);
  });

  it('prázdný index, bod, obdélníky nulové velikosti a ve stejném místě', () => {
    expect(new RectIndex([]).query(rect(0, 0, 1, 1))).toEqual([]);
    const same = [rect(3, 3, 0, 0), rect(3, 3, 0, 0), rect(3, 3, 0, 0)];
    expect(new RectIndex(same).query(rect(3, 3, 0, 0))).toEqual([0, 1, 2]);
    expect(new RectIndex(same).query(rect(4, 4, 1, 1))).toEqual([]);
    // Všechny na jedné přímce (rozsah nulové výšky).
    const row = Array.from({ length: 50 }, (_, i) => rect(i * 10, 0, 5, 0));
    expect(new RectIndex(row).query(rect(101, -1, 20, 2))).toEqual([10, 11, 12]);
  });

  it('velký obdélník přes celou mřížku se najde z libovolného místa', () => {
    const rects = [rect(0, 0, 1000, 1000)];
    for (let i = 0; i < 400; i++)
      rects.push(rect((i % 20) * 50 + 10, Math.floor(i / 20) * 50 + 10, 5, 5));
    const index = new RectIndex(rects);
    expect(index.query(rect(12, 12, 1, 1))).toEqual([0, 1]);
    expect(index.query(rect(990, 990, 1, 1))).toEqual([0]);
  });

  it('neplatný obdélník se nikdy nevrátí a index nerozbije', () => {
    const index = new RectIndex([rect(0, 0, 1, 1), rect(NaN, 0, 1, 1), rect(0, 0, Infinity, 1)]);
    expect(index.query(rect(0, 0, 5, 5))).toEqual([0]);
    expect(index.query(rect(NaN, 0, 1, 1))).toEqual([]);
  });

  it('dotaz mimo rozsah indexu', () => {
    const index = new RectIndex([rect(0, 0, 1, 1), rect(5, 5, 1, 1)]);
    expect(index.query(rect(-100, -100, 10, 10))).toEqual([]);
    expect(index.query(rect(1e9, 1e9, 10, 10))).toEqual([]);
  });

  it('shoduje se s procházením všech obdélníků', () => {
    const coord = fc.double({ min: -1000, max: 1000, noNaN: true });
    const size = fc.oneof(
      fc.constant(0),
      fc.double({ min: 0, max: 5, noNaN: true }),
      fc.double({ min: 0, max: 800, noNaN: true }),
    );
    const anyRect = fc.record({ x: coord, y: coord, width: size, height: size });
    fc.assert(
      fc.property(
        fc.array(anyRect, { maxLength: 150 }),
        fc.array(anyRect, { minLength: 1, maxLength: 10 }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (rects, queries, pad) => {
          const index = new RectIndex(rects);
          for (const q of queries) expect(index.query(q, pad)).toEqual(brute(rects, q, pad));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('nekonečný obdélník se nevrací dotazem přes mřížku ani úplným průchodem', () => {
    const rects: Rect[] = [rect(0, 0, Infinity, 1)];
    for (let i = 0; i < 20; i++) rects.push(rect(i * 10, 0, 5, 5));
    const index = new RectIndex(rects);
    expect(index.query(rect(50, 0, 1, 1))).toEqual([6]);
    expect(index.query(rect(-5, -5, 500, 50))).toEqual(rects.map((_, i) => i).slice(1));
  });

  it('rozsah přes celý číselný obor: úplný průchod místo mřížky', () => {
    const rects = [rect(-1e308, 0, 1, 1), rect(1e308, 0, 1, 1), rect(0, 0, 1, 1)];
    const index = new RectIndex(rects);
    expect(index.query(rect(0.5, 0.5, 1, 1))).toEqual([2]);
    expect(index.query(rect(-1e308, 0, 0, 0))).toEqual([0]);
  });

  it('dotazy nad 100 000 obdélníky jsou rychlé', () => {
    const rects: Rect[] = [rect(0, 0, 4000, 4000)];
    for (let i = 0; i < 100_000; i++)
      rects.push(rect((i % 400) * 10, Math.floor(i / 400) * 10, 6, 6));
    const start = performance.now();
    const index = new RectIndex(rects);
    let found = 0;
    for (let i = 1; i < rects.length; i++) found += index.query(rects[i]!).length;
    // Každý otvor najde sebe a velký obdélník.
    expect(found).toBe(200_000);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
