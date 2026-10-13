import { describe, expect, it } from 'vitest';
import {
  contourArea,
  contourBBox,
  contourOrientation,
} from '../../../src/core/geometry/contour.ts';
import { baseName, partsFromDxf } from '../../../src/core/import/dxf-parts.ts';
import { DEFAULT_NESTING_PARAMS, type Part } from '../../../src/core/model.ts';
import { arc, circle, dxf, line, lwpoly, rectPoly } from './dxf-builder.ts';
import { validateNestingInput } from '../../../src/core/validate.ts';

/** Díly projdou validací vstupu nestingu (tvar odpovídá rozměrům). */
function expectValid(parts: readonly Part[]) {
  const issues = validateNestingInput({
    parts,
    sheets: [
      { id: 's', name: 'S', width: 3000, height: 1500, stock: null, margin: 0, forbiddenZones: [] },
    ],
    params: DEFAULT_NESTING_PARAMS,
  });
  expect(issues).toEqual([]);
}

/** Příruba: obdélník se zaoblenými rohy (oblouky) a dvěma otvory. */
const flange = (dx = 0, dy = 0) => [
  line(dx + 10, dy, dx + 190, dy),
  arc(dx + 190, dy + 10, 10, 270, 360),
  line(dx + 200, dy + 10, dx + 200, dy + 90),
  arc(dx + 190, dy + 90, 10, 0, 90),
  line(dx + 190, dy + 100, dx + 10, dy + 100),
  arc(dx + 10, dy + 90, 10, 90, 180),
  line(dx, dy + 90, dx, dy + 10),
  arc(dx + 10, dy + 10, 10, 180, 270),
  circle(dx + 50, dy + 50, 15),
  circle(dx + 150, dy + 50, 15),
];

describe('baseName', () => {
  it('bez cesty a přípony', () => {
    expect(baseName('C:\\vykresy\\Příruba A.dxf')).toBe('Příruba A');
    expect(baseName('dir/plech.v2.DXF')).toBe('plech.v2');
    expect(baseName('bez-pripony')).toBe('bez-pripony');
  });
});

describe('partsFromDxf', () => {
  it('1 soubor = 1 díl: obrys s oblouky a otvory, posun do (0, 0), název podle souboru', () => {
    const r = partsFromDxf('Příruba.dxf', dxf({ entities: flange(500, 300) }), { idPrefix: 'f' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.parts).toHaveLength(1);
    const p = r.parts[0]!;
    expect(p).toMatchObject({ id: 'f-1', name: 'Příruba', quantity: 1, rotation: 'ortho' });
    expect(p.width).toBeCloseTo(200, 9);
    expect(p.height).toBeCloseTo(100, 9);
    const bb = contourBBox(p.shape!.outer);
    expect(bb.x).toBeCloseTo(0, 9);
    expect(bb.y).toBeCloseTo(0, 9);
    expect(contourOrientation(p.shape!.outer)).toBe('ccw');
    expect(p.shape!.holes).toHaveLength(2);
    expect(p.shape!.outer.some((v) => v.bulge !== 0)).toBe(true);
    // Plocha: obdélník − 4 rohy (10² − π·10²/4) − 2 otvory.
    const area = 200 * 100 - 4 * (100 - (Math.PI * 100) / 4);
    expect(contourArea(p.shape!.outer)).toBeCloseTo(area, 6);
    expectValid(r.parts);
  });

  it('jednotky: palce se převedou na mm', () => {
    const r = partsFromDxf('a.dxf', dxf({ insunits: 1, entities: [rectPoly(0, 0, 2, 1)] }));
    expect(r.units.name).toBe('palce');
    expect(r.parts[0]!.width).toBeCloseTo(50.8, 9);
    expect(r.parts[0]!.height).toBeCloseTo(25.4, 9);
  });

  it('více dílů v souboru: každý vnější obrys = díl, pojmenování shora dolů a zleva doprava', () => {
    const text = dxf({
      entities: [
        rectPoly(300, 0, 50, 50),
        ...flange(0, 200),
        rectPoly(0, 0, 80, 40),
        circle(500, 225, 25),
      ],
    });
    const r = partsFromDxf('plech.dxf', text, { mode: 'multi' });
    expect(r.errors).toEqual([]);
    expect(
      r.parts.map((p) => [
        p.name,
        Math.round(p.width),
        Math.round(p.height),
        p.shape!.holes.length,
      ]),
    ).toEqual([
      ['plech-1', 200, 100, 2],
      // Kružnice (horní okraj 250) je výš než čtverec (50) i obdélník (40).
      ['plech-2', 50, 50, 0],
      ['plech-3', 50, 50, 0],
      ['plech-4', 80, 40, 0],
    ]);
    expect(new Set(r.parts.map((p) => p.id)).size).toBe(4);
    expectValid(r.parts);
  });

  it('díl uvnitř otvoru jiného dílu je v režimu „více dílů" samostatný díl', () => {
    const text = dxf({
      entities: [rectPoly(0, 0, 100, 100), rectPoly(10, 10, 80, 80), rectPoly(30, 30, 20, 20)],
    });
    const multi = partsFromDxf('r.dxf', text, { mode: 'multi' });
    expect(multi.parts.map((p) => [Math.round(p.width), p.shape!.holes.length])).toEqual([
      [100, 1],
      [20, 0],
    ]);
    const single = partsFromDxf('r.dxf', text);
    expect(single.parts).toHaveLength(1);
    expect(single.warnings.join()).toMatch(/Uvnitř otvorů dílu je 1 dalších kontur/);
  });

  it('1 díl: kontury mimo hlavní obrys → varování', () => {
    const r = partsFromDxf(
      'x.dxf',
      dxf({ entities: [rectPoly(0, 0, 100, 100), rectPoly(200, 0, 10, 10)] }),
    );
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]!.width).toBe(100);
    expect(r.warnings.join()).toMatch(/Mimo hlavní obrys je 1 dalších kontur/);
  });

  it('filtr vrstev: kóty a ohyby na jiných vrstvách se nepoužijí', () => {
    const text = dxf({
      entities: [rectPoly(0, 0, 100, 50, [8, 'OBRYS']), line(0, 25, 100, 25, [8, 'OHYB'])],
    });
    expect(partsFromDxf('o.dxf', text).errors.length).toBeGreaterThan(0);
    const r = partsFromDxf('o.dxf', text, { layer: (l) => l === 'OBRYS' });
    expect(r.errors).toEqual([]);
    expect(r.parts).toHaveLength(1);
    expect(partsFromDxf('o.dxf', text, { layer: () => false }).errors).toEqual([
      'Ve vybraných vrstvách není žádná geometrie.',
    ]);
  });

  it('neuzavřená kontura: chyba, ale uzavřené díly se vrátí', () => {
    const r = partsFromDxf(
      'o.dxf',
      dxf({ entities: [rectPoly(0, 0, 10, 10), line(50, 0, 60, 0)] }),
      {
        mode: 'multi',
      },
    );
    expect(r.parts).toHaveLength(1);
    expect(r.errors[0]).toMatch(/Kontura není uzavřená/);
    const none = partsFromDxf('o.dxf', dxf({ entities: [line(0, 0, 10, 0), line(10, 0, 10, 10)] }));
    expect(none.parts).toEqual([]);
    expect(none.errors).toContain('Ve výkresu není žádná uzavřená kontura.');
  });

  it('nečitelný soubor → chyba bez dílů', () => {
    const r = partsFromDxf('x.dxf', 'nesmysl');
    expect(r.parts).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('LWPOLYLINE s bulge (zaoblená drážka) – oblouky zůstanou v tvaru', () => {
    const slot = lwpoly([
      [0, 0, 0],
      [100, 0, 1],
      [100, 40, 0],
      [0, 40, 1],
    ]);
    const r = partsFromDxf('drazka.dxf', dxf({ entities: [slot] }));
    const p = r.parts[0]!;
    expect(p.width).toBeCloseTo(140, 9);
    expect(p.height).toBeCloseTo(40, 9);
    expect(p.shape!.outer.filter((v) => v.bulge !== 0)).toHaveLength(2);
    expectValid(r.parts);
  });
});
