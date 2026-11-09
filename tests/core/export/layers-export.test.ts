import DxfParser, { type IEntity, type ILineEntity } from 'dxf-parser';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dxfLayerName, writeSheetDxf } from '../../../src/core/export/dxf-writer.ts';
import { segmentsPath, writeSheetSvg } from '../../../src/core/export/svg.ts';
import { EPS } from '../../../src/core/geometry/eps.ts';
import type { Point } from '../../../src/core/geometry/types.ts';
import { readDxf } from '../../../src/core/import/dxf.ts';
import { partsFromDxf } from '../../../src/core/import/dxf-parts.ts';
import {
  DEFAULT_NESTING_PARAMS,
  type Part,
  type Sheet,
  type SheetLayout,
} from '../../../src/core/model.ts';
import { placedContours } from '../../../src/core/placed.ts';
import { parseProject, serializeProject } from '../../../src/core/project.ts';
import { validateNestingInput } from '../../../src/core/validate.ts';

/** Deska 100 × 50 s kruhovým otvorem a gravírováním (úsečka a oblouk). */
const plate: Part = {
  id: 'deska',
  name: 'Deska',
  width: 100,
  height: 50,
  quantity: 1,
  rotation: 'ortho',
  shape: {
    outer: [
      { x: 0, y: 0, bulge: 0 },
      { x: 100, y: 0, bulge: 0 },
      { x: 100, y: 50, bulge: 0 },
      { x: 0, y: 50, bulge: 0 },
    ],
    holes: [
      [
        { x: 30, y: 25, bulge: -1 },
        { x: 10, y: 25, bulge: -1 },
      ],
    ],
    layers: { outer: 'Obrys dílu', holes: ['Díry'] },
    marks: [
      {
        layer: 'Gravír',
        segments: [
          { a: { x: 50, y: 10 }, b: { x: 90, y: 10 }, bulge: 0 },
          { a: { x: 90, y: 10 }, b: { x: 90, y: 40 }, bulge: 0.4 },
        ],
      },
    ],
  },
};

const rect: Part = {
  id: 'obdelnik',
  name: 'Obdélník',
  width: 40,
  height: 20,
  quantity: 1,
  rotation: 'ortho',
};

const sheet: Sheet = {
  id: 't',
  name: 'Tabule',
  width: 500,
  height: 300,
  stock: null,
  margin: 0,
  forbiddenZones: [],
};

const layout: SheetLayout = {
  sheetId: 't',
  placements: [
    { partId: 'deska', instance: 0, x: 200, y: 20, rotation: 90 },
    { partId: 'obdelnik', instance: 0, x: 300, y: 200, rotation: 0 },
  ],
};

const parse = (text: string) => new DxfParser().parseSync(text)!;
const onLayer = (entities: IEntity[], layer: string) => entities.filter((e) => e.layer === layer);
const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < EPS;

describe('dxfLayerName', () => {
  it('velká písmena bez diakritiky, nepovolené znaky jako _', () => {
    expect(dxfLayerName('Gravír')).toBe('GRAVIR');
    expect(dxfLayerName('Obrys dílu')).toBe('OBRYS_DILU');
    expect(dxfLayerName('a$b-c_d.e')).toBe('A$B-C_D_E');
    expect(dxfLayerName('')).toBe('0');
    expect(dxfLayerName('x'.repeat(40))).toHaveLength(31);
  });

  it('property: výsledek je vždy platný název vrstvy R12', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60, unit: 'binary' }), (name) => {
        expect(dxfLayerName(name)).toMatch(/^[A-Z0-9$_-]{1,31}$/);
      }),
    );
  });
});

describe('export DXF s hladinami výkresu', () => {
  const text = writeSheetDxf(sheet, layout, [plate, rect]);
  const dxf = parse(text);

  it('zadání testu je platné', () => {
    expect(
      validateNestingInput({
        parts: [plate, rect],
        sheets: [sheet],
        params: DEFAULT_NESTING_PARAMS,
      }),
    ).toEqual([]);
  });

  it('obrys, otvor a přidaná geometrie na původních hladinách, obdélník na DILY', () => {
    const layers = dxf.tables.layer.layers;
    expect(layers['OBRYS_DILU']?.colorIndex).toBe(7);
    expect(layers['DIRY']?.colorIndex).toBe(1);
    expect(layers['GRAVIR']?.colorIndex).toBe(2);
    expect(onLayer(dxf.entities, 'OBRYS_DILU')).toHaveLength(1);
    expect(onLayer(dxf.entities, 'DIRY').map((e) => e.type)).toEqual(['CIRCLE']);
    expect(onLayer(dxf.entities, 'GRAVIR').map((e) => e.type)).toEqual(['LINE', 'ARC']);
    expect(onLayer(dxf.entities, 'DILY')).toHaveLength(1);
    expect(onLayer(dxf.entities, 'OTVORY')).toEqual([]);
  });

  it('přidaná geometrie je natočená a posunutá s dílem', () => {
    const marks = placedContours(plate, layout.placements[0]!).marks!;
    const seg = marks[0]!.segments[0]!;
    const line = onLayer(dxf.entities, 'GRAVIR')[0] as ILineEntity;
    expect(near(line.vertices[0]!, seg.a)).toBe(true);
    expect(near(line.vertices[1]!, seg.b)).toBe(true);
    // Natočení o 90°: (50, 10) → (−10, 50) + (200, 20).
    expect(near(seg.a, { x: 190, y: 70 })).toBe(true);
  });

  it('zpětný import se stejnými rolemi dá stejné hladiny a přidanou geometrii', () => {
    const r = partsFromDxf('tabule.dxf', text, {
      mode: 'multi',
      layerRoles: new Map([
        ['TABULE', 'ignore'],
        ['POPISKY', 'ignore'],
        ['GRAVIR', 'attach'],
        ['DIRY', 'inner'],
      ]),
    });
    expect(r.errors).toEqual([]);
    const back = r.parts.find((p) => p.shape?.layers?.outer === 'OBRYS_DILU')!;
    expect(back.shape!.layers!.holes).toEqual(['DIRY']);
    expect(back.shape!.marks!.map((m) => [m.layer, m.segments.length])).toEqual([['GRAVIR', 2]]);
    expect(Math.abs(back.width - 50)).toBeLessThan(EPS);
  });

  it('hladiny, které po převodu splynou nebo se jmenují jako vrstvy exportu, dostanou příponu', () => {
    const clash: Part = {
      ...plate,
      shape: {
        ...plate.shape!,
        layers: { outer: 'TABULE', holes: ['DIRA'] },
        marks: [
          { layer: 'Díra', segments: plate.shape!.marks![0]!.segments },
          { layer: 'Popisky', segments: plate.shape!.marks![0]!.segments },
        ],
      },
    };
    const d = parse(writeSheetDxf(sheet, layout, [clash, rect]));
    expect(onLayer(d.entities, 'TABULE')).toHaveLength(1);
    expect(onLayer(d.entities, 'TABULE_2')).toHaveLength(1);
    expect(onLayer(d.entities, 'DIRA')).toHaveLength(1);
    expect(onLayer(d.entities, 'DIRA_2')).toHaveLength(2);
    expect(onLayer(d.entities, 'POPISKY_2')).toHaveLength(2);
  });
});

describe('názvy vrstev v exportu – případy z revize', () => {
  const withLayers = (id: string, outer: string, hole: string): Part => ({
    ...plate,
    id,
    shape: { ...plate.shape!, layers: { outer, holes: [hole] }, marks: [] },
  });

  it('táž hladina má stejnou vrstvu ve všech souborech exportu', () => {
    const a = withLayers('a', 'OBRYS', 'Díra');
    const b = withLayers('b', 'OBRYS', 'DIRA');
    const parts = [a, b];
    const on1: SheetLayout = {
      sheetId: 't',
      placements: [
        { partId: 'a', instance: 0, x: 0, y: 0, rotation: 0 },
        { partId: 'b', instance: 0, x: 200, y: 0, rotation: 0 },
      ],
    };
    const on2: SheetLayout = {
      sheetId: 't',
      placements: [{ partId: 'b', instance: 0, x: 0, y: 0, rotation: 0 }],
    };
    const holes = (l: SheetLayout) =>
      parse(writeSheetDxf(sheet, l, parts))
        .entities.filter((e) => e.type === 'CIRCLE')
        .map((e) => e.layer);
    expect(holes(on1)).toEqual(['DIRA', 'DIRA_2']);
    expect(holes(on2)).toEqual(['DIRA_2']);
    // Tabulka vrstev obsahuje jen vrstvy použité na tabuli.
    const layers = Object.keys(parse(writeSheetDxf(sheet, on2, parts)).tables.layer.layers);
    expect(layers).toContain('DIRA_2');
    expect(layers).not.toContain('DIRA');
  });

  it('hladiny 0, DILY a OTVORY se převedou podle role: obrys DILY, otvor OTVORY, přidané 0', () => {
    const one = (id: string): SheetLayout => ({
      sheetId: 't',
      placements: [{ partId: id, instance: 0, x: 0, y: 0, rotation: 0 }],
    });
    const types = (part: Part) =>
      parse(writeSheetDxf(sheet, one(part.id), [part]))
        .entities.map((e) => `${e.layer}:${e.type}`)
        .filter((t) => !t.startsWith('TABULE') && !t.startsWith('POPISKY'));
    // Prostý výkres: vše na hladině 0 (i otvory podle vnoření).
    const plain: Part = {
      ...plate,
      id: 'p',
      shape: {
        ...plate.shape!,
        layers: { outer: '0', holes: ['0'] },
        marks: [{ layer: '0', segments: plate.shape!.marks![0]!.segments }],
      },
    };
    expect(types(plain)).toEqual(['DILY:POLYLINE', 'OTVORY:CIRCLE', '0:LINE', '0:ARC']);
    // Hladina „díly" s obrysy i otvory (revize) a prohozené DILY/OTVORY.
    expect(types(withLayers('a', 'Dily', 'dily'))).toEqual(['DILY:POLYLINE', 'OTVORY:CIRCLE']);
    expect(types(withLayers('b', 'OTVORY', 'DILY'))).toEqual(['DILY:POLYLINE', 'OTVORY:CIRCLE']);
    const tables = parse(writeSheetDxf(sheet, one('p'), [plain])).tables.layer.layers;
    expect(Object.keys(tables).filter((n) => /_\d$/.test(n))).toEqual([]);
  });
});

describe('SVG a umístění s přidanou geometrií', () => {
  it('segmentsPath: navazující segmenty v jednom tahu, oblouk jako A', () => {
    const d = segmentsPath(plate.shape!.marks![0]!.segments);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d).toMatch(/^M50 10L90 10A/);
    expect(segmentsPath([...plate.shape!.marks![0]!.segments].reverse()).match(/M/g)).toHaveLength(
      2,
    );
    expect(segmentsPath([])).toBe('');
  });

  it('SVG tabule obsahuje přidanou geometrii bez výplně', () => {
    const svg = writeSheetSvg(sheet, layout, [plate, rect]);
    expect(svg).toMatch(/<path d="M[^"]+" fill="none" stroke="#0550ae"\/>/);
  });

  it('placedContours zachová hladiny a díl bez přidané geometrie ji nemá', () => {
    const c = placedContours(plate, layout.placements[0]!);
    expect(c.layers).toEqual(plate.shape!.layers);
    expect(placedContours(rect, layout.placements[1]!).marks).toBeUndefined();
  });
});

describe('projekt a validace s hladinami', () => {
  const project = {
    parts: [plate, rect],
    sheets: [sheet],
    params: DEFAULT_NESTING_PARAMS,
  };

  it('zápis a čtení projektu zachová hladiny a přidanou geometrii', () => {
    const r = parseProject(serializeProject(project, new Date('2026-11-09T10:00:00Z')));
    expect(r.ok && r.project.parts).toEqual([plate, rect]);
  });

  it('neplatná přidaná geometrie nebo hladiny v projektu jsou chyba', () => {
    const bad = (shape: unknown) =>
      parseProject(
        JSON.stringify({
          ...JSON.parse(serializeProject(project, new Date())),
          parts: [{ ...plate, shape }],
        }),
      );
    expect(bad({ ...plate.shape, marks: [{ layer: 'X', segments: [{ a: { x: 0 } }] }] }).ok).toBe(
      false,
    );
    expect(bad({ ...plate.shape, marks: 'X' }).ok).toBe(false);
    expect(bad({ ...plate.shape, layers: { outer: 1, holes: [] } }).ok).toBe(false);
    expect(bad({ ...plate.shape, layers: undefined, marks: undefined }).ok).toBe(true);
  });

  it('validace: počet hladin otvorů musí odpovídat otvorům, přidaná geometrie konečná', () => {
    const check = (shape: Part['shape']) =>
      validateNestingInput({
        parts: [{ ...plate, shape: shape! }],
        sheets: [sheet],
        params: DEFAULT_NESTING_PARAMS,
      }).map((i) => i.message);
    expect(check({ ...plate.shape!, layers: { outer: 'A', holes: [] } })).toEqual([
      'Díl „Deska": počet hladin otvorů neodpovídá počtu otvorů.',
    ]);
    expect(
      check({
        ...plate.shape!,
        marks: [{ layer: 'A', segments: [{ a: { x: NaN, y: 0 }, b: { x: 1, y: 1 }, bulge: 0 }] }],
      }),
    ).toEqual(['Díl „Deska": geometrie přidaná k dílu má neplatné souřadnice.']);
  });
});

describe('textové poznámky v exportu', () => {
  const noted: Part = {
    ...plate,
    id: 'n',
    shape: {
      ...plate.shape!,
      notes: [
        {
          layer: 'Poznámky',
          text: 'S235 ⌀8 100%',
          at: { x: 50, y: 30 },
          height: 4,
          rotation: 0,
          widthFactor: 0.8,
          halign: 1,
          valign: 2,
          backwards: false,
        },
        {
          layer: '0',
          text: 'VLEVO',
          at: { x: 5, y: 5 },
          height: 3,
          rotation: 10,
          widthFactor: 1,
          halign: 0,
          valign: 0,
          backwards: true,
        },
      ],
    },
  };
  const placement = { partId: 'n', instance: 0, x: 200, y: 20, rotation: 90 };
  const one: SheetLayout = { sheetId: 't', placements: [placement] };

  it('zadání je platné; neplatná poznámka je chyba validace', () => {
    expect(
      validateNestingInput({ parts: [noted], sheets: [sheet], params: DEFAULT_NESTING_PARAMS }),
    ).toEqual([]);
    const bad: Part = {
      ...noted,
      shape: { ...noted.shape!, notes: [{ ...noted.shape!.notes![0]!, height: 0 }] },
    };
    expect(
      validateNestingInput({ parts: [bad], sheets: [sheet], params: DEFAULT_NESTING_PARAMS }).map(
        (i) => i.message,
      ),
    ).toEqual(['Díl „Deska": textová poznámka má neplatnou polohu, výšku nebo šířkový faktor.']);
  });

  it('DXF: TEXT na hladině poznámky, natočený s dílem; zpětný import dá stejné řádky', () => {
    const text = writeSheetDxf(sheet, one, [noted]);
    const back = readDxf(text).texts.filter((t) => t.layer !== 'POPISKY');
    const placed = placedContours(noted, placement).notes!;
    expect(back.map((t) => t.layer)).toEqual(['POZNAMKY', '0']);
    back.forEach((t, i) => {
      const want = placed[i]!;
      const got = t.lines[0]!;
      expect(got.text).toBe(want.text);
      expect(near(got.at, want.at)).toBe(true);
      expect(Math.abs(got.height - want.height)).toBeLessThan(EPS);
      expect(Math.abs(got.rotation - want.rotation)).toBeLessThan(1e-6);
      expect(Math.abs(got.widthFactor - want.widthFactor)).toBeLessThan(1e-9);
      expect([got.halign, got.valign, got.backwards]).toEqual([
        want.halign,
        want.valign,
        want.backwards,
      ]);
    });
    expect(placed[0]!.rotation).toBe(90);
    const layers = parse(text).tables.layer.layers;
    expect(layers['POZNAMKY']?.colorIndex).toBe(2);
  });

  it('SVG: text poznámky s natočením, zarovnáním a šířkovým faktorem', () => {
    const svg = writeSheetSvg(sheet, one, [noted]);
    expect(svg).toMatch(
      /<text transform="translate\(\S+ \S+\) rotate\(-90\) scale\(0\.8 1\)" font-size="5\.714\d*" text-anchor="middle" dominant-baseline="central">S235 ⌀8 100%<\/text>/,
    );
    expect(svg).toMatch(
      /scale\(-1 1\)[^>]*text-anchor="start" dominant-baseline="alphabetic">VLEVO/,
    );
  });

  it('projekt JSON zachová poznámky; neplatná poznámka je chyba', () => {
    const project = { parts: [noted], sheets: [sheet], params: DEFAULT_NESTING_PARAMS };
    const r = parseProject(serializeProject(project, new Date('2026-11-09T10:00:00Z')));
    expect(r.ok && r.project.parts).toEqual([noted]);
    const broken = JSON.parse(serializeProject(project, new Date()));
    broken.parts[0].shape.notes[0].halign = 7;
    expect(parseProject(JSON.stringify(broken)).ok).toBe(false);
  });
});
