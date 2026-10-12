import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { remnantSheets } from '../../src/core/remnants.ts';
import { computeMetrics, largestRemnant, partArea } from '../../src/core/metrics.ts';
import {
  DEFAULT_NESTING_PARAMS,
  validateNestingInput,
  type NestingInput,
  type Part,
  type Sheet,
} from '../../src/core/model.ts';
import { nestRects } from '../../src/core/nesting/maxrects.ts';
import { arbRectParts, arbSheet, arbSpacing } from './arbitraries.ts';
import { placedRect } from './nesting/invariants.ts';
import { ringBBox } from '../../src/core/geometry/polygon.ts';

const sheet = (over: Partial<Sheet> = {}): Sheet => ({
  id: 's',
  name: 'tabule',
  width: 1000,
  height: 500,
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

describe('partArea', () => {
  it('obdélník', () => {
    expect(partArea(part('a', 20, 30))).toBe(600);
  });

  it('tvar s kruhovým otvorem: plocha bez otvoru', () => {
    const p = part('a', 100, 100, 1, {
      shape: {
        outer: [
          { x: 0, y: 0, bulge: 0 },
          { x: 100, y: 0, bulge: 0 },
          { x: 100, y: 100, bulge: 0 },
          { x: 0, y: 100, bulge: 0 },
        ],
        holes: [
          [
            { x: 40, y: 50, bulge: -1 },
            { x: 60, y: 50, bulge: -1 },
          ],
        ],
      },
    });
    expect(partArea(p)).toBeCloseTo(10_000 - Math.PI * 100, 9);
  });
});

describe('largestRemnant', () => {
  it('vybere největší volný obdélník a zmenší ho o s/2 z každé strany', () => {
    const free = [
      { x: -3, y: -3, width: 100, height: 50 },
      { x: 497, y: -3, width: 506, height: 506 },
    ];
    expect(largestRemnant(free, 6)).toEqual({ x: 500, y: 0, width: 500, height: 500 });
  });

  it('volný obdélník užší než rozestup není zbytek', () => {
    expect(largestRemnant([{ x: 0, y: 0, width: 5, height: 500 }], 6)).toBeNull();
    expect(largestRemnant([], 6)).toBeNull();
  });
});

describe('computeMetrics', () => {
  it('ručně spočítaný příklad: dvě tabule', () => {
    const inp = input([part('a', 500, 500, 3)], [sheet({ stock: null })]);
    const m = computeMetrics(
      inp,
      [
        {
          sheetId: 's',
          placements: [
            { partId: 'a', instance: 0, x: 0, y: 0, rotation: 0 },
            { partId: 'a', instance: 1, x: 500, y: 0, rotation: 0 },
          ],
          freeRects: [],
        },
        {
          sheetId: 's',
          placements: [{ partId: 'a', instance: 2, x: 0, y: 0, rotation: 0 }],
          freeRects: [{ x: 500, y: 0, width: 500, height: 500 }],
        },
      ],
      1,
    );
    expect(m.sheets.map((s) => s.utilization)).toEqual([1, 0.5]);
    expect(m.sheets[1]!.remnant).toEqual({ x: 500, y: 0, width: 500, height: 500 });
    expect(m.sheets[0]!.remnant).toBeNull();
    expect(m.utilization).toBeCloseTo(0.75, 12);
    expect(m.waste).toBeCloseTo(0.25, 12);
    expect(m.placedCount).toBe(3);
    expect(m.unplacedCount).toBe(1);
  });

  it('bez tabulí je využití i odpad 0', () => {
    const m = computeMetrics(input([part('a', 1, 1)], [sheet()]), [], 1);
    expect(m).toEqual({ sheets: [], utilization: 0, waste: 0, placedCount: 0, unplacedCount: 1 });
  });

  it('bez volných obdélníků (tvarový režim): zbytek = větší volný pruh vpravo/nahoře', () => {
    const placements = [{ partId: 'a', instance: 0, x: 10, y: 10, rotation: 0 }];
    const s1 = sheet({ margin: 10 });
    const m = computeMetrics(
      input([part('a', 300, 100)], [s1], 4),
      [{ sheetId: 's', placements }],
      0,
    );
    // Vpravo 676 × 480, nahoře 980 × 376 → nahoře.
    expect(m.sheets[0]!.remnant).toEqual({ x: 10, y: 114, width: 980, height: 376 });
    // Zóna v horním pruhu → pruh vpravo.
    const zone = {
      id: 'z',
      polygon: [
        { x: 50, y: 300 },
        { x: 100, y: 300 },
        { x: 100, y: 350 },
        { x: 50, y: 350 },
      ],
    };
    const z = computeMetrics(
      input([part('a', 300, 100)], [{ ...s1, forbiddenZones: [zone] }], 4),
      [{ sheetId: 's', placements }],
      0,
    );
    expect(z.sheets[0]!.remnant).toEqual({ x: 314, y: 10, width: 676, height: 480 });
  });

  it('zbytky jako nové tabule: rozměr, příznak, materiál; malé se vynechají', () => {
    const inp = input(
      [part('a', 300, 100)],
      [sheet({ margin: 10, material: 'DTD', thickness: 18 })],
      4,
    );
    const metrics = computeMetrics(
      inp,
      [{ sheetId: 's', placements: [{ partId: 'a', instance: 0, x: 10, y: 10, rotation: 0 }] }],
      0,
    );
    const result = {
      layouts: [
        { sheetId: 's', placements: [{ partId: 'a', instance: 0, x: 10, y: 10, rotation: 0 }] },
      ],
      unplaced: [],
      metrics,
    };
    const sheets = remnantSheets(inp, result, (i) => `z${i}`);
    expect(sheets).toEqual([
      {
        id: 'z0',
        name: 'Zbytek 980 × 376 z tabule 1 (tabule)',
        width: 980,
        height: 376,
        stock: 1,
        margin: 0,
        forbiddenZones: [],
        remnant: true,
        material: 'DTD',
        thickness: 18,
      },
    ]);
    expect(remnantSheets(inp, result, (i) => `z${i}`, 400)).toEqual([]);
  });

  it('neznámý díl nebo tabule vyhodí chybu', () => {
    const inp = input([part('a', 10, 10)], [sheet()]);
    expect(() => computeMetrics(inp, [{ sheetId: 'x', placements: [] }], 0)).toThrow(RangeError);
    expect(() =>
      computeMetrics(
        inp,
        [{ sheetId: 's', placements: [{ partId: 'b', instance: 0, x: 0, y: 0, rotation: 0 }] }],
        0,
      ),
    ).toThrow(RangeError);
  });

  describe('property testy nad výsledky MaxRects', () => {
    const arbInput: fc.Arbitrary<NestingInput> = fc
      .record({ parts: arbRectParts(5), sheet: arbSheet('s0'), spacing: arbSpacing })
      .map(({ parts, sheet: s, spacing }) => ({
        parts,
        sheets: [s],
        params: { ...DEFAULT_NESTING_PARAMS, spacing },
      }))
      .filter((inp) => validateNestingInput(inp).length === 0);

    it('využití v [0, 1], součty sedí, zbytek leží v užitné ploše mimo díly a zóny', () => {
      fc.assert(
        fc.property(arbInput, (inp) => {
          const r = nestRects(inp);
          const m = computeMetrics(inp, r.layouts, r.unplaced.length);
          const s = inp.params.spacing;
          const sh = inp.sheets[0]!;
          expect(m.placedCount + m.unplacedCount).toBe(
            inp.parts.reduce((a, p) => a + p.quantity, 0),
          );
          expect(m.utilization).toBeGreaterThanOrEqual(0);
          expect(m.utilization).toBeLessThanOrEqual(1 + 1e-9);
          expect(m.utilization + m.waste).toBeCloseTo(r.layouts.length > 0 ? 1 : 0, 12);
          m.sheets.forEach((sm, i) => {
            expect(sm.utilization).toBeLessThanOrEqual(1 + 1e-9);
            const rem = sm.remnant;
            if (!rem) return;
            expect(rem.x).toBeGreaterThanOrEqual(sh.margin - 1e-3);
            expect(rem.y).toBeGreaterThanOrEqual(sh.margin - 1e-3);
            expect(rem.x + rem.width).toBeLessThanOrEqual(sh.width - sh.margin + 1e-3);
            expect(rem.y + rem.height).toBeLessThanOrEqual(sh.height - sh.margin + 1e-3);
            const others = [
              ...r.layouts[i]!.placements.map((p) => placedRect(inp, p)),
              ...sh.forbiddenZones.map((z) => ringBBox(z.polygon)),
            ];
            for (const pr of others) {
              const gx = Math.max(pr.x - (rem.x + rem.width), rem.x - (pr.x + pr.width));
              const gy = Math.max(pr.y - (rem.y + rem.height), rem.y - (pr.y + pr.height));
              expect(Math.max(gx, gy)).toBeGreaterThanOrEqual(s - 1e-3);
            }
          });
        }),
        { numRuns: 100, seed: 11 },
      );
    });
  });
});
