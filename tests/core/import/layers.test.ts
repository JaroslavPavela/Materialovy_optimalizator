import { describe, expect, it } from 'vitest';
import { contourBBox } from '../../../src/core/geometry/contour.ts';
import type { Point } from '../../../src/core/geometry/types.ts';
import {
  buildContours,
  GAP_TOL,
  JOIN_TOL,
  type SegmentLike,
} from '../../../src/core/import/contours.ts';
import { partsFromDxf } from '../../../src/core/import/dxf-parts.ts';
import {
  drawingLayers,
  layerRole,
  layerRolesFromJson,
  originsMatch,
  ORIGIN_TOL,
  type LayerRole,
} from '../../../src/core/import/layers.ts';
import { circle, dxf, ent, line, lwpoly, rectPoly } from './dxf-builder.ts';

const L = (a: Point, b: Point, layer: string, bulge = 0): SegmentLike => ({ a, b, bulge, layer });

function rect(x: number, y: number, w: number, h: number, layer: string): SegmentLike[] {
  const p = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  return p.map((a, i) => L(a, p[(i + 1) % 4]!, layer));
}

const roles = (r: Record<string, LayerRole>) => new Map(Object.entries(r));
const on = (layer: string) => [8, layer] as const;
const lwpolyOn = (layer: string, pts: [number, number][]) => lwpoly(pts, on(layer));

describe('role hladin – pomocné funkce', () => {
  it('chybějící hladina má roli vnější obrys', () => {
    expect(layerRole(undefined, 'X')).toBe('outer');
    expect(layerRole(roles({ X: 'attach' }), 'X')).toBe('attach');
    expect(layerRole(roles({ X: 'attach' }), 'Y')).toBe('outer');
  });

  it('role z úložiště: neplatné položky se přeskočí, „__proto__" je obyčejná hladina', () => {
    const r = layerRolesFromJson([
      ['OBRYS', 'outer'],
      ['DIRY', 'inner'],
      ['__proto__', 'ignore'],
      ['X', 'neznama'],
      [1, 'outer'],
      'nesmysl',
    ]);
    expect([...r]).toEqual([
      ['OBRYS', 'outer'],
      ['DIRY', 'inner'],
      ['__proto__', 'ignore'],
    ]);
    expect(layerRolesFromJson({ OBRYS: 'outer' }).size).toBe(0);
    expect(layerRolesFromJson(null).size).toBe(0);
  });

  it('tolerance klíče polohy odpovídá uzavření mezery v sestavení kontur', () => {
    expect(ORIGIN_TOL).toBeCloseTo(GAP_TOL + JOIN_TOL, 12);
    expect(originsMatch('0.00,0.00,10.00,5.00', '0.11,0.00,10.00,5.00')).toBe(true);
    expect(originsMatch('0.00,0.00,10.00,5.00', '0.12,0.00,10.00,5.00')).toBe(false);
    expect(originsMatch('9,9,1,1|0,0,10,5', '0,0,10,5')).toBe(true);
  });

  it('hladiny výkresu s počty segmentů a textů, seřazené podle názvu', () => {
    expect(
      drawingLayers([{ layer: 'b' }, { layer: 'A' }, { layer: 'b' }], [{ layer: 'T' }]),
    ).toEqual([
      { name: 'A', segments: 1, texts: 0 },
      { name: 'b', segments: 2, texts: 0 },
      { name: 'T', segments: 0, texts: 1 },
    ]);
  });
});

describe('buildContours – hladiny', () => {
  it('kontura nese hladinu většiny svých segmentů, otvory svou', () => {
    const outer = rect(0, 0, 100, 50, 'OBRYS');
    outer[0] = { ...outer[0]!, layer: 'JINA' };
    const r = buildContours([...outer, ...rect(10, 10, 10, 10, 'DIRY')]);
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.outerLayer).toBe('OBRYS');
    expect(r.regions[0]!.holeLayers).toEqual(['DIRY']);
  });

  it('segment bez hladiny je na hladině 0', () => {
    const segs = rect(0, 0, 10, 10, 'X').map(({ a, b, bulge }) => ({ a, b, bulge }));
    expect(buildContours(segs).regions[0]!.outerLayer).toBe('0');
  });

  it('vnitřní obrys: kontura v materiálu je otvor, samostatná kontura se ignoruje s varováním', () => {
    const r = buildContours(
      [
        ...rect(0, 0, 100, 50, 'OBRYS'),
        ...rect(10, 10, 10, 10, 'DIRY'),
        ...rect(200, 0, 10, 10, 'DIRY'),
      ],
      { holeLayer: (l) => l === 'DIRY' },
    );
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.holes).toHaveLength(1);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/hladině „DIRY" \(vnitřní obrys\) neleží v materiálu/);
  });

  it('vnitřní obrys bez dílu kolem: díl v něm nakreslený zůstane dílem', () => {
    // Rámeček na hladině DIRY nikde neleží v materiálu – vynechá se a obdélník
    // uvnitř (hladina OBRYS) je samostatný díl, ne otvor.
    const r = buildContours([...rect(0, 0, 100, 100, 'DIRY'), ...rect(10, 10, 20, 20, 'OBRYS')], {
      holeLayer: (l) => l === 'DIRY',
    });
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.holes).toEqual([]);
    expect(contourBBox(r.regions[0]!.outer)).toMatchObject({ x: 10, y: 10, width: 20 });
  });

  it('vnitřní obrys v otvoru jiného dílu (sudá hloubka) se ignoruje', () => {
    const r = buildContours(
      [
        ...rect(0, 0, 100, 100, 'OBRYS'),
        ...rect(10, 10, 80, 80, 'OBRYS'),
        ...rect(40, 40, 10, 10, 'DIRY'),
      ],
      { holeLayer: (l) => l === 'DIRY' },
    );
    expect(r.regions).toHaveLength(1);
    expect(r.regions[0]!.holes).toHaveLength(1);
    expect(r.regions[0]!.holeLayers).toEqual(['OBRYS']);
    expect(r.warnings.join('\n')).toMatch(/vnitřní obrys/);
  });
});

describe('partsFromDxf – role hladin', () => {
  // Deska 200 × 100 (OBRYS), kruhový otvor (DIRY), drážka přes celý díl (OHYB),
  // gravírování v desce (GRAVIR) a kóta mimo díl (KOTY).
  const text = dxf({
    entities: [
      rectPoly(0, 0, 200, 100, on('OBRYS')),
      circle(50, 50, 10, on('DIRY')),
      line(100, 0, 100, 100, on('OHYB')),
      line(150, 40, 180, 40, on('GRAVIR')),
      circle(160, 70, 5, on('GRAVIR')),
      line(0, -20, 200, -20, on('KOTY')),
    ],
  });

  it('výchozí role (vše vnější obrys): ohyb rozbije díl, hladiny se vrátí vždy', () => {
    const r = partsFromDxf('d.dxf', text);
    expect(r.layers.map((l) => l.name)).toEqual(['DIRY', 'GRAVIR', 'KOTY', 'OBRYS', 'OHYB']);
    expect(r.layers.find((l) => l.name === 'OBRYS')!.segments).toBe(4);
    expect(r.parts).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('obrys + otvor + přidaná geometrie + ignorované hladiny', () => {
    const r = partsFromDxf('d.dxf', text, {
      layerRoles: roles({ DIRY: 'inner', OHYB: 'attach', GRAVIR: 'attach', KOTY: 'ignore' }),
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.parts).toHaveLength(1);
    const shape = r.parts[0]!.shape!;
    expect(shape.holes).toHaveLength(1);
    expect(shape.layers).toEqual({ outer: 'OBRYS', holes: ['DIRY'] });
    const marks = new Map(shape.marks!.map((m) => [m.layer, m.segments]));
    expect([...marks.keys()].sort()).toEqual(['GRAVIR', 'OHYB']);
    // Úsečka gravírování + kruh jako dva půloblouky.
    expect(marks.get('GRAVIR')).toHaveLength(3);
    expect(marks.get('OHYB')).toEqual([{ a: { x: 100, y: 0 }, b: { x: 100, y: 100 }, bulge: 0 }]);
  });

  it('přidaná geometrie se posune spolu s dílem do počátku', () => {
    const moved = dxf({
      entities: [
        rectPoly(1000, 500, 200, 100, on('OBRYS')),
        line(1150, 540, 1180, 540, on('GRAVIR')),
      ],
    });
    const r = partsFromDxf('d.dxf', moved, { layerRoles: roles({ GRAVIR: 'attach' }) });
    expect(r.parts[0]!.shape!.marks).toEqual([
      { layer: 'GRAVIR', segments: [{ a: { x: 150, y: 40 }, b: { x: 180, y: 40 }, bulge: 0 }] },
    ]);
  });

  it('přidaná geometrie mimo obrysy se ignoruje s varováním', () => {
    const r = partsFromDxf('d.dxf', text, {
      layerRoles: roles({ DIRY: 'inner', OHYB: 'ignore', GRAVIR: 'ignore', KOTY: 'attach' }),
    });
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]!.shape!.marks).toBeUndefined();
    expect(r.warnings).toEqual([
      'Na hladině „KOTY" (přidej k dílu) leží 1 segment mimo obrysy dílů – ignorován.',
    ]);
  });

  it('více dílů: přidaná geometrie patří dílu, ve kterém leží (i dílu v otvoru jiného)', () => {
    const nested = dxf({
      entities: [
        rectPoly(0, 0, 100, 100, on('OBRYS')),
        rectPoly(10, 10, 80, 80, on('OBRYS')),
        rectPoly(30, 30, 40, 40, on('OBRYS')),
        line(40, 50, 60, 50, on('GRAVIR')),
        line(2, 2, 8, 2, on('GRAVIR')),
      ],
    });
    const r = partsFromDxf('d.dxf', nested, {
      mode: 'multi',
      layerRoles: roles({ GRAVIR: 'attach' }),
    });
    expect(r.parts).toHaveLength(2);
    const frame = r.parts.find((p) => p.width === 100)!;
    const inner = r.parts.find((p) => p.width === 40)!;
    expect(frame.shape!.marks![0]!.segments).toEqual([
      { a: { x: 2, y: 2 }, b: { x: 8, y: 2 }, bulge: 0 },
    ]);
    expect(inner.shape!.marks![0]!.segments).toEqual([
      { a: { x: 10, y: 20 }, b: { x: 30, y: 20 }, bulge: 0 },
    ]);
  });

  it('hladina „ignoruj" nedává ani názvy dílů z textu', () => {
    const named = dxf({
      entities: [
        rectPoly(0, 0, 100, 50, on('OBRYS')),
        ent('TEXT', [8, 'POPIS'], [10, 40], [20, 20], [30, 0], [40, 10], [1, 'A1']),
      ],
    });
    expect(partsFromDxf('d.dxf', named, { mode: 'multi' }).parts[0]!.name).toBe('A1');
    const r = partsFromDxf('d.dxf', named, {
      mode: 'multi',
      layerRoles: roles({ POPIS: 'ignore' }),
    });
    expect(r.parts[0]!.name).toBe('d');
  });

  it('stejný text a tvar s jinou přidanou geometrií se neslučuje', () => {
    const twins = dxf({
      entities: [
        rectPoly(0, 0, 100, 50, on('OBRYS')),
        ent('TEXT', [8, 'POPIS'], [10, 10], [20, 20], [30, 0], [40, 10], [1, 'A1']),
        rectPoly(200, 0, 100, 50, on('OBRYS')),
        ent('TEXT', [8, 'POPIS'], [10, 210], [20, 20], [30, 0], [40, 10], [1, 'A1']),
        line(260, 10, 290, 10, on('GRAVIR')),
      ],
    });
    const r = partsFromDxf('d.dxf', twins, {
      mode: 'multi',
      layerRoles: roles({ GRAVIR: 'attach' }),
    });
    expect(r.parts.map((p) => [p.name, p.quantity])).toEqual([
      ['A1', 1],
      ['A1-2', 1],
    ]);
    const same = partsFromDxf('d.dxf', twins, {
      mode: 'multi',
      layerRoles: roles({ GRAVIR: 'ignore' }),
    });
    expect(same.parts.map((p) => [p.name, p.quantity])).toEqual([['A1', 2]]);
  });

  it('jen přidaná geometrie bez obrysu: chyba „není žádný obrys"', () => {
    const r = partsFromDxf('d.dxf', text, {
      layerRoles: roles({
        OBRYS: 'attach',
        DIRY: 'attach',
        OHYB: 'attach',
        GRAVIR: 'attach',
        KOTY: 'attach',
      }),
    });
    expect(r.parts).toEqual([]);
    expect(r.errors).toEqual(['Ve vybraných hladinách není žádný obrys (vnější obrys).']);
    expect(r.layers).toHaveLength(5);
  });
});

describe('role hladin – případy z revize', () => {
  it('úsečka gravíru přes zářez tvaru U se k dílu nepřidá', () => {
    const u = dxf({
      entities: [
        lwpolyOn('OBRYS', [
          [0, 0],
          [100, 0],
          [100, 100],
          [60, 100],
          [60, 20],
          [40, 20],
          [40, 100],
          [0, 100],
        ]),
        line(10, 90, 70, 90, on('GRAVIR')),
        line(10, 10, 90, 10, on('GRAVIR')),
      ],
    });
    const r = partsFromDxf('u.dxf', u, { layerRoles: roles({ GRAVIR: 'attach' }) });
    expect(r.parts[0]!.shape!.marks).toEqual([
      { layer: 'GRAVIR', segments: [{ a: { x: 10, y: 10 }, b: { x: 90, y: 10 }, bulge: 0 }] },
    ]);
    expect(r.warnings).toContain(
      'Na hladině „GRAVIR" (přidej k dílu) leží 1 segment mimo obrysy dílů – ignorován.',
    );
  });

  it('stejný text a tvar, ale přidaná geometrie jinde nebo prohozené hladiny otvorů: neslučuje se', () => {
    const plate = (x: number, bend: number, m6: number) => [
      rectPoly(x, 0, 100, 50, on('OBRYS')),
      ent('TEXT', [8, 'POPIS'], [10, x + 45], [20, 22], [30, 0], [40, 5], [1, 'A1']),
      line(x + 10, bend, x + 40, bend, on('OHYB')),
      circle(x + m6, 25, 4, on('M6')),
      circle(x + 100 - m6, 25, 4, on('M8')),
    ];
    const opts = { mode: 'multi' as const, layerRoles: roles({ OHYB: 'attach' }) };
    const names = (entities: ReturnType<typeof plate>) =>
      partsFromDxf('d.dxf', dxf({ entities }), opts).parts.map((p) => [p.name, p.quantity]);
    expect(names([...plate(0, 5, 10), ...plate(200, 5, 10)])).toEqual([['A1', 2]]);
    expect(names([...plate(0, 5, 10), ...plate(200, 45, 10)])).toEqual([
      ['A1', 1],
      ['A1-2', 1],
    ]);
    expect(names([...plate(0, 5, 10), ...plate(200, 5, 90)])).toEqual([
      ['A1', 1],
      ['A1-2', 1],
    ]);
  });

  it('1 soubor = 1 díl: přidaná geometrie v ignorované kontuře se nahlásí', () => {
    const r = partsFromDxf(
      'd.dxf',
      dxf({
        entities: [
          rectPoly(0, 0, 100, 50, on('OBRYS')),
          rectPoly(200, 0, 20, 20, on('OBRYS')),
          line(205, 5, 215, 5, on('GRAVIR')),
        ],
      }),
      { layerRoles: roles({ GRAVIR: 'attach' }) },
    );
    expect(r.parts[0]!.shape!.marks).toBeUndefined();
    expect(r.warnings).toContain(
      'Na hladině „GRAVIR" (přidej k dílu) leží 1 segment mimo obrysy dílů – ignorován.',
    );
  });

  it('vnitřní obrys přesahující obrys dílu: díl se vynechá s chybou', () => {
    const r = partsFromDxf(
      'd.dxf',
      dxf({ entities: [rectPoly(0, 0, 100, 50, on('OBRYS')), circle(0, 25, 10, on('DIRY'))] }),
      { layerRoles: roles({ DIRY: 'inner' }) },
    );
    expect(r.parts).toEqual([]);
    expect(r.errors.join('\n')).toMatch(/otvor u bodu .* přesahuje vnější obrys/);
    // Vnější obrys existuje – žádná zpráva „všechny kontury jsou vnitřní obrysy".
    expect(r.errors.join('\n')).not.toMatch(/není žádný vnější obrys/);
  });

  it('všechny kontury jsou vnitřní obrysy: srozumitelná chyba', () => {
    const r = partsFromDxf('d.dxf', dxf({ entities: [rectPoly(0, 0, 100, 50, on('DIRY'))] }), {
      layerRoles: roles({ DIRY: 'inner' }),
    });
    expect(r.errors).toEqual([
      'Ve výkresu není žádný vnější obrys – všechny uzavřené kontury jsou na hladinách s rolí vnitřní obrys.',
    ]);
  });

  it('poloha dílu ve výkresu (origins) se při změně jiných rolí nemění', () => {
    const plan = (role: LayerRole) =>
      partsFromDxf(
        'd.dxf',
        dxf({
          entities: [
            rectPoly(0, 200, 100, 50, on('POM')),
            rectPoly(0, 100, 120, 50, on('OBRYS')),
            rectPoly(0, 0, 140, 50, on('OBRYS')),
          ],
        }),
        { mode: 'multi', layerRoles: roles({ POM: role }) },
      );
    const all = plan('outer');
    const some = plan('ignore');
    expect(all.origins).toHaveLength(3);
    expect(some.parts.map((p) => p.width)).toEqual([120, 140]);
    expect(some.origins).toEqual(all.origins.slice(1));
    expect(all.origins[1]).toBe('0.00,100.00,120.00,50.00');
  });
});
