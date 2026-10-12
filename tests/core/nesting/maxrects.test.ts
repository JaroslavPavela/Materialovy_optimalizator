import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MaxRectsBin,
  PART_ORDERS,
  RECT_HEURISTICS,
  compareRectResults,
  nestRects,
  packRects,
  usableRect,
  zoneObstacles,
} from '../../../src/core/nesting/maxrects.ts';
import {
  DEFAULT_NESTING_PARAMS,
  validateNestingInput,
  type NestingInput,
  type Part,
  type Sheet,
} from '../../../src/core/model.ts';
import { arbEdgeNestingInput, arbRectParts, arbSheet, arbSpacing } from '../arbitraries.ts';
import { placedRect, reasonViolations, rectInvariantViolations } from './invariants.ts';

const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  id: 's',
  name: 'tabule',
  width: 1000,
  height: 1000,
  stock: null,
  margin: 0,
  forbiddenZones: [],
  ...over,
});

const part = (
  id: string,
  width: number,
  height: number,
  quantity = 1,
  over: Partial<Part> = {},
): Part => ({
  id,
  name: id,
  width,
  height,
  quantity,
  rotation: 'ortho',
  ...over,
});

const input = (parts: Part[], sheets: Sheet[], spacing = 0): NestingInput => ({
  parts,
  sheets,
  params: { ...DEFAULT_NESTING_PARAMS, spacing },
});

describe('užitná plocha a zóny', () => {
  it('tabule − okraj + rozestup/2', () => {
    expect(usableRect(sheet({ width: 2500, height: 1250, margin: 10 }), 6)).toEqual({
      x: 7,
      y: 7,
      width: 2486,
      height: 1236,
    });
  });

  it('zóna nafouknutá o rozestup/2', () => {
    const s = sheet({
      forbiddenZones: [
        {
          id: 'z',
          polygon: [
            { x: 100, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 50 },
            { x: 100, y: 50 },
          ],
        },
      ],
    });
    expect(zoneObstacles(s, 6)).toEqual([{ x: 97, y: -3, width: 106, height: 56 }]);
  });
});

describe('MaxRectsBin', () => {
  it('rozdělí volný prostor po umístění do rohu', () => {
    const bin = new MaxRectsBin({ x: 0, y: 0, width: 100, height: 50 });
    bin.occupy({ x: 0, y: 0, width: 30, height: 20 });
    expect(bin.freeRects).toEqual([
      { x: 30, y: 0, width: 70, height: 50 },
      { x: 0, y: 20, width: 100, height: 30 },
    ]);
  });

  it('překážka uprostřed dá 4 maximální volné obdélníky', () => {
    const bin = new MaxRectsBin({ x: 0, y: 0, width: 100, height: 100 }, [
      { x: 40, y: 40, width: 20, height: 20 },
    ]);
    expect(bin.freeRects).toHaveLength(4);
    expect(bin.find(100, 40, false, 'BL')).toMatchObject({ x: 0, y: 0, rotated: false });
    expect(bin.find(50, 50, false, 'BL')).toBeNull();
  });

  it('otočí díl, když se jinak nevejde', () => {
    const bin = new MaxRectsBin({ x: 0, y: 0, width: 100, height: 300 });
    expect(bin.find(200, 50, false, 'BSSF')).toBeNull();
    expect(bin.find(200, 50, true, 'BSSF')).toMatchObject({
      width: 50,
      height: 200,
      rotated: true,
    });
  });

  it('volné obdélníky: bez obsažených, mimo překážky, úplné a maximální (i desetinné souřadnice)', () => {
    const coord = fc.oneof(
      fc.integer({ min: 0, max: 90 }),
      fc.double({ min: 0, max: 90, noNaN: true }),
    );
    const size = fc.oneof(
      fc.integer({ min: 1, max: 40 }),
      fc.double({ min: 0.5, max: 40, noNaN: true }),
    );
    fc.assert(
      fc.property(
        fc.array(fc.record({ x: coord, y: coord, w: size, h: size }), { maxLength: 12 }),
        (obs) => {
          const area = { x: 0, y: 0, width: 100, height: 100 };
          const obstacles = obs.map((o) => ({ x: o.x, y: o.y, width: o.w, height: o.h }));
          const f = new MaxRectsBin(area, obstacles).freeRects;
          const tol = 1e-3;
          const inside = (
            p: { x: number; y: number },
            r: { x: number; y: number; width: number; height: number },
            t: number,
          ) =>
            p.x > r.x + t && p.x < r.x + r.width - t && p.y > r.y + t && p.y < r.y + r.height - t;
          for (let i = 0; i < f.length; i++) {
            const a = f[i]!;
            for (let j = 0; j < f.length; j++) {
              if (i === j) continue;
              const b = f[j]!;
              const contained =
                a.x >= b.x - tol &&
                a.y >= b.y - tol &&
                a.x + a.width <= b.x + b.width + tol &&
                a.y + a.height <= b.y + b.height + tol;
              expect(contained).toBe(false);
            }
            for (const o of obstacles) {
              const overlap =
                a.x < o.x + o.width - tol &&
                o.x < a.x + a.width - tol &&
                a.y < o.y + o.height - tol &&
                o.y < a.y + a.height - tol;
              expect(overlap).toBe(false);
            }
            // maximalita: pás šířky `grow` těsně za každou hranou buď vyčnívá
            // z plochy, nebo se překrývá s některou překážkou
            const grow = 0.01;
            const strips = [
              { x: a.x - grow, y: a.y, width: grow, height: a.height },
              { x: a.x + a.width, y: a.y, width: grow, height: a.height },
              { x: a.x, y: a.y - grow, width: a.width, height: grow },
              { x: a.x, y: a.y + a.height, width: a.width, height: grow },
            ];
            for (const st of strips) {
              const outside =
                st.x < -tol ||
                st.y < -tol ||
                st.x + st.width > 100 + tol ||
                st.y + st.height > 100 + tol;
              const hits = obstacles.some(
                (o) =>
                  Math.min(st.x + st.width, o.x + o.width) - Math.max(st.x, o.x) > 1e-9 &&
                  Math.min(st.y + st.height, o.y + o.height) - Math.max(st.y, o.y) > 1e-9,
              );
              expect(outside || hits).toBe(true);
            }
          }
          // úplnost: každý volný bod (mimo překážky) leží v některém volném obdélníku
          for (let gx = 0.5; gx < 100; gx += 3) {
            for (let gy = 0.5; gy < 100; gy += 3) {
              const p = { x: gx, y: gy };
              if (obstacles.some((o) => inside(p, o, -tol))) continue; // bod v překážce
              if (obstacles.some((o) => Math.abs(p.x - o.x) < 0.01 || Math.abs(p.y - o.y) < 0.01))
                continue;
              expect(f.some((r) => inside(p, r, -tol))).toBe(true);
            }
          }
        },
      ),
      { numRuns: 200, seed: 99 },
    );
  });
});

describe('packRects a nestRects – konkrétní případy', () => {
  it('4 díly 500 × 500 přesně vyplní tabuli 1000 × 1000', () => {
    const inp = input([part('a', 500, 500, 4)], [sheet()]);
    const r = nestRects(inp);
    expect(r.layouts).toHaveLength(1);
    expect(r.unplaced).toEqual([]);
    expect(rectInvariantViolations(inp, r)).toEqual([]);
  });

  it('díl přesně velikosti užitné plochy se vejde (i s rozestupem a okrajem)', () => {
    const inp = input([part('a', 980, 480)], [sheet({ height: 500, margin: 10 })], 8);
    const r = nestRects(inp);
    expect(r.unplaced).toEqual([]);
    expect(placedRect(inp, r.layouts[0]!.placements[0]!)).toEqual({
      x: 10,
      y: 10,
      width: 980,
      height: 480,
    });
  });

  it('rozestup: dva díly 495 vedle sebe se na šířku 1000 nevejdou při rozestupu 11', () => {
    const inp = input([part('a', 495, 1000, 2, { rotation: 'locked' })], [sheet({ stock: 1 })], 11);
    const r = nestRects(inp);
    expect(r.layouts).toHaveLength(1);
    expect(r.unplaced).toEqual([{ partId: 'a', instance: 1, reason: 'out-of-sheets' }]);
    expect(rectInvariantViolations(inp, r)).toEqual([]);
  });

  it('otočení o 90° umístí díl, který by se jinak nevešel', () => {
    const inp = input([part('a', 900, 300)], [sheet({ width: 400, height: 1000 })]);
    const r = nestRects(inp);
    const p = r.layouts[0]!.placements[0]!;
    expect(p.rotation).toBe(90);
    expect(placedRect(inp, p)).toEqual({ x: 0, y: 0, width: 300, height: 900 });
  });

  it('locked a flip se neotáčí – díl je pak větší než tabule', () => {
    for (const rotation of ['locked', 'flip'] as const) {
      const inp = input(
        [part('a', 900, 300, 2, { rotation })],
        [sheet({ width: 400, height: 1000 })],
      );
      expect(nestRects(inp).unplaced).toEqual([
        { partId: 'a', instance: 0, reason: 'too-large' },
        { partId: 'a', instance: 1, reason: 'too-large' },
      ]);
    }
  });

  it('důvody neumístění: materiál, zakázaná zóna, sklad', () => {
    const zone = {
      id: 'z',
      polygon: [
        { x: 400, y: 0 },
        { x: 600, y: 0 },
        { x: 600, y: 1000 },
        { x: 400, y: 1000 },
      ],
    };
    const inp = input(
      [
        part('mdf', 100, 100, 1, { material: 'MDF' }),
        part('siroky', 700, 100, 1, { rotation: 'locked' }),
        part('maly', 300, 300, 9),
      ],
      [sheet({ material: 'DTD', stock: 1, forbiddenZones: [zone] })],
    );
    const r = nestRects(inp);
    expect(rectInvariantViolations(inp, r)).toEqual([]);
    const reasons = Object.fromEntries(
      r.unplaced.map((u) => [`${u.partId}#${u.instance}`, u.reason]),
    );
    expect(reasons['mdf#0']).toBe('no-matching-sheet');
    expect(reasons['siroky#0']).toBe('blocked');
    // na tabuli se vejdou 2 × 3 = 6 malých dílů (zóna uprostřed), zbytek došly tabule
    expect(r.layouts[0]!.placements).toHaveLength(6);
    expect(r.unplaced.filter((u) => u.reason === 'out-of-sheets')).toHaveLength(3);
  });

  it('více formátů: zbytek má přednost, sklad se dodrží', () => {
    const remnant = sheet({ id: 'zbytek', width: 600, height: 600, stock: 1, remnant: true });
    const big = sheet({ id: 'velka', width: 2000, height: 1000, stock: 2 });
    // kapacita: zbytek 1 + 2 velké tabule po 8 kusech = 17
    const inp = input([part('a', 500, 500, 18)], [big, remnant]);
    const r = nestRects(inp);
    expect(rectInvariantViolations(inp, r)).toEqual([]);
    expect(r.layouts.map((l) => l.sheetId)).toEqual(['zbytek', 'velka', 'velka']);
    expect(r.unplaced).toEqual([{ partId: 'a', instance: 17, reason: 'out-of-sheets' }]);
  });

  it('bez zbytků se volí formát, na který se vejde víc plochy', () => {
    const small = sheet({ id: 'mala', width: 600, height: 600 });
    const big = sheet({ id: 'velka', width: 1100, height: 1100 });
    const inp = input([part('a', 500, 500, 4)], [small, big]);
    const r = nestRects(inp);
    expect(r.layouts.map((l) => l.sheetId)).toEqual(['velka']);
  });

  it('prázdný seznam dílů dá prázdný výsledek', () => {
    const r = nestRects(input([], [sheet()]));
    expect(r.layouts).toEqual([]);
    expect(r.unplaced).toEqual([]);
  });

  it('nejlepší kombinace není horší než žádná jednotlivá', () => {
    const inp = input(
      [part('a', 300, 200, 7), part('b', 450, 120, 5), part('c', 90, 610, 4)],
      [sheet({ width: 1200, height: 800, stock: null })],
      4,
    );
    const best = nestRects(inp);
    for (const o of PART_ORDERS) {
      for (const h of RECT_HEURISTICS) {
        expect(compareRectResults(inp, best, packRects(inp, h, o))).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('property testy invariantů', () => {
  const arbInput: fc.Arbitrary<NestingInput> = fc
    .record({
      parts: arbRectParts(6),
      sheets: fc.tuple(arbSheet('s0'), fc.option(arbSheet('s1'), { nil: undefined })),
      spacing: arbSpacing,
    })
    .map(({ parts, sheets, spacing }) => ({
      parts,
      sheets: sheets.filter((s): s is Sheet => s !== undefined),
      params: { ...DEFAULT_NESTING_PARAMS, spacing },
    }))
    .filter((inp) => validateNestingInput(inp).length === 0);

  const arbEdgeInput: fc.Arbitrary<NestingInput> = arbEdgeNestingInput(arbSpacing)
    .map(({ parts, sheets, spacing }) => ({
      parts,
      sheets,
      params: { ...DEFAULT_NESTING_PARAMS, spacing },
    }))
    .filter((inp) => validateNestingInput(inp).length === 0);

  it('žádný překryv, rozestup, užitná plocha, zóny, úplnost, sklad (všechny heuristiky)', () => {
    fc.assert(
      fc.property(
        arbInput,
        fc.constantFrom(...RECT_HEURISTICS),
        fc.constantFrom(...PART_ORDERS),
        (inp, h, o) => {
          const r = packRects(inp, h, o);
          expect(rectInvariantViolations(inp, r)).toEqual([]);
        },
      ),
      { numRuns: 200, seed: 20261012 },
    );
  });

  it('nestRects splňuje invarianty a je deterministický', () => {
    fc.assert(
      fc.property(arbInput, (inp) => {
        const a = nestRects(inp);
        expect(rectInvariantViolations(inp, a)).toEqual([]);
        expect(nestRects(inp)).toEqual(a);
      }),
      { numRuns: 50, seed: 7 },
    );
  });

  it('okrajové vstupy: materiály, sklad 0, zbytky, zóny přes/mimo tabuli, díly přesně na míru', () => {
    fc.assert(
      fc.property(arbEdgeInput, fc.constantFrom(...RECT_HEURISTICS), (inp, h) => {
        const r = packRects(inp, h, 'area');
        expect(rectInvariantViolations(inp, r)).toEqual([]);
        expect(rectInvariantViolations(inp, nestRects(inp))).toEqual([]);
      }),
      { numRuns: 300, seed: 5 },
    );
  });

  it('kontrolor důvodů odhalí chybný důvod (test testu)', () => {
    const inp = input([part('a', 100, 100)], [sheet()]);
    expect(
      reasonViolations(inp, [{ partId: 'a', instance: 0, reason: 'out-of-sheets' }]),
    ).not.toEqual([]);
    expect(reasonViolations(inp, [{ partId: 'a', instance: 0, reason: 'too-large' }])).not.toEqual(
      [],
    );
    expect(
      reasonViolations(inp, [{ partId: 'a', instance: 0, reason: 'no-matching-sheet' }]),
    ).not.toEqual([]);
    const huge = input([part('b', 5000, 100, 1, { rotation: 'ortho' })], [sheet()]);
    expect(reasonViolations(huge, [{ partId: 'b', instance: 0, reason: 'blocked' }])).not.toEqual(
      [],
    );
    // otočený se vejde → too-large je chyba
    const tall = input([part('c', 100, 1500)], [sheet({ width: 2000, height: 1000 })]);
    expect(reasonViolations(tall, [{ partId: 'c', instance: 0, reason: 'too-large' }])).not.toEqual(
      [],
    );
  });
});

describe('výkon', () => {
  it('1000 kusů 20 různých dílů na jeden formát (16 kombinací) v rozumném čase', () => {
    const parts = Array.from({ length: 20 }, (_, i) =>
      part(`p${i}`, 80 + ((i * 37) % 400), 60 + ((i * 53) % 300), 50),
    );
    const inp = input(parts, [sheet({ width: 2800, height: 2070, margin: 10 })], 6);
    const t0 = performance.now();
    const r = nestRects(inp);
    const ms = performance.now() - t0;
    expect(rectInvariantViolations(inp, r)).toEqual([]);
    expect(r.unplaced).toEqual([]);
    // velká rezerva kvůli pomalým strojům (lokálně < 1 s); benchmark je krok 5.7
    expect(ms).toBeLessThan(15000);
  });
});
