import DxfParser, { type IArcEntity, type ICircleEntity, type IEntity } from 'dxf-parser';
import fc from 'fast-check';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  DXF_LAYERS,
  dxfNumber,
  dxfText,
  DXF_MIN_ARC_SAGITTA,
  writeResultDxf,
  writeSheetDxf,
} from '../../../src/core/export/dxf-writer.ts';
import { sheetFileName, zipFiles } from '../../../src/core/export/files.ts';
import { bulgeToArc } from '../../../src/core/geometry/contour.ts';
import { EPS } from '../../../src/core/geometry/eps.ts';
import type { Contour, Point } from '../../../src/core/geometry/types.ts';
import {
  DEFAULT_NESTING_PARAMS,
  type NestingInput,
  type Part,
  type Placement,
  type Sheet,
  type SheetLayout,
} from '../../../src/core/model.ts';
import { nest } from '../../../src/core/nesting/nest.ts';
import { contourToRing } from '../../../src/core/geometry/contour.ts';
import { pointInRing } from '../../../src/core/geometry/polygon.ts';
import { labelSize, placedContours, placePart } from '../../../src/core/placed.ts';
import { validateNestingInput } from '../../../src/core/validate.ts';

/** Tvar „D": obdélník s půlkruhem vpravo, kruhový otvor a otvor s obloukem. */
const shaped: Part = {
  id: 'd',
  name: 'Příruba Ž',
  width: 110,
  height: 60,
  quantity: 3,
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
      [
        { x: 60, y: 20, bulge: 0 },
        { x: 60, y: 40, bulge: -0.5 },
        { x: 70, y: 40, bulge: 0 },
        { x: 70, y: 20, bulge: 0 },
      ],
    ],
  },
};
const rect: Part = {
  id: 'r',
  name: 'Bok',
  width: 200,
  height: 100,
  quantity: 1,
  rotation: 'ortho',
};

const sheet: Sheet = {
  id: 's',
  name: 'Plech',
  width: 1000,
  height: 500,
  stock: null,
  margin: 0,
  forbiddenZones: [
    {
      id: 'z',
      polygon: [
        { x: 900, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 50 },
      ],
    },
  ],
};

const layout: SheetLayout = {
  sheetId: 's',
  placements: [
    { partId: 'd', instance: 0, x: 10, y: 10, rotation: 0 },
    { partId: 'd', instance: 1, x: 300, y: 20, rotation: 90 },
    { partId: 'd', instance: 2, x: 500, y: 300, rotation: 37.5 },
    { partId: 'r', instance: 0, x: 700, y: 200, rotation: 270 },
  ],
};

const parse = (text: string) => new DxfParser().parseSync(text)!;
const onLayer = (entities: IEntity[], layer: string) => entities.filter((e) => e.layer === layer);

interface ParsedVertex {
  x: number;
  y: number;
  bulge?: number;
}

function expectNear(a: Point, b: Point) {
  expect(Math.abs(a.x - b.x)).toBeLessThan(EPS);
  expect(Math.abs(a.y - b.y)).toBeLessThan(EPS);
}

/** Polyline z parseru odpovídá obrysu (vrcholy i bulge). */
function expectPolyline(e: IEntity, contour: Contour) {
  expect(e.type).toBe('POLYLINE');
  const p = e as unknown as { shape: boolean; vertices: ParsedVertex[] };
  expect(p.shape).toBe(true);
  expect(p.vertices).toHaveLength(contour.length);
  p.vertices.forEach((v, i) => {
    expectNear(v, contour[i]!);
    expect(Math.abs((v.bulge ?? 0) - contour[i]!.bulge)).toBeLessThan(1e-6);
  });
}

function expectCircle(e: IEntity, contour: Contour) {
  expect(e.type).toBe('CIRCLE');
  const c = e as ICircleEntity;
  const a = contour[0]!;
  const b = contour[1]!;
  expectNear(c.center, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  expect(Math.abs(c.radius - Math.hypot(b.x - a.x, b.y - a.y) / 2)).toBeLessThan(EPS);
}

const isCircle = (c: Contour) => c.length === 2 && Math.abs(Math.abs(c[0]!.bulge) - 1) < 1e-9;

function expectContour(e: IEntity, contour: Contour) {
  if (isCircle(contour)) expectCircle(e, contour);
  else expectPolyline(e, contour);
}

const arcEnd = (a: IArcEntity, angle: number): Point => ({
  x: a.center.x + a.radius * Math.cos(angle),
  y: a.center.y + a.radius * Math.sin(angle),
});

/** LINE/ARC entity pokrývají segmenty obrysu ve stejném pořadí a směru. */
function expectSegments(entities: IEntity[], contour: Contour) {
  const segs = contour.map((v, i) => ({ from: v, to: contour[(i + 1) % contour.length]! }));
  expect(entities).toHaveLength(segs.length);
  entities.forEach((e, i) => {
    const { from, to } = segs[i]!;
    const sagitta = (Math.abs(from.bulge) * Math.hypot(to.x - from.x, to.y - from.y)) / 2;
    const arc = sagitta < DXF_MIN_ARC_SAGITTA ? null : bulgeToArc(from, to, from.bulge);
    if (!arc) {
      expect(e.type).toBe('LINE');
      const l = e as unknown as { vertices: Point[] };
      expectNear(l.vertices[0]!, from);
      expectNear(l.vertices[1]!, to);
      return;
    }
    expect(e.type).toBe('ARC');
    const a = e as IArcEntity;
    expectNear(a.center, arc.center);
    expect(Math.abs(a.radius - arc.radius)).toBeLessThan(EPS);
    // ARC je vždy CCW: u CW segmentu je počátek oblouku v koncovém bodě.
    const [start, end] = arc.sweep > 0 ? [from, to] : [to, from];
    expectNear(arcEnd(a, a.startAngle), start);
    expectNear(arcEnd(a, a.endAngle), end);
  });
}

function partOf(p: Placement) {
  return p.partId === 'd' ? shaped : rect;
}

describe('dxfNumber', () => {
  it('tečka, max. 6 desetinných míst, bez exponentu a záporné nuly', () => {
    expect(dxfNumber(0)).toBe('0');
    expect(dxfNumber(-0)).toBe('0');
    expect(dxfNumber(-1e-9)).toBe('0');
    expect(dxfNumber(1e-7)).toBe('0');
    expect(dxfNumber(12.5)).toBe('12.5');
    expect(dxfNumber(123.45678949)).toBe('123.456789');
    expect(dxfNumber(-3)).toBe('-3');
    expect(dxfNumber(1e21 / 1e6)).toBe('1000000000000000');
    expect(() => dxfNumber(NaN)).toThrow(RangeError);
  });
});

describe('dxfText', () => {
  it('ASCII beze změny, diakritika jako \\U+XXXX, řídicí znaky jako mezera', () => {
    expect(dxfText('Bok 1')).toBe('Bok 1');
    expect(dxfText('Ž-č')).toBe('\\U+017D-\\U+010D');
    expect(dxfText('a\nb\tc')).toBe('a b c');
    // %% zahajuje řídicí kód TEXT, \U+ znak Unicode – zapisují se doslova.
    expect(dxfText('Díl %%u5')).toBe('D\\U+00EDl %%%%%%u5');
    expect(dxfText('a\\b')).toBe('a\\U+005Cb');
  });
});

describe('writeSheetDxf', () => {
  const text = writeSheetDxf(sheet, layout, [shaped, rect]);

  it('zadání testu je platné (tvar dílu projde validací)', () => {
    const input: NestingInput = {
      parts: [shaped, rect],
      sheets: [sheet],
      params: DEFAULT_NESTING_PARAMS,
    };
    expect(validateNestingInput(input)).toEqual([]);
  });

  it('R12 ASCII: hlavička, vrstvy s barvami, CRLF, bez exponentů, končí EOF', () => {
    expect(text).toMatch(/\r\n/);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/\n|\r/);
    expect(text.endsWith('0\r\nEOF\r\n')).toBe(true);
    const lines = text.split('\r\n');
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = Number(lines[i]);
      if ((code >= 10 && code <= 59) || code === 42)
        expect(lines[i + 1]).toMatch(/^-?\d+(\.\d{1,6})?$/);
    }
    expect(text).not.toMatch(/LWPOLYLINE/);

    const dxf = parse(text);
    expect(dxf.header.$ACADVER).toBe('AC1009');
    expect(dxf.header.$INSUNITS).toBe(4);
    const layers = dxf.tables.layer.layers;
    for (const [name, color] of Object.entries(DXF_LAYERS)) {
      expect(layers[name]?.colorIndex).toBe(color);
    }
  });

  it('zapiš → přečti: obrys tabule a zóny na TABULE', () => {
    const tabule = onLayer(parse(text).entities, 'TABULE');
    expect(tabule).toHaveLength(2);
    expectPolyline(tabule[0]!, [
      { x: 0, y: 0, bulge: 0 },
      { x: 1000, y: 0, bulge: 0 },
      { x: 1000, y: 500, bulge: 0 },
      { x: 0, y: 500, bulge: 0 },
    ]);
    expectPolyline(
      tabule[1]!,
      sheet.forbiddenZones[0]!.polygon.map((p) => ({ ...p, bulge: 0 })),
    );
  });

  it('zapiš → přečti: díly a otvory se stejnými souřadnicemi a oblouky (EPS)', () => {
    const entities = parse(text).entities;
    const dily = onLayer(entities, 'DILY');
    const otvory = onLayer(entities, 'OTVORY');
    expect(dily).toHaveLength(layout.placements.length);
    expect(otvory).toHaveLength(3 * 2);
    let hole = 0;
    layout.placements.forEach((pl, i) => {
      const c = placedContours(partOf(pl), pl);
      expectContour(dily[i]!, c.outer);
      for (const h of c.holes) expectContour(otvory[hole++]!, h);
    });
  });

  it('popisky: TEXT s názvem v materiálu dílu (mimo otvory), výška podle labelSize', () => {
    const labels = onLayer(parse(text).entities, 'POPISKY') as unknown as {
      text: string;
      textHeight: number;
      endPoint: Point;
      halign: number;
      valign: number;
    }[];
    expect(labels).toHaveLength(4);
    expect(labels[0]!.text).toBe(dxfText('Příruba Ž'));
    expect(labels[0]).toMatchObject({ halign: 1, valign: 2 });
    const placed0 = placePart(shaped, layout.placements[0]!);
    expectNear(labels[0]!.endPoint, placed0.labelAt);
    expect(labels[0]!.textHeight).toBeCloseTo(0.7 * labelSize(placed0), 5);
    // Bod popisku leží v materiálu: uvnitř obrysu a mimo oba otvory.
    const c = placedContours(shaped, layout.placements[0]!);
    expect(pointInRing(placed0.labelAt, contourToRing(c.outer, 0.01))).toBe(true);
    for (const h of c.holes) {
      expect(pointInRing(placed0.labelAt, contourToRing(h, 0.01))).toBe(false);
    }
    expect(labels[3]!.text).toBe('Bok');

    const bez = parse(writeSheetDxf(sheet, layout, [shaped, rect], { labels: false }));
    expect(onLayer(bez.entities, 'POPISKY')).toEqual([]);
  });

  it('režim lines-arcs: oblouky jako ARC (CCW), úsečky jako LINE, kruh jako CIRCLE', () => {
    const entities = parse(
      writeSheetDxf(sheet, layout, [shaped, rect], { segments: 'lines-arcs' }),
    ).entities;
    const dily = onLayer(entities, 'DILY');
    const otvory = onLayer(entities, 'OTVORY');
    let d = 0;
    let o = 0;
    for (const pl of layout.placements) {
      const c = placedContours(partOf(pl), pl);
      expectSegments(dily.slice(d, d + c.outer.length), c.outer);
      d += c.outer.length;
      for (const h of c.holes) {
        if (isCircle(h)) {
          expectCircle(otvory[o++]!, h);
        } else {
          expectSegments(otvory.slice(o, o + h.length), h);
          o += h.length;
        }
      }
    }
    expect(d).toBe(dily.length);
    expect(o).toBe(otvory.length);
    expect(dily.some((e) => e.type === 'ARC')).toBe(true);
  });

  it('property: libovolné umístění a natočení → souřadnice po přečtení v EPS', () => {
    const arbPlacement = fc.record({
      x: fc.double({ min: -5000, max: 5000, noNaN: true }),
      y: fc.double({ min: -5000, max: 5000, noNaN: true }),
      rotation: fc.double({ min: 0, max: 359.999, noNaN: true }),
    });
    const modes = ['polyline', 'lines-arcs'] as const;
    fc.assert(
      fc.property(arbPlacement, fc.constantFrom(...modes), (p, segments) => {
        const pl: Placement = { partId: 'd', instance: 0, ...p };
        const l: SheetLayout = { sheetId: 's', placements: [pl] };
        const entities = parse(writeSheetDxf(sheet, l, [shaped], { segments })).entities;
        const c = placedContours(shaped, pl);
        const dily = onLayer(entities, 'DILY');
        const otvory = onLayer(entities, 'OTVORY');
        if (segments === 'polyline') {
          expectPolyline(dily[0]!, c.outer);
          expectCircle(otvory[0]!, c.holes[0]!);
          expectPolyline(otvory[1]!, c.holes[1]!);
        } else {
          expectSegments(dily, c.outer);
          expectCircle(otvory[0]!, c.holes[0]!);
          expectSegments(otvory.slice(1), c.holes[1]!);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('neznámý díl v rozložení je chyba', () => {
    expect(() => writeSheetDxf(sheet, layout, [shaped])).toThrow(RangeError);
  });
});

describe('writeSheetDxf – okrajové případy z revize', () => {
  const one = (
    part: Part,
    opts: Parameters<typeof writeSheetDxf>[3] = {},
    pl?: Partial<Placement>,
  ) =>
    writeSheetDxf(
      sheet,
      {
        sheetId: 's',
        placements: [{ partId: part.id, instance: 0, x: 0, y: 0, rotation: 0, ...pl }],
      },
      [part],
      opts,
    );

  /** Čočka z oblouku 272° a 87° + otvor s oblouky 2,5 / −1,8 (|sweep| > 180°). */
  const lens: Part = {
    id: 'l',
    name: 'Čočka',
    width: 100,
    height: 100,
    quantity: 1,
    rotation: 'free',
    shape: {
      outer: [
        { x: 0, y: 0, bulge: 2.5 },
        { x: 100, y: 0, bulge: 0.4 },
      ],
      holes: [
        [
          { x: 40, y: 10, bulge: -1.8 },
          { x: 60, y: 10, bulge: 0 },
          { x: 50, y: 30, bulge: 0 },
        ],
      ],
    },
  };

  it('oblouky nad 180° v obou režimech; dva vrcholy s různým bulge nejsou CIRCLE', () => {
    for (const rotation of [0, 123.4, 270]) {
      const c = placedContours(lens, { partId: 'l', instance: 0, x: 500, y: 250, rotation });
      const poly = parse(one(lens, {}, { x: 500, y: 250, rotation })).entities;
      expectPolyline(onLayer(poly, 'DILY')[0]!, c.outer);
      expectPolyline(onLayer(poly, 'OTVORY')[0]!, c.holes[0]!);
      const la = parse(
        one(lens, { segments: 'lines-arcs' }, { x: 500, y: 250, rotation }),
      ).entities;
      expectSegments(onLayer(la, 'DILY'), c.outer);
      expectSegments(onLayer(la, 'OTVORY'), c.holes[0]!);
    }
    for (const bulges of [
      [1, -1],
      [1, 0.5],
    ]) {
      const part: Part = {
        ...lens,
        shape: {
          outer: [
            { x: 0, y: 50, bulge: bulges[0]! },
            { x: 100, y: 50, bulge: bulges[1]! },
          ],
          holes: [],
        },
      };
      expect(onLayer(parse(one(part)).entities, 'DILY')[0]!.type).toBe('POLYLINE');
    }
  });

  it('úhly ARC jsou zapsané v [0, 360)', () => {
    const text = one(lens, { segments: 'lines-arcs' }, { rotation: 200 });
    const lines = text.split('\r\n');
    let count = 0;
    for (let i = 0; i + 1 < lines.length; i += 2) {
      if (lines[i] === '50' || lines[i] === '51') {
        const a = Number(lines[i + 1]);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(360);
        count++;
      }
    }
    expect(count).toBeGreaterThan(0);
  });

  it('téměř rovné oblouky (velký poloměr): koncové body navazují v EPS', () => {
    for (const bulge of [1e-4, 1e-5, 1e-6, 3e-6]) {
      const part: Part = {
        ...lens,
        width: 1000,
        height: 100,
        shape: {
          outer: [
            { x: 0, y: 0, bulge },
            { x: 1000, y: 0, bulge: 0 },
            { x: 1000, y: 100, bulge: 0 },
            { x: 0, y: 100, bulge: 0 },
          ],
          holes: [],
        },
      };
      for (const rotation of [0, 33.3]) {
        const pl = { x: 1234.5, y: 678.9, rotation };
        const c = placedContours(part, { partId: 'l', instance: 0, ...pl });
        const la = parse(one(part, { segments: 'lines-arcs' }, pl)).entities;
        expectSegments(onLayer(la, 'DILY'), c.outer);
        expectPolyline(onLayer(parse(one(part, {}, pl)).entities, 'DILY')[0]!, c.outer);
      }
    }
  });

  it('$EXTMIN/$EXTMAX zahrnují tabuli, díly i zóny přes okraj', () => {
    const s2: Sheet = {
      ...sheet,
      forbiddenZones: [
        {
          id: 'z',
          polygon: [
            { x: 950, y: 480 },
            { x: 1030, y: 480 },
            { x: 1030, y: 560 },
          ],
        },
      ],
    };
    const l: SheetLayout = {
      sheetId: 's',
      placements: [{ partId: 'r', instance: 0, x: -20, y: -5, rotation: 0 }],
    };
    const header = parse(writeSheetDxf(s2, l, [rect])).header as Record<string, Point>;
    expectNear(header.$EXTMIN!, { x: -20, y: -5 });
    expectNear(header.$EXTMAX!, { x: 1030, y: 560 });
  });

  it('tabulky obsahují vrstvu 0 a styl STANDARD', () => {
    const dxf = parse(writeSheetDxf(sheet, layout, [shaped, rect]));
    expect(dxf.tables.layer.layers['0']).toBeDefined();
    expect(writeSheetDxf(sheet, layout, [shaped, rect])).toMatch(/\r\nSTYLE\r\n2\r\nSTANDARD\r\n/);
  });

  it('dlouhý text se zkrátí na 255 znaků bez rozdělení \\U+ sekvence', () => {
    const t = dxfText('ř'.repeat(100));
    expect(t.length).toBeLessThanOrEqual(255);
    expect(t).toMatch(/^(\\U\+0159)+$/);
    expect(dxfText('a'.repeat(300))).toHaveLength(255);
  });
});

describe('soubory a ZIP', () => {
  it('název souboru: bez diakritiky, číslo tabule doplněné nulami', () => {
    expect(sheetFileName('Kuchyň – Novák', 0, 3, 'dxf')).toBe('Kuchyn-Novak-tabule-01.dxf');
    expect(sheetFileName('plán', 9, 120, 'svg')).toBe('plan-tabule-010.svg');
    expect(sheetFileName('  ', 0, 1, 'dxf')).toBe('plan-tabule-01.dxf');
  });

  it('výsledek výpočtu → jeden DXF na tabuli → ZIP se stejným obsahem', () => {
    const input: NestingInput = {
      parts: [{ ...rect, quantity: 30 }],
      sheets: [{ ...sheet, forbiddenZones: [] }],
      params: DEFAULT_NESTING_PARAMS,
    };
    const outcome = nest(input);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const files = writeResultDxf(input, outcome.result, 'Zakázka 7');
    expect(files.length).toBe(outcome.result.layouts.length);
    expect(files.length).toBeGreaterThan(1);
    files.forEach((f, i) => {
      expect(f.name).toBe(sheetFileName('Zakázka 7', i, files.length, 'dxf'));
      const dily = onLayer(parse(f.content).entities, 'DILY');
      expect(dily).toHaveLength(outcome.result.layouts[i]!.placements.length);
    });

    const unzipped = unzipSync(zipFiles(files, new Date('2026-01-01T00:00:00Z')));
    expect(Object.keys(unzipped)).toEqual(files.map((f) => f.name));
    files.forEach((f) => expect(strFromU8(unzipped[f.name]!)).toBe(f.content));
  });
});

describe('zbytek v exportu DXF (revize 7.1)', () => {
  it('writeResultDxf zapíše obrys zbytku na vrstvu ZBYTEK', () => {
    const input: NestingInput = {
      parts: [{ ...rect, quantity: 1 }],
      sheets: [{ ...sheet, forbiddenZones: [] }],
      params: DEFAULT_NESTING_PARAMS,
    };
    const outcome = nest(input);
    if (!outcome.ok) throw new Error('výpočet selhal');
    const remnant = outcome.result.metrics.sheets[0]!.remnant!;
    const [file] = writeResultDxf(input, outcome.result, 'z');
    const z = onLayer(parse(file!.content).entities, 'ZBYTEK');
    expect(z).toHaveLength(1);
    expectPolyline(z[0]!, [
      { x: remnant.x, y: remnant.y, bulge: 0 },
      { x: remnant.x + remnant.width, y: remnant.y, bulge: 0 },
      { x: remnant.x + remnant.width, y: remnant.y + remnant.height, bulge: 0 },
      { x: remnant.x, y: remnant.y + remnant.height, bulge: 0 },
    ]);
  });
});
