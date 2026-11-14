import { DxfReader } from '@node-projects/acad-ts';
import DxfParser from 'dxf-parser';
import { describe, expect, it } from 'vitest';
import {
  modernLayerNames,
  writeResultDxfModern,
  writeSheetDxfModern,
  type ModernDxfVersion,
} from '../../../src/core/export/dxf-acad.ts';
import { modernLayerName, writeSheetDxf } from '../../../src/core/export/dxf-writer.ts';
import { EPS } from '../../../src/core/geometry/eps.ts';
import type { Point } from '../../../src/core/geometry/types.ts';
import { decodeDxfUnicode, readDxf } from '../../../src/core/import/dxf.ts';
import { partsFromDxf } from '../../../src/core/import/dxf-parts.ts';
import {
  DEFAULT_NESTING_PARAMS,
  type NestingInput,
  type Part,
  type Sheet,
  type SheetLayout,
} from '../../../src/core/model.ts';
import { nest } from '../../../src/core/nesting/nest.ts';
import { placedContours } from '../../../src/core/placed.ts';

/** Deska 100 × 50 s obloukem, kruhovým otvorem, gravírováním a poznámkou. */
const plate: Part = {
  id: 'deska',
  name: 'Příruba Ž',
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
    layers: { outer: 'Obrys dílu', holes: ['Díry M6'] },
    marks: [
      {
        layer: 'Gravír',
        segments: [
          { a: { x: 50, y: 10 }, b: { x: 90, y: 10 }, bulge: 0 },
          { a: { x: 90, y: 10 }, b: { x: 90, y: 40 }, bulge: 0.4 },
        ],
      },
    ],
    notes: [
      {
        layer: 'Poznámky',
        text: 'S235 ⌀8 100%',
        at: { x: 50, y: 30 },
        height: 4,
        rotation: 15,
        widthFactor: 0.8,
        halign: 1,
        valign: 2,
        backwards: false,
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
  forbiddenZones: [
    {
      id: 'z',
      polygon: [
        { x: 450, y: 0 },
        { x: 500, y: 0 },
        { x: 500, y: 40 },
      ],
    },
  ],
};
const layout: SheetLayout = {
  sheetId: 't',
  placements: [
    { partId: 'deska', instance: 0, x: 200, y: 20, rotation: 90 },
    { partId: 'obdelnik', instance: 0, x: 300, y: 200, rotation: 0 },
  ],
};
const parts = [plate, rect];
const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < EPS;
const VERSIONS: readonly [ModernDxfVersion, string][] = [
  ['2000', 'AC1015'],
  ['2018', 'AC1032'],
];

describe('modernLayerName', () => {
  it('původní název s diakritikou a mezerami; zakázané znaky jako _', () => {
    expect(modernLayerName('Obrys dílu')).toBe('Obrys dílu');
    expect(modernLayerName(' a<b>c/d\\e"f:g;h?i*j|k=l`m ')).toBe('a_b_c_d_e_f_g_h_i_j_k_l_m');
    expect(modernLayerName('')).toBe('0');
    expect([...modernLayerName('ž'.repeat(300))]).toHaveLength(255);
  });

  it('názvy, které se liší jen velikostí písmen, splynou → přípona; TABULE z výkresu → _2', () => {
    const p = (outer: string, hole: string): Part => ({
      ...plate,
      id: outer,
      shape: { ...plate.shape!, layers: { outer, holes: [hole] }, marks: [], notes: [] },
    });
    const names = modernLayerNames([p('Díra', 'DÍRA'), p('Tabule', 'otvory')]);
    expect(names.get('Díra', 'outer')).toBe('Díra');
    expect(names.get('DÍRA', 'hole')).toBe('DÍRA_2');
    expect(names.get('Tabule', 'outer')).toBe('Tabule_2');
    expect(names.get('otvory', 'hole')).toBe('OTVORY');
  });
});

describe.each(VERSIONS)('DXF %s', (version, code) => {
  const text = writeSheetDxfModern(sheet, layout, parts, version);

  it(`hlavička ${code}, mm, všechny oddíly; 2000 jen ASCII, 2018 v UTF-8`, () => {
    expect(text).toMatch(new RegExp(`\\$ACADVER\\s*\\r?\\n\\s*1\\s*\\r?\\n${code}`));
    expect(text).toMatch(/\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*4\b/);
    for (const section of ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']) {
      expect(text).toMatch(new RegExp(`SECTION\\s*\\r?\\n\\s*2\\s*\\r?\\n${section}\\s`));
    }
    // eslint-disable-next-line no-control-regex
    if (version === '2000') expect(text).toMatch(/^[\x00-\x7f]*$/);
    else expect(text).toContain('Obrys dílu');
  });

  it('vlastní import: vrstvy s původními názvy, obrysy, otvor, gravírování a texty v EPS', () => {
    const r = readDxf(text);
    expect(r.ok).toBe(true);
    const layers = new Set(r.segments.map((s) => s.layer));
    expect([...layers].sort()).toEqual(
      ['DILY', 'Díry M6', 'Gravír', 'Obrys dílu', 'TABULE'].sort(),
    );
    const placed = placedContours(plate, layout.placements[0]!);
    const outer = r.segments.filter((s) => s.layer === 'Obrys dílu');
    expect(outer).toHaveLength(4);
    placed.outer.forEach((v) => expect(outer.some((s) => near(s.a, v))).toBe(true));
    const marks = r.segments.filter((s) => s.layer === 'Gravír');
    const want = placed.marks![0]!.segments;
    expect(marks).toHaveLength(2);
    marks.forEach((s, i) => {
      expect(near(s.a, want[i]!.a) && near(s.b, want[i]!.b)).toBe(true);
      expect(Math.abs(s.bulge - want[i]!.bulge)).toBeLessThan(1e-6);
    });
    const note = r.texts.find((t) => t.layer === 'Poznámky')!.lines[0]!;
    const n = placed.notes![0]!;
    expect(note.text).toBe('S235 ⌀8 100%');
    expect(near(note.at, n.at)).toBe(true);
    expect(Math.abs(note.rotation - n.rotation)).toBeLessThan(1e-6);
    expect(Math.abs(note.widthFactor - 0.8)).toBeLessThan(1e-9);
    expect([note.halign, note.valign]).toEqual([1, 2]);
    expect(r.texts.filter((t) => t.layer === 'POPISKY').map((t) => t.text)).toEqual([
      'Příruba Ž',
      'Obdélník',
    ]);
  });

  it('zpětný import dílů dá stejné tvary, hladiny i poznámky', () => {
    const r = partsFromDxf('plan.dxf', text, {
      mode: 'multi',
      layerRoles: new Map([
        ['TABULE', 'ignore'],
        ['Gravír', 'attach'],
        ['Poznámky', 'attach'],
      ]),
    });
    expect(r.errors).toEqual([]);
    const back = r.parts.find((p) => p.shape?.layers?.outer === 'Obrys dílu')!;
    expect(back.name).toBe('Příruba Ž');
    expect(back.shape!.layers!.holes).toEqual(['Díry M6']);
    expect(back.shape!.marks!.map((m) => [m.layer, m.segments.length])).toEqual([['Gravír', 2]]);
    expect(back.shape!.notes!.map((x) => x.text)).toEqual(['S235 ⌀8 100%']);
  });

  it('nezávislé čtečky: dxf-parser a acad-ts (port ACadSharp) přečtou entity a vrstvy', () => {
    const p = new DxfParser().parseSync(text)!;
    const types = p.entities.map((e) => e.type);
    expect(types.filter((t) => t === 'LWPOLYLINE')).toHaveLength(4);
    expect(types.filter((t) => t === 'CIRCLE')).toHaveLength(1);
    const doc = DxfReader.readFromStream(new TextEncoder().encode(text));
    const entities = [...doc.entities!];
    expect(entities).toHaveLength(p.entities.length);
    // acad-ts dekóduje podle $DWGCODEPAGE i u DXF 2007+ (AutoCAD je čte vždy
    // jako UTF-8) a nepřevádí \U+XXXX – diakritiku ověřuje vlastní import
    // a dxf-parser; tady názvy bez diakritiky a u 2000 po dekódování \U+.
    const names = new Set([...doc.layers!].map((l) => decodeDxfUnicode(l.name)));
    const want = ['0', 'TABULE', 'DILY', 'OTVORY', 'POPISKY', 'ZBYTEK'];
    if (version === '2000') want.push('Obrys dílu', 'Gravír', 'Díry M6', 'Poznámky');
    for (const n of want) expect(names.has(n)).toBe(true);
    expect(names.size).toBe(10);
    expect(
      p.tables.layer.layers['Obrys dílu'] ?? p.tables.layer.layers['Obrys d\\U+00EDlu'],
    ).toBeDefined();
  });

  it('stejné prvky jako R12 (počet entit podle vrstev bez vrstvy 0)', () => {
    const count = (t: string) => {
      const map = new Map<string, number>();
      for (const s of readDxf(t).segments) map.set(s.layer, (map.get(s.layer) ?? 0) + 1);
      return map;
    };
    const r12 = count(writeSheetDxf(sheet, layout, parts));
    const modern = count(text);
    expect(modern.get('TABULE')).toBe(r12.get('TABULE'));
    expect(modern.get('DILY')).toBe(r12.get('DILY'));
    expect(modern.get('Obrys dílu')).toBe(r12.get('OBRYS_DILU'));
    expect(modern.get('Gravír')).toBe(r12.get('GRAVIR'));
  });
});

describe('výsledek výpočtu → soubory DXF 2018', () => {
  it('jeden soubor na tabuli, stejná vrstva táž hladina ve všech souborech', () => {
    const many: Part = { ...plate, quantity: 12 };
    const input: NestingInput = {
      parts: [many],
      sheets: [{ ...sheet, width: 260, height: 160, forbiddenZones: [] }],
      params: DEFAULT_NESTING_PARAMS,
    };
    const outcome = nest(input);
    if (!outcome.ok) throw new Error('výpočet selhal');
    const files = writeResultDxfModern(input, outcome.result, 'plan', '2018');
    expect(files.length).toBeGreaterThan(1);
    expect(files[0]!.name).toMatch(/^plan-tabule-\d+\.dxf$/);
    for (const f of files) {
      const layers = new Set(readDxf(f.content).segments.map((s) => s.layer));
      expect(layers.has('Obrys dílu')).toBe(true);
    }
  });
});

/** Dvojice kód–hodnota ASCII DXF. */
function groupsOf(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]!]);
  return out;
}

/** Vrstvy entit (8 v ENTITIES) a vrstvy definované v tabulce LAYER. */
function layersOf(text: string) {
  const g = groupsOf(text);
  const section = (name: string) => {
    const start = g.findIndex(([c, v], i) => c === 2 && v === name && g[i - 1]?.[1] === 'SECTION');
    const end = g.findIndex(([c, v], i) => i > start && c === 0 && v === 'ENDSEC');
    return g.slice(start, end);
  };
  const used = new Set(
    section('ENTITIES')
      .filter(([c]) => c === 8)
      .map(([, v]) => v),
  );
  const tables = section('TABLES');
  const defined = new Set<string>();
  tables.forEach(([c, v], i) => {
    if (c === 0 && v === 'LAYER') {
      const name = tables.slice(i + 1).find(([cc]) => cc === 2);
      if (name) defined.add(name[1]);
    }
  });
  return { used, defined, groups: g };
}

describe('DXF 2000/2018 – případy z revize', () => {
  const tricky: Part = {
    ...plate,
    id: 'x',
    shape: {
      ...plate.shape!,
      layers: { outer: 'Obrys, A', holes: ['Díry pro šrouby M6 s podložkou a maticí'] },
      marks: [
        { layer: 'gravír', segments: plate.shape!.marks![0]!.segments },
        { layer: 'GRAVÍR', segments: plate.shape!.marks![0]!.segments },
        { layer: 'Značka 😀', segments: plate.shape!.marks![0]!.segments },
      ],
      notes: [{ ...plate.shape!.notes![0]!, text: '50%%d \\U+0041' }],
    },
  };
  const one: SheetLayout = {
    sheetId: 't',
    placements: [{ partId: 'x', instance: 0, x: 200, y: 20, rotation: 90 }],
  };

  it.each(VERSIONS)(
    'DXF %s: každá vrstva entit je v tabulce LAYER (čárka, dlouhý název, velikost písmen, emoji)',
    (version) => {
      const text = writeSheetDxfModern(sheet, one, [tricky], version);
      const { used, defined } = layersOf(text);
      for (const layer of used) expect(defined.has(layer)).toBe(true);
      const names = [...defined].map(decodeDxfUnicode);
      expect(names).toContain('Obrys_ A');
      expect(names).toContain('gravír');
      expect(names).toContain('GRAVÍR_2');
      if (version === '2000') {
        for (const n of names) expect([...n].length).toBeLessThanOrEqual(31);
        expect(names).toContain('Značka _');
      } else {
        expect(names).toContain('Díry pro šrouby M6 s podložkou a maticí');
        expect(names).toContain('Značka 😀');
      }
    },
  );

  it.each(VERSIONS)(
    'DXF %s: úhly ARC v [0, 360), čísla bez exponentu, rozvržení a meze výkresu',
    (version) => {
      const text = writeSheetDxfModern(sheet, layout, parts, version);
      const { groups } = layersOf(text);
      groups.forEach(([c, v], i) => {
        if (c === 0 && v === 'ARC') {
          const angles = groups
            .slice(i)
            .filter(([cc]) => cc === 50 || cc === 51)
            .slice(0, 2);
          for (const [, a] of angles) expect(Number(a) >= 0 && Number(a) < 360).toBe(true);
        }
        if ([10, 20, 40, 42, 50, 51].includes(c)) expect(v.trim()).not.toMatch(/e/i);
      });
      expect(groups.filter(([c, v]) => c === 0 && v === 'LAYOUT')).toHaveLength(2);
      expect(text).toContain('ACAD_LAYOUT');
      expect(text).toMatch(/\$EXTMIN/);
      expect(text).toMatch(/\$EXTMAX/);
    },
  );

  it('text poznámky s „%%d" a „\\U+0041" se přečte zpět doslova', () => {
    for (const [version] of VERSIONS) {
      const back = readDxf(writeSheetDxfModern(sheet, one, [tricky], version));
      expect(back.texts.find((t) => t.layer === 'Poznámky')!.text).toBe('50%%d \\U+0041');
    }
  });

  it('export jedné skupiny zapíše jen ji (číslování podle všech skupin)', () => {
    const many: Part = { ...plate, quantity: 12 };
    const input: NestingInput = {
      parts: [many],
      sheets: [{ ...sheet, width: 260, height: 160, forbiddenZones: [] }],
      params: DEFAULT_NESTING_PARAMS,
    };
    const outcome = nest(input);
    if (!outcome.ok) throw new Error('výpočet selhal');
    const groups = outcome.result.layouts.map((_, i) => ({ indices: [i] }));
    const all = writeResultDxfModern(input, outcome.result, 'plan', '2018', {}, groups);
    const only = writeResultDxfModern(input, outcome.result, 'plan', '2018', {}, groups, 1);
    expect(only).toHaveLength(1);
    expect(only[0]!.name).toBe(all[1]!.name);
  });
});

describe('DXF – případy z code-review', () => {
  const one: SheetLayout = {
    sheetId: 't',
    placements: [{ partId: 'x', instance: 0, x: 200, y: 20, rotation: 0 }],
  };
  const withShape = (shape: Partial<NonNullable<Part['shape']>>, name = 'Díl'): Part => ({
    ...plate,
    id: 'x',
    name,
    shape: { ...plate.shape!, ...shape },
  });

  it('díl bez hladin obrysů: přidaná geometrie a poznámky mají vrstvu v tabulce i příponu při kolizi', () => {
    const shape = { ...plate.shape! };
    delete (shape as { layers?: unknown }).layers;
    const part: Part = {
      ...plate,
      id: 'x',
      shape: {
        ...shape,
        marks: [{ layer: 'Tabule', segments: plate.shape!.marks![0]!.segments }],
        notes: [{ ...plate.shape!.notes![0]!, layer: 'gravír č. 1' }],
      },
    };
    const names = modernLayerNames([part]);
    expect(names.get('Tabule', 'mark')).toBe('Tabule_2');
    for (const [version] of VERSIONS) {
      const { used, defined } = layersOf(writeSheetDxfModern(sheet, one, [part], version));
      for (const layer of used) expect(defined.has(layer)).toBe(true);
      expect([...defined].map(decodeDxfUnicode)).toContain('gravír č. 1');
    }
    // R12: stejná oprava – vrstva přidané geometrie nesplyne s vrstvou TABULE.
    const r12 = layersOf(writeSheetDxf(sheet, one, [part]));
    expect([...r12.defined]).toContain('TABULE_2');
    for (const layer of r12.used) expect(r12.defined.has(layer)).toBe(true);
  });

  it('2000/2018: „Díly" a „Otvory" jsou vlastní vrstvy, „dily" a „OTVORY" obecné; R12 beze změny', () => {
    const part = withShape({ layers: { outer: 'Díly', holes: ['Otvory'] }, marks: [], notes: [] });
    const modern = modernLayerNames([part]);
    expect(modern.get('Díly', 'outer')).toBe('Díly');
    expect(modern.get('Otvory', 'hole')).toBe('OTVORY');
    expect(modern.get('dily', 'outer')).toBe('DILY');
    const text = writeSheetDxfModern(sheet, one, [part], '2018');
    expect([...layersOf(text).defined]).toContain('Díly');
    const r12 = writeSheetDxf(sheet, one, [part]);
    const r12Layers = [...layersOf(r12).defined];
    expect(r12Layers).toContain('DILY');
    expect(r12Layers).not.toContain('DILY_2');
  });

  it('prázdný název dílu ani prázdná poznámka nedají prázdný TEXT', () => {
    const part = withShape({ notes: [{ ...plate.shape!.notes![0]!, text: '  \t ' }] }, '   ');
    for (const [version] of VERSIONS) {
      const back = readDxf(writeSheetDxfModern(sheet, one, [part], version));
      expect(back.texts).toEqual([]);
    }
    expect(readDxf(writeSheetDxf(sheet, one, [part])).texts).toEqual([]);
  });

  it('řídicí znaky v textu a názvu hladiny se zapíšou jako mezera (ne „^J")', () => {
    expect(modernLayerName('Ohyb\tdolů\nA')).toBe('Ohyb dolů A');
    const part = withShape(
      { notes: [{ ...plate.shape!.notes![0]!, text: 'řádek\ndalší\tsloupec' }] },
      'Bok\n2',
    );
    for (const [version] of VERSIONS) {
      const text = writeSheetDxfModern(sheet, one, [part], version);
      expect(text).not.toContain('^J');
      expect(text).not.toContain('^I');
      const texts = readDxf(text).texts.map((t) => t.text);
      expect(texts).toContain('řádek další sloupec');
      expect(texts).toContain('Bok 2');
    }
  });
});
