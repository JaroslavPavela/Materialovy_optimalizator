import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EPS } from '../../../src/core/geometry/eps.ts';
import { polygonBBox } from '../../../src/core/geometry/polygon.ts';
import { placePolygon } from '../../../src/core/geometry/transform.ts';
import {
  DEFAULT_NESTING_PARAMS,
  type NestingInput,
  type Part,
  type Sheet,
} from '../../../src/core/model.ts';
import { SLACK } from '../../../src/core/nesting/nfp.ts';
import {
  defaultShapeOrder,
  placeShapes,
  ShapeContext,
  ShapeSheet,
  shapeUnplaceableReason,
} from '../../../src/core/nesting/placer.ts';
import { partPolygon } from '../../../src/core/nesting/shapes.ts';
import { shapeInvariantViolations } from './invariants.ts';

const sheet = (patch: Partial<Sheet> = {}): Sheet => ({
  id: 's',
  name: 'S',
  width: 1000,
  height: 500,
  stock: null,
  margin: 10,
  forbiddenZones: [],
  ...patch,
});

const rect = (id: string, w: number, h: number, patch: Partial<Part> = {}): Part => ({
  id,
  name: id,
  width: w,
  height: h,
  quantity: 1,
  rotation: 'ortho',
  ...patch,
});

/** Příruba „D" s otvorem (oblouky). */
const dPart = (id: string, quantity: number): Part => ({
  id,
  name: id,
  width: 110,
  height: 60,
  quantity,
  rotation: 'ortho',
  shape: {
    outer: [
      { x: 0, y: 0, bulge: 0 },
      { x: 80, y: 0, bulge: 1 },
      { x: 80, y: 60, bulge: 0 },
      { x: 0, y: 60, bulge: 0 },
    ],
    holes: [
      [
        { x: 20, y: 30, bulge: -1 },
        { x: 40, y: 30, bulge: -1 },
      ],
    ],
  },
});

/** Tvar L 100 × 100 s ramenem 30. */
const lPart = (id: string, quantity: number): Part => ({
  id,
  name: id,
  width: 100,
  height: 100,
  quantity,
  rotation: 'ortho',
  shape: {
    outer: [
      { x: 0, y: 0, bulge: 0 },
      { x: 100, y: 0, bulge: 0 },
      { x: 100, y: 30, bulge: 0 },
      { x: 30, y: 30, bulge: 0 },
      { x: 30, y: 100, bulge: 0 },
      { x: 0, y: 100, bulge: 0 },
    ],
    holes: [],
  },
});

const run = (input: NestingInput) => {
  const ctx = new ShapeContext(input);
  return placeShapes(ctx, defaultShapeOrder(input));
};

const input = (parts: Part[], sheets: Sheet[] = [sheet()], spacing = 0): NestingInput => ({
  parts,
  sheets,
  params: { ...DEFAULT_NESTING_PARAMS, spacing, mode: 'shape' },
});

describe('tvarový placer', () => {
  it('díly na dělení tabule se vejdou přesně (4 × 245 na užitných 980)', () => {
    const inp = input([rect('a', 245, 480, { quantity: 4, rotation: 'locked' })]);
    const r = run(inp);
    expect(r.unplaced).toEqual([]);
    expect(r.layouts).toHaveLength(1);
    expect(shapeInvariantViolations(inp, r)).toEqual([]);
  });

  it('první díl vlevo dole v užitné ploše, další vedle něj', () => {
    const inp = input([rect('a', 100, 50, { quantity: 2, rotation: 'locked' })], [sheet()], 6);
    const r = run(inp);
    const [p0, p1] = r.layouts[0]!.placements;
    expect(p0).toMatchObject({ x: 10, y: 10, rotation: 0 });
    // Dotyk s předchozím dílem v toleranci skládání (SLACK < EPS).
    expect(Math.abs(p1!.x - 116)).toBeLessThanOrEqual(EPS);
    expect(p1!.y).toBeCloseTo(10, 9);
  });

  it('tvary s oblouky, otvory, tvar L a zakázaná zóna: invarianty platí', () => {
    const zone = {
      id: 'z',
      polygon: [
        { x: 0, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 120 },
        { x: 0, y: 120 },
      ],
    };
    const inp = input(
      [dPart('d', 6), lPart('l', 4), rect('r', 200, 80, { quantity: 2 })],
      [sheet({ forbiddenZones: [zone] })],
      4,
    );
    const r = run(inp);
    expect(r.unplaced).toEqual([]);
    expect(shapeInvariantViolations(inp, r)).toEqual([]);
  });

  it('tvary L do sebe zapadnou těsněji než obalové obdélníky', () => {
    const inp = input([lPart('l', 2)], [sheet({ width: 200, height: 150, margin: 0 })], 0);
    const r = run(inp);
    expect(r.unplaced).toEqual([]);
    expect(r.layouts).toHaveLength(1);
    // Dva obalové obdélníky 100 × 100 by se na 200 × 150 vešly jen vedle sebe;
    // zaklesnuté L zaberou méně než 200 na šířku nebo méně než 150 na výšku.
    const boxes = r.layouts[0]!.placements.map((p) =>
      polygonBBox(placePolygon(partPolygon(lPart('l', 1)), p.rotation, p.x, p.y)),
    );
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const top = Math.max(...boxes.map((b) => b.y + b.height));
    expect(right * top).toBeLessThan(200 * 100);
    expect(shapeInvariantViolations(inp, r)).toEqual([]);
  });

  it('natočení: locked jen 0°, flip 0/180°', () => {
    const inp = input(
      [
        rect('a', 300, 100, { quantity: 3, rotation: 'locked' }),
        dPart('d', 4),
        { ...dPart('f', 3), rotation: 'flip' },
      ],
      [sheet()],
      2,
    );
    const r = run(inp);
    expect(shapeInvariantViolations(inp, r)).toEqual([]);
  });

  it('více tabulí podle skladu; co se nevejde, je „došly tabule"', () => {
    const inp = input([rect('a', 400, 400, { quantity: 5 })], [sheet({ stock: 2 })]);
    const r = run(inp);
    expect(r.layouts).toHaveLength(2);
    expect(r.unplaced.map((u) => u.reason)).toEqual(['out-of-sheets']);
    expect(shapeInvariantViolations(inp, r)).toEqual([]);
  });

  it('důvody neumístění: materiál, velikost, zablokováno zónou', () => {
    const blockedSheet = sheet({
      material: 'ocel',
      width: 300,
      height: 300,
      forbiddenZones: [
        {
          id: 'z',
          polygon: [
            { x: 140, y: 0 },
            { x: 160, y: 0 },
            { x: 160, y: 300 },
            { x: 140, y: 300 },
          ],
        },
      ],
    });
    const ctx = new ShapeContext(
      input(
        [rect('m', 10, 10, { material: 'nerez' }), rect('big', 2000, 10), rect('b', 200, 200)],
        [blockedSheet],
      ),
    );
    expect(shapeUnplaceableReason(ctx, ctx.input.parts[0]!)).toBe('no-matching-sheet');
    expect(shapeUnplaceableReason(ctx, ctx.input.parts[1]!)).toBe('too-large');
    expect(shapeUnplaceableReason(ctx, ctx.input.parts[2]!)).toBe('blocked');
  });

  it('deterministický: stejný vstup = stejný výsledek', () => {
    const inp = input([dPart('d', 5), lPart('l', 3)], [sheet()], 3);
    expect(run(inp)).toEqual(run(inp));
  });
});

describe('regrese z revize placeru', () => {
  it.each(['nfp-mikrootvor-dil.json', 'nfp-mikrootvor-zona.json'])(
    '%s: falešný mikrootvor v NFP nevede k dílu přes jiný díl ani zónu',
    (name) => {
      const inp = JSON.parse(
        readFileSync(new URL(`../../fixtures/nesting/${name}`, import.meta.url), 'utf8'),
      ) as NestingInput;
      expect(shapeInvariantViolations(inp, run(inp))).toEqual([]);
    },
  );
});

describe('pojistka ověření kandidáta', () => {
  it('zamítne překryv rohem (0,5 mm), pustí dotyk a převis v toleranci skládání', () => {
    const inp = input([rect('a', 100, 100, { rotation: 'locked' })], [sheet()], 0);
    const ctx = new ShapeContext(inp);
    const s = new ShapeSheet(ctx, inp.sheets[0]!);
    const part = inp.parts[0]!;
    const at = (x: number, y: number) => ({ at: { x, y }, rotation: 0, bottom: y, left: x });
    s.place(part, at(10, 10));
    expect(s.fits(part, at(109.5, 109.5))).toBe(false);
    expect(s.fits(part, at(110, 10))).toBe(true);
    expect(s.fits(part, at(110 - SLACK, 10))).toBe(true);
    expect(s.fits(part, at(110 - 2 * EPS, 10))).toBe(false);
  });
});

describe('díl v otvoru jiného dílu (6.1)', () => {
  /** Rám w × h se stěnou `wall` (otvor CW). */
  const frame = (id: string, w: number, h: number, wall: number): Part => {
    const r = (x: number, y: number, rw: number, rh: number) => [
      { x, y, bulge: 0 },
      { x: x + rw, y, bulge: 0 },
      { x: x + rw, y: y + rh, bulge: 0 },
      { x, y: y + rh, bulge: 0 },
    ];
    return {
      id,
      name: id,
      width: w,
      height: h,
      quantity: 1,
      rotation: 'locked',
      shape: {
        outer: r(0, 0, w, h),
        holes: [r(wall, wall, w - 2 * wall, h - 2 * wall).toReversed()],
      },
    };
  };

  it('malé díly se umístí do otvoru rámu, který vyplní celou tabuli', () => {
    const inp = input(
      [frame('f', 300, 300, 50), rect('m', 60, 60, { quantity: 4, rotation: 'locked' })],
      [sheet({ width: 300, height: 300, margin: 0, stock: 1 })],
      10,
    );
    const r = run(inp);
    expect(r.unplaced).toEqual([]);
    expect(r.layouts).toHaveLength(1);
    // Otvor 200 − rozestup: vejde se 2 × 2 díly 60 (s rozestupem 10).
    for (const p of r.layouts[0]!.placements.filter((x) => x.partId === 'm')) {
      expect(p.x).toBeGreaterThanOrEqual(60 - 1e-3);
      expect(p.y).toBeGreaterThanOrEqual(60 - 1e-3);
      expect(p.x + 60).toBeLessThanOrEqual(240 + 1e-3);
      expect(p.y + 60).toBeLessThanOrEqual(240 + 1e-3);
    }
    expect(shapeInvariantViolations(inp, r)).toEqual([]);
  });

  it('pátý díl se do otvoru nevejde a skončí neumístěný', () => {
    const inp = input(
      [frame('f', 300, 300, 50), rect('m', 60, 60, { quantity: 5, rotation: 'locked' })],
      [sheet({ width: 300, height: 300, margin: 0, stock: 1 })],
      10,
    );
    const r = run(inp);
    expect(r.unplaced.map((u) => u.partId)).toEqual(['m']);
    expect(shapeInvariantViolations(inp, r)).toEqual([]);
  });
});
