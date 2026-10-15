import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSheetDxf } from '../../../src/core/export/dxf-writer.ts';
import { bulgeToArc } from '../../../src/core/geometry/contour.ts';
import { EPS } from '../../../src/core/geometry/eps.ts';
import type { Part, Sheet } from '../../../src/core/model.ts';
import { placedContours } from '../../../src/core/placed.ts';
import type { Point } from '../../../src/core/geometry/types.ts';
import { pointSegmentDistance } from '../../../src/core/geometry/polygon.ts';
import { arc, circle, dxf, ent, line, rectPoly, type G } from './dxf-builder.ts';
import {
  approximateCurve,
  nurbsPoint,
  readDxf,
  type DxfSegment,
} from '../../../src/core/import/dxf.ts';

const NEG_Z: G[] = [
  [210, 0],
  [220, 0],
  [230, -1],
];

const near = (a: Point, b: Point, eps = 1e-9) =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

function read(text: string) {
  const r = readDxf(text);
  expect(r.ok).toBe(true);
  return r;
}

/** Všechny body segmentů (začátky). */
const starts = (segs: readonly DxfSegment[]) => segs.map((s) => s.a);

afterEach(() => vi.restoreAllMocks());

describe('jednotky', () => {
  it('mm, palce, cm; chybějící $INSUNITS → mm s varováním', () => {
    const e = [line(0, 0, 1, 2)];
    expect(read(dxf({ entities: e })).segments[0]).toMatchObject({
      a: { x: 0, y: 0 },
      b: { x: 1, y: 2 },
      bulge: 0,
      layer: 'DIL',
    });
    const inch = read(dxf({ insunits: 1, entities: e }));
    expect(inch.units).toEqual({ code: 1, name: 'palce', toMm: 25.4 });
    expect(near(inch.segments[0]!.b, { x: 25.4, y: 50.8 })).toBe(true);
    expect(read(dxf({ insunits: 5, entities: e })).segments[0]!.b).toEqual({ x: 10, y: 20 });
    const none = read(dxf({ insunits: null, entities: e }));
    expect(none.units.toMm).toBe(1);
    expect(none.warnings[0]).toMatch(/nemá uvedené jednotky/);
    expect(read(dxf({ insunits: 3, entities: e })).warnings[0]).toMatch(/Nepodporované jednotky/);
  });
});

describe('entity', () => {
  it('ARC: úhly ve stupních, CCW, i přes 0°', () => {
    const [s] = read(dxf({ entities: [arc(0, 0, 10, 0, 90)] })).segments;
    expect(near(s!.a, { x: 10, y: 0 })).toBe(true);
    expect(near(s!.b, { x: 0, y: 10 })).toBe(true);
    expect(s!.bulge).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    const [w] = read(dxf({ entities: [arc(0, 0, 10, 350, 10)] })).segments;
    const a = bulgeToArc(w!.a, w!.b, w!.bulge)!;
    expect(a.sweep).toBeCloseTo(20, 9);
    expect(near(a.center, { x: 0, y: 0 }, 1e-9)).toBe(true);
  });

  it('ARC a CIRCLE s normálou −Z se zrcadlí podle osy Y (OCS)', () => {
    const [s] = read(dxf({ entities: [arc(5, 0, 2, 0, 90, ...NEG_Z)] })).segments;
    // OCS (7, 0) → WCS (−7, 0); oblouk ve WCS běží CW.
    expect(near(s!.a, { x: -7, y: 0 })).toBe(true);
    expect(near(s!.b, { x: -5, y: 2 })).toBe(true);
    expect(s!.bulge).toBeLessThan(0);
    expect(near(bulgeToArc(s!.a, s!.b, s!.bulge)!.center, { x: -5, y: 0 })).toBe(true);
    const c = read(dxf({ entities: [circle(5, 1, 2, ...NEG_Z)] })).segments;
    expect(c).toHaveLength(2);
    expect(near(bulgeToArc(c[0]!.a, c[0]!.b, c[0]!.bulge)!.center, { x: -5, y: 1 })).toBe(true);
  });

  it('CIRCLE = dva půloblouky CCW', () => {
    const c = read(dxf({ entities: [circle(10, 20, 5)] })).segments;
    expect(c.map((s) => s.bulge)).toEqual([1, 1]);
    expect(c[0]!.a).toEqual(c[1]!.b);
    expect(c[0]!.b).toEqual(c[1]!.a);
  });

  it('nulový poloměr → varování a přeskočení', () => {
    const r = readDxf(dxf({ entities: [circle(0, 0, 0), line(0, 0, 1, 0)] }));
    expect(r.segments).toHaveLength(1);
    expect(r.warnings.join()).toMatch(/nulovým/);
  });

  it('LWPOLYLINE: uzavřená s bulge, duplicitní koncový bod nevytvoří nulový segment', () => {
    const lw = ent(
      'LWPOLYLINE',
      [90, 5],
      [70, 1],
      [10, 0],
      [20, 0],
      [10, 10],
      [20, 0],
      [42, 1],
      [10, 10],
      [20, 10],
      [10, 0],
      [20, 10],
      [10, 0],
      [20, 0],
    );
    const s = read(dxf({ entities: [lw] })).segments;
    expect(s).toHaveLength(4);
    expect(s[1]!.bulge).toBe(1);
    expect(s.every((x) => x.bulge === 0 || x === s[1])).toBe(true);
  });

  it('LWPOLYLINE s normálou −Z: zrcadlení bodů i bulge', () => {
    const lw = ent(
      'LWPOLYLINE',
      [90, 2],
      [70, 0],
      [10, 1],
      [20, 0],
      [42, 0.5],
      [10, 3],
      [20, 0],
      ...NEG_Z,
    );
    const [s] = read(dxf({ entities: [lw] })).segments;
    expect(s).toMatchObject({ a: { x: -1, y: 0 }, b: { x: -3, y: 0 }, bulge: -0.5 });
  });

  it('POLYLINE 2D s VERTEX bulge; síť se přeskočí', () => {
    const v = (x: number, y: number, b = 0): G[] => [
      [0, 'VERTEX'],
      [8, 'DIL'],
      [10, x],
      [20, y],
      [30, 0],
      ...(b ? ([[42, b]] as G[]) : []),
    ];
    const pl: G[] = [
      ...ent('POLYLINE', [66, 1], [10, 0], [20, 0], [30, 0], [70, 1]),
      ...v(0, 0),
      ...v(10, 0, -1),
      ...v(10, 10),
      [0, 'SEQEND'],
      [8, 'DIL'],
    ];
    const s = read(dxf({ entities: [pl] })).segments;
    expect(s).toHaveLength(3);
    expect(s[1]!.bulge).toBe(-1);
    const mesh: G[] = [
      ...ent('POLYLINE', [66, 1], [10, 0], [20, 0], [30, 0], [70, 64]),
      ...v(0, 0),
      ...v(1, 0),
      [0, 'SEQEND'],
      [8, 'DIL'],
    ];
    const r = readDxf(dxf({ entities: [mesh, line(0, 0, 1, 1)] }));
    expect(r.segments).toHaveLength(1);
    expect(r.warnings.join()).toMatch(/POLYLINE \(síť\)/);
  });

  it('POLYLINE bez SEQEND (i bez vrcholů) skončí u další entity – dxf-parser se zacyklil', () => {
    const v = (x: number, y: number): G[] => [
      [0, 'VERTEX'],
      [8, 'DIL'],
      [10, x],
      [20, y],
    ];
    const empty = ent('POLYLINE', [66, 1], [10, 0], [20, 0], [30, 0], [70, 1]);
    const open: G[] = [
      ...ent('POLYLINE', [66, 1], [10, 0], [20, 0], [30, 0], [70, 1]),
      ...v(0, 0),
      ...v(10, 0),
      ...v(10, 10),
    ];
    const r = read(dxf({ entities: [empty, open, empty, line(0, 0, 5, 5)] }));
    expect(r.segments).toHaveLength(4);
    expect(r.segments[3]).toMatchObject({ a: { x: 0, y: 0 }, b: { x: 5, y: 5 } });
  });

  it('ELLIPSE: body na elipse v toleranci, uzavřená smyčka', () => {
    const e = ent(
      'ELLIPSE',
      [10, 100],
      [20, 50],
      [30, 0],
      [11, 40],
      [21, 0],
      [31, 0],
      [40, 0.5],
      [41, 0],
      [42, 2 * Math.PI],
    );
    const s = read(dxf({ entities: [e] })).segments;
    expect(s.length).toBeGreaterThan(30);
    expect(s.at(-1)!.b).toEqual(s[0]!.a);
    const onEllipse = (p: Point) => ((p.x - 100) / 40) ** 2 + ((p.y - 50) / 20) ** 2;
    for (const seg of s) {
      expect(Math.abs(onEllipse(seg.a) - 1)).toBeLessThan(1e-9);
      // Odchylka tětivy: střed tětivy leží uvnitř, ale blízko elipsy.
      const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
      expect(1 - onEllipse(mid)).toBeLessThan(2 * (0.01 / 20) + 1e-9);
    }
  });

  it('ELLIPSE výseč s normálou −Z běží opačně', () => {
    const e = ent(
      'ELLIPSE',
      [10, 0],
      [20, 0],
      [30, 0],
      [11, 10],
      [21, 0],
      [31, 0],
      [40, 1],
      [41, 0],
      [42, Math.PI / 2],
      ...NEG_Z,
    );
    const s = read(dxf({ entities: [e] })).segments;
    expect(near(s[0]!.a, { x: 10, y: 0 })).toBe(true);
    expect(near(s.at(-1)!.b, { x: 0, y: -10 }, 1e-9)).toBe(true);
  });

  it('SPLINE: racionální čtvrtkruh (váhy) leží na kružnici; lineární = řídicí polygon', () => {
    const w = Math.SQRT1_2;
    const sp = ent(
      'SPLINE',
      [70, 12],
      [71, 2],
      [72, 6],
      [73, 3],
      [40, 0],
      [40, 0],
      [40, 0],
      [40, 1],
      [40, 1],
      [40, 1],
      [10, 100],
      [20, 0],
      [30, 0],
      [41, 1],
      [10, 100],
      [20, 100],
      [30, 0],
      [41, w],
      [10, 0],
      [20, 100],
      [30, 0],
      [41, 1],
    );
    const s = read(dxf({ entities: [sp] })).segments;
    expect(s.length).toBeGreaterThan(10);
    expect(near(s[0]!.a, { x: 100, y: 0 })).toBe(true);
    expect(near(s.at(-1)!.b, { x: 0, y: 100 })).toBe(true);
    for (const seg of s) expect(Math.abs(Math.hypot(seg.a.x, seg.a.y) - 100)).toBeLessThan(1e-9);

    const lin = ent(
      'SPLINE',
      [70, 8],
      [71, 1],
      [40, 0],
      [40, 0],
      [40, 1],
      [40, 2],
      [40, 2],
      [10, 0],
      [20, 0],
      [10, 5],
      [20, 5],
      [10, 10],
      [20, 0],
    );
    const l = read(dxf({ entities: [lin] })).segments;
    // Body leží na řídicím polygonu (0,0)–(5,5)–(10,0) a obsahují jeho vrchol.
    for (const p of starts(l)) expect(Math.abs(p.y - Math.min(p.x, 10 - p.x))).toBeLessThan(1e-12);
    expect(starts(l)).toContainEqual({ x: 5, y: 5 });
    expect(l.at(-1)!.b).toEqual({ x: 10, y: 0 });
  });

  it('SPLINE jen s body proložení → lomená čára s varováním', () => {
    const sp = ent(
      'SPLINE',
      [70, 8],
      [71, 3],
      [74, 3],
      [11, 0],
      [21, 0],
      [11, 5],
      [21, 5],
      [11, 10],
      [21, 0],
    );
    const r = read(dxf({ entities: [sp] }));
    expect(r.segments).toHaveLength(2);
    expect(r.warnings.join()).toMatch(/fit points/);
  });
});

describe('bloky', () => {
  const sq: G[][] = [line(0, 0, 10, 0), line(10, 0, 10, 10), arc(5, 10, 5, 0, 180)];

  it('INSERT: bázový bod, měřítko, otočení a posun', () => {
    const ins = ent('INSERT', [2, 'CTV'], [10, 100], [20, 50], [30, 0], [41, 2], [42, 2], [50, 90]);
    const s = read(
      dxf({ blocks: [{ name: 'CTV', base: { x: 10, y: 0 }, entities: sq }], entities: [ins] }),
    ).segments;
    // (0, 0) − báze (10, 0) = (−10, 0) → ×2 = (−20, 0) → 90° = (0, −20) → + (100, 50).
    expect(near(s[0]!.a, { x: 100, y: 30 })).toBe(true);
    expect(near(s[0]!.b, { x: 100, y: 50 })).toBe(true);
    expect(s[2]!.bulge).toBeCloseTo(1, 12);
  });

  it('zrcadlené vložení obrátí oblouky; nestejnoměrné měřítko je převede na úsečky', () => {
    const mirror = ent('INSERT', [2, 'CTV'], [10, 0], [20, 0], [30, 0], [41, -1], [42, 1]);
    const m = read(dxf({ blocks: [{ name: 'CTV', entities: sq }], entities: [mirror] })).segments;
    expect(m[2]!.bulge).toBeCloseTo(-1, 12);
    expect(near(m[2]!.a, { x: -10, y: 10 })).toBe(true);
    const stretch = ent('INSERT', [2, 'CTV'], [10, 0], [20, 0], [30, 0], [41, 2], [42, 1]);
    const s = read(dxf({ blocks: [{ name: 'CTV', entities: sq }], entities: [stretch] })).segments;
    expect(s.length).toBeGreaterThan(10);
    expect(s.every((x) => x.bulge === 0)).toBe(true);
    // Body leží na elipse (x−10)²/10² + (y−10)²/5² = 1.
    for (const seg of s.slice(2)) {
      expect(Math.abs(((seg.b.x - 10) / 10) ** 2 + ((seg.b.y - 10) / 5) ** 2 - 1)).toBeLessThan(
        1e-9,
      );
    }
  });

  it('pole vložení (sloupce × řádky) a vnořené bloky', () => {
    const arr = ent(
      'INSERT',
      [2, 'L'],
      [10, 0],
      [20, 0],
      [30, 0],
      [70, 3],
      [71, 2],
      [44, 100],
      [45, 50],
    );
    const inner = { name: 'L', entities: [line(0, 0, 1, 0)] };
    const s = read(dxf({ blocks: [inner], entities: [arr] })).segments;
    expect(starts(s)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 },
      { x: 200, y: 50 },
    ]);
    const outer = { name: 'O', entities: [ent('INSERT', [2, 'L'], [10, 5], [20, 0], [30, 0])] };
    const n = read(
      dxf({
        blocks: [inner, outer],
        entities: [ent('INSERT', [2, 'O'], [10, 0], [20, 7], [30, 0])],
      }),
    ).segments;
    expect(n[0]).toMatchObject({ a: { x: 5, y: 7 }, b: { x: 6, y: 7 } });
  });

  it('chybějící a cyklický blok → varování, ne pád', () => {
    const cyc = {
      name: 'C',
      entities: [line(0, 0, 1, 0), ent('INSERT', [2, 'C'], [10, 1], [20, 0], [30, 0])],
    };
    const r = readDxf(
      dxf({
        blocks: [cyc],
        entities: [
          ent('INSERT', [2, 'C'], [10, 0], [20, 0], [30, 0]),
          ent('INSERT', [2, 'NIC'], [10, 0], [20, 0], [30, 0]),
        ],
      }),
    );
    expect(r.segments).toHaveLength(1);
    expect(r.warnings.join('\n')).toMatch(/„C" je vnořen/);
    expect(r.warnings.join('\n')).toMatch(/„NIC" ve výkresu chybí/);
  });
});

describe('ostatní', () => {
  it('texty, kóty a šrafy se přeskočí s varováním a bez výpisu do konzole', () => {
    const spies = (['log', 'warn', 'error'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(() => {}),
    );
    const text = ent('TEXT', [10, 0], [20, 0], [30, 0], [40, 2], [1, 'Bok']);
    const hatch = ent('HATCH', [10, 0], [20, 0], [30, 0], [2, 'ANSI31'], [70, 0], [71, 0], [91, 0]);
    const leader = ent('LEADER', [10, 0], [20, 0], [30, 0]);
    const r = readDxf(dxf({ entities: [text, hatch, leader, line(0, 0, 1, 0)] }));
    expect(r.segments).toHaveLength(1);
    expect(r.warnings.join()).toMatch(/TEXT \(1\), HATCH \(1\), LEADER \(1\)/);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('entita v prostoru výkresu (paper space) se přeskočí', () => {
    const r = readDxf(dxf({ entities: [[...line(0, 0, 1, 0), [67, 1]], line(0, 0, 2, 0)] }));
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.b.x).toBe(2);
  });

  it('bajty: UTF-8 i Windows-1250 (název vrstvy)', () => {
    const text = dxf({
      entities: [
        [
          [0, 'LINE'],
          [8, 'Díly č.1'],
          [10, 0],
          [20, 0],
          [11, 1],
          [21, 0],
        ],
      ],
    });
    expect(readDxf(new TextEncoder().encode(text)).segments[0]!.layer).toBe('Díly č.1');
    const cp1250 = Uint8Array.from(text, (ch) => ({ í: 0xed, č: 0xe8 })[ch] ?? ch.charCodeAt(0));
    expect(readDxf(cp1250.buffer).segments[0]!.layer).toBe('Díly č.1');
  });

  it('binární, poškozený a prázdný výkres', () => {
    expect(readDxf('AutoCAD Binary DXF\r\n\x1a\x00').errors[0]).toMatch(/Binární DXF/);
    const bad = readDxf('0\nSECTION\n2\nENTITIES\n0\nLINE\n10\nx');
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatch(/nelze přečíst/);
    const empty = readDxf(dxf({ entities: [] }));
    expect(empty.ok).toBe(true);
    expect(empty.errors).toEqual(['Výkres neobsahuje žádnou geometrii dílu.']);
  });
});

describe('křivky', () => {
  it('approximateCurve: konce přesně, odchylka v toleranci', () => {
    const f = (t: number) => ({ x: Math.cos(t), y: Math.sin(t) });
    const pts = approximateCurve(f, 0, Math.PI, 1e-3, 2);
    expect(pts[0]).toEqual(f(0));
    expect(pts.at(-1)).toEqual(f(Math.PI));
    for (let i = 1; i < pts.length; i++) {
      const m = { x: (pts[i - 1]!.x + pts[i]!.x) / 2, y: (pts[i - 1]!.y + pts[i]!.y) / 2 };
      expect(1 - Math.hypot(m.x, m.y)).toBeLessThanOrEqual(1e-3);
    }
  });

  it('nurbsPoint: krajní body sevřené křivky jsou krajní řídicí body', () => {
    const ctrl = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 0 },
    ];
    const knots = [0, 0, 0, 0, 1, 1, 1, 1];
    expect(nurbsPoint(3, knots, ctrl, null, 0)).toEqual({ x: 0, y: 0 });
    expect(near(nurbsPoint(3, knots, ctrl, null, 1), { x: 4, y: 0 })).toBe(true);
    // Bézier: B(½) = (P0 + 3P1 + 3P2 + P3) / 8.
    expect(near(nurbsPoint(3, knots, ctrl, null, 0.5), { x: 2, y: 1.5 })).toBe(true);
  });
});

describe('vlastní DXF writer → readDxf', () => {
  const part: Part = {
    id: 'd',
    name: 'D',
    width: 110,
    height: 60,
    quantity: 1,
    rotation: 'free',
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
  };
  const sheet: Sheet = {
    id: 's',
    name: 'S',
    width: 500,
    height: 300,
    stock: null,
    margin: 0,
    forbiddenZones: [],
  };
  const placement = { partId: 'd', instance: 0, x: 200, y: 50, rotation: 33 };

  for (const segments of ['polyline', 'lines-arcs'] as const) {
    it(`režim ${segments}: obrysy dílu se přečtou zpět v EPS`, () => {
      const text = writeSheetDxf(sheet, { sheetId: 's', placements: [placement] }, [part], {
        segments,
      });
      const r = readDxf(text);
      expect(r.warnings).toEqual(['Přeskočeny entity bez geometrie dílu: TEXT (1).']);
      const dily = r.segments.filter((x) => x.layer === 'DILY');
      const c = placedContours(part, placement);
      expect(dily).toHaveLength(c.outer.length);
      c.outer.forEach((v, i) => {
        const next = c.outer[(i + 1) % c.outer.length]!;
        expect(near(dily[i]!.a, v, EPS)).toBe(true);
        expect(near(dily[i]!.b, next, EPS)).toBe(true);
        expect(dily[i]!.bulge).toBeCloseTo(v.bulge, 6);
      });
      const otvory = r.segments.filter((x) => x.layer === 'OTVORY');
      expect(otvory).toHaveLength(2);
      const hole = bulgeToArc(otvory[0]!.a, otvory[0]!.b, otvory[0]!.bulge)!;
      expect(
        near(
          hole.center,
          {
            x: (c.holes[0]![0]!.x + c.holes[0]![1]!.x) / 2,
            y: (c.holes[0]![0]!.y + c.holes[0]![1]!.y) / 2,
          },
          EPS,
        ),
      ).toBe(true);
      expect(hole.radius).toBeCloseTo(10, 6);
    });
  }
});

describe('revize 4.1: okrajové případy', () => {
  /**
   * Skutečná odchylka křivky od lomené čáry (husté vzorkování parametru).
   * Body i úsečky jdou v pořadí parametru – stačí posuvné okno kolem
   * naposledy nejbližší úsečky.
   */
  function maxDeviation(f: (t: number) => Point, pts: readonly Point[]) {
    let worst = 0;
    let k = 1;
    for (let i = 0; i <= 4000; i++) {
      const p = f(i / 4000);
      let d = Infinity;
      let best = k;
      for (let j = Math.max(1, k - 3); j < Math.min(pts.length, k + 12); j++) {
        const dj = pointSegmentDistance(p, pts[j - 1]!, pts[j]!);
        if (dj < d) {
          d = dj;
          best = j;
        }
      }
      k = best;
      worst = Math.max(worst, d);
    }
    return worst;
  }

  it('esovitý splajn (inflexe uprostřed úseku) i náhodné kubiky drží odchylku v toleranci', () => {
    const knots = [0, 0, 0, 0, 1, 1, 1, 1];
    const S = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 0 },
      { x: 300, y: 1300 },
    ];
    const f = (t: number) => nurbsPoint(3, knots, S, null, t);
    expect(maxDeviation(f, approximateCurve(f, 0, 1, 0.01, 8))).toBeLessThanOrEqual(0.01);
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 300;
    for (let n = 0; n < 60; n++) {
      const c = [0, 1, 2, 3].map(() => ({ x: rnd(), y: rnd() }));
      const g = (t: number) => nurbsPoint(3, knots, c, null, t);
      expect(maxDeviation(g, approximateCurve(g, 0, 1, 0.01, 4))).toBeLessThanOrEqual(0.01);
    }
  });

  it('pole s otočením a měřítkem: posun pole se otáčí s blokem a nenásobí se měřítkem', () => {
    const ins = ent(
      'INSERT',
      [2, 'L'],
      [10, 0],
      [20, 0],
      [30, 0],
      [41, 2],
      [42, 2],
      [50, 90],
      [70, 2],
      [44, 100],
    );
    const s = read(
      dxf({ blocks: [{ name: 'L', entities: [line(0, 0, 1, 0)] }], entities: [ins] }),
    ).segments;
    expect(near(s[1]!.a, { x: 0, y: 100 })).toBe(true);
    expect(near(s[1]!.b, { x: 0, y: 102 })).toBe(true);
  });

  it('INSERT s normálou −Z a dvojité zrcadlení (oblouk −Z v zrcadleném bloku)', () => {
    const blk = { name: 'B', entities: [arc(10, 0, 5, 0, 90, ...NEG_Z)] };
    // Oblouk v bloku: OCS střed (10, 0) → WCS (−10, 0), běží CW.
    const negIns = ent(
      'INSERT',
      [2, 'B'],
      [10, 100],
      [20, 0],
      [30, 0],
      [210, 0],
      [220, 0],
      [230, -1],
    );
    const [a] = read(dxf({ blocks: [blk], entities: [negIns] })).segments;
    // Vložení −Z: OCS bod (100, 0) → WCS (−100, 0) a znovu zrcadlí X → střed (−100 + 10, 0).
    expect(near(bulgeToArc(a!.a, a!.b, a!.bulge)!.center, { x: -90, y: 0 })).toBe(true);
    expect(a!.bulge).toBeGreaterThan(0);
    const mirror = ent('INSERT', [2, 'B'], [10, 0], [20, 0], [30, 0], [41, -1]);
    const [m] = read(dxf({ blocks: [blk], entities: [mirror] })).segments;
    expect(near(bulgeToArc(m!.a, m!.b, m!.bulge)!.center, { x: 10, y: 0 })).toBe(true);
    expect(m!.bulge).toBeGreaterThan(0);
  });

  it('ELLIPSE v nestejnoměrně škálovaném vložení leží na protažené elipse', () => {
    const el = ent(
      'ELLIPSE',
      [10, 0],
      [20, 0],
      [30, 0],
      [11, 10],
      [21, 0],
      [31, 0],
      [40, 1],
      [41, 0],
      [42, 2 * Math.PI],
    );
    const ins = ent('INSERT', [2, 'E'], [10, 0], [20, 0], [30, 0], [41, 3], [42, 1]);
    const s = read(dxf({ blocks: [{ name: 'E', entities: [el] }], entities: [ins] })).segments;
    expect(s.length).toBeGreaterThan(16);
    for (const x of s)
      expect(Math.abs((x.a.x / 30) ** 2 + (x.a.y / 10) ** 2 - 1)).toBeLessThan(1e-9);
  });

  it('úhly ARC nad 360° a obří hodnoty se normalizují (bez zaseknutí)', () => {
    const [s] = read(dxf({ entities: [arc(0, 0, 10, 0, 450)] })).segments;
    expect(bulgeToArc(s!.a, s!.b, s!.bulge)!.sweep).toBeCloseTo(90, 9);
    const t = performance.now();
    const huge = ent(
      'ELLIPSE',
      [10, 0],
      [20, 0],
      [30, 0],
      [11, 10],
      [21, 0],
      [31, 0],
      [40, 0.5],
      [41, 1e17],
      [42, 0],
    );
    readDxf(dxf({ entities: [arc(0, 0, 10, 0, -1e18), huge] }));
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it('téměř plný oblouk je kruh, ne prázdno', () => {
    const s = read(dxf({ entities: [arc(0, 0, 100, 0, 359.9999999999)] })).segments;
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.bulge === 1)).toBe(true);
  });

  it('neplatná tolerance křivek se nahradí rozumnou (bez zaseknutí)', () => {
    const el = ent(
      'ELLIPSE',
      [10, 0],
      [20, 0],
      [30, 0],
      [11, 100],
      [21, 0],
      [31, 0],
      [40, 0.5],
      [41, 0],
      [42, 2 * Math.PI],
    );
    for (const curveTolerance of [0, -1, Number.NaN]) {
      const t = performance.now();
      const r = readDxf(dxf({ entities: [el] }), { curveTolerance });
      expect(r.segments.length).toBeGreaterThan(10);
      expect(performance.now() - t).toBeLessThan(3000);
    }
  });

  it('neviditelné entity a vypnuté/zamrzlé vrstvy se přeskočí; vrstva 0 v bloku dědí vrstvu vložení', () => {
    const r = readDxf(
      dxf({
        layers: [{ name: 'POMOCNA', flags: 1 }, { name: 'VYPNUTA', color: -7 }, { name: 'DIL' }],
        blocks: [{ name: 'B', entities: [line(0, 0, 1, 0, [8, '0'])] }],
        entities: [
          line(0, 0, 5, 0),
          [...line(0, 0, 9, 0), [60, 1]],
          line(0, 0, 9, 0, [8, 'POMOCNA']),
          line(0, 0, 9, 0, [8, 'VYPNUTA']),
          ent('INSERT', [8, 'VYPNUTA'], [2, 'B'], [10, 0], [20, 0], [30, 0]),
          ent('INSERT', [8, 'DIL'], [2, 'B'], [10, 0], [20, 5], [30, 0]),
        ],
      }),
    );
    expect(r.segments.map((s) => [s.layer, s.b.x])).toEqual([
      ['DIL', 5],
      ['DIL', 1],
    ]);
    expect(r.warnings.join()).toMatch(/Přeskočeny skryté entity .*: 4\./);
  });

  it('entity bez obsluhy parseru (MLINE, REGION) se nahlásí s radou rozložit', () => {
    const r = readDxf(
      dxf({
        entities: [
          ent('MLINE', [10, 0], [20, 0], [30, 0]),
          ent('REGION', [70, 1]),
          line(0, 0, 1, 0),
        ],
      }),
    );
    expect(r.segments).toHaveLength(1);
    expect(r.warnings.join()).toMatch(
      /rozložte je v CADu na čáry a oblouky: MLINE \(1\), REGION \(1\)/,
    );
  });

  it('XREF a obří pole vložení se přeskočí s varováním', () => {
    const r = readDxf(
      dxf({
        blocks: [
          { name: 'X', type: 4, entities: [] },
          { name: 'L', entities: [line(0, 0, 1, 0)] },
        ],
        entities: [
          ent('INSERT', [2, 'X'], [10, 0], [20, 0], [30, 0]),
          ent('INSERT', [2, 'L'], [10, 0], [20, 0], [30, 0], [70, 3000], [71, 3000]),
          line(0, 0, 1, 0),
        ],
      }),
    );
    expect(r.segments).toHaveLength(1);
    expect(r.warnings.join('\n')).toMatch(/externí reference/);
    expect(r.warnings.join('\n')).toMatch(/3000 × 3000 kopií/);
  });

  it('ELLIPSE a kružnice v natočené rovině se přeskočí', () => {
    const el = ent(
      'ELLIPSE',
      [10, 0],
      [20, 0],
      [30, 0],
      [11, 10],
      [21, 0],
      [31, 0],
      [40, 0.5],
      [41, 0],
      [42, 1],
      [210, 1],
      [220, 0],
      [230, 0],
    );
    const tilted = circle(0, 0, 5, [210, 0.015], [220, 0], [230, 0.9999]);
    const r = readDxf(dxf({ entities: [el, tilted, rectPoly(0, 0, 1, 1)] }));
    expect(r.segments).toHaveLength(4);
    expect(r.warnings.join('\n')).toMatch(/ELLIPSE leží v rovině mimo XY/);
    expect(r.warnings.join('\n')).toMatch(/CIRCLE leží v rovině mimo XY/);
  });
});
