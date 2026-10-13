import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  contourPath,
  labelFontSize,
  partColor,
  partColors,
  svgNumber,
  writeResultSvg,
  writeSheetSvg,
  xmlEscape,
} from '../../../src/core/export/svg.ts';
import { bulgeToArc } from '../../../src/core/geometry/contour.ts';
import { EPS } from '../../../src/core/geometry/eps.ts';
import type { Contour, Point } from '../../../src/core/geometry/types.ts';
import {
  DEFAULT_NESTING_PARAMS,
  type NestingInput,
  type Part,
  type Sheet,
  type SheetLayout,
} from '../../../src/core/model.ts';
import { nest } from '../../../src/core/nesting/nest.ts';
import { placedContours, placePart } from '../../../src/core/placed.ts';

type Cmd =
  | { c: 'M' | 'L'; p: Point }
  | { c: 'A'; r: number; large: number; sweep: number; p: Point }
  | { c: 'Z' };

/** Rozloží cestu z `contourPath` na příkazy. */
function parsePath(d: string): Cmd[] {
  const out: Cmd[] = [];
  for (const m of d.matchAll(/([MLAZ])([^MLAZ]*)/g)) {
    const n = m[2]!.trim() ? m[2]!.trim().split(/\s+/).map(Number) : [];
    const c = m[1] as Cmd['c'];
    if (c === 'Z') out.push({ c });
    else if (c === 'A')
      out.push({ c, r: n[0]!, large: n[3]!, sweep: n[4]!, p: { x: n[5]!, y: n[6]! } });
    else out.push({ c, p: { x: n[0]!, y: n[1]! } });
  }
  return out;
}

/** Střed oblouku z parametrů SVG (specifikace SVG, F.6.5; rx = ry, bez rotace). */
function svgArcCenter(p1: Point, p2: Point, r: number, large: number, sweep: number): Point {
  const x1 = (p1.x - p2.x) / 2;
  const y1 = (p1.y - p2.y) / 2;
  const d2 = x1 * x1 + y1 * y1;
  const k = Math.sqrt(Math.max(0, (r * r - d2) / d2)) * (large !== sweep ? 1 : -1);
  return { x: k * y1 + (p1.x + p2.x) / 2, y: -k * x1 + (p1.y + p2.y) / 2 };
}

const near = (a: Point, b: Point, eps = EPS) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

/** Cesta odpovídá obrysu: vrcholy, úsečky, a u oblouků poloměr i střed. */
function expectPathMatches(d: string, contour: Contour) {
  const cmds = parsePath(d);
  expect(cmds[0]).toMatchObject({ c: 'M' });
  expect(near((cmds[0] as { p: Point }).p, contour[0]!)).toBe(true);
  expect(cmds.at(-1)).toEqual({ c: 'Z' });
  let k = 1;
  contour.forEach((v, i) => {
    const next = contour[(i + 1) % contour.length]!;
    const arc = bulgeToArc(v, next, v.bulge);
    if (!arc) {
      if (i < contour.length - 1) {
        const cmd = cmds[k++]!;
        expect(cmd.c).toBe('L');
        expect(near((cmd as { p: Point }).p, next)).toBe(true);
      }
      return;
    }
    const cmd = cmds[k++]!;
    if (cmd.c !== 'A') throw new Error(`čekán oblouk, je ${cmd.c}`);
    expect(near(cmd.p, next)).toBe(true);
    expect(Math.abs(cmd.r - arc.radius)).toBeLessThan(EPS);
    expect(cmd.large).toBe(Math.abs(arc.sweep) > 180 ? 1 : 0);
    // Bez tolerance na zaokrouhlení r: střed spočítaný ze SVG musí sedět.
    const center = svgArcCenter(v, next, arc.radius, cmd.large, cmd.sweep);
    expect(near(center, arc.center, 1e-6 * Math.max(1, arc.radius))).toBe(true);
  });
  expect(k).toBe(cmds.length - 1);
}

const shaped: Part = {
  id: 'd',
  name: 'Příruba <A&B>',
  width: 110,
  height: 60,
  quantity: 2,
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
  name: 'Plech "A"',
  width: 1000,
  height: 500,
  stock: null,
  margin: 10,
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
    { partId: 'd', instance: 0, x: 20, y: 20, rotation: 0 },
    { partId: 'd', instance: 1, x: 400, y: 100, rotation: 90 },
    { partId: 'r', instance: 0, x: 600, y: 300, rotation: 0 },
  ],
};

describe('pomocné funkce', () => {
  it('svgNumber: 3 desetinná místa, bez exponentu a záporné nuly', () => {
    expect(svgNumber(1.23456)).toBe('1.235');
    expect(svgNumber(-0.0001)).toBe('0');
    expect(svgNumber(1e-9)).toBe('0');
    expect(svgNumber(2800)).toBe('2800');
    expect(() => svgNumber(Infinity)).toThrow(RangeError);
  });

  it('xmlEscape', () => {
    expect(xmlEscape(`a<b>&"c'`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;');
    expect(xmlEscape('a\u0001b\u001fc\td')).toBe('a b c\td');
  });

  it('barvy podle pořadí dílu jsou různé a stabilní', () => {
    const colors = partColors([shaped, rect]);
    expect(colors.get('d')).toBe(partColor(0));
    expect(colors.get('r')).toBe(partColor(1));
    expect(new Set(Array.from({ length: 20 }, (_, i) => partColor(i))).size).toBe(20);
  });

  it('popisek se vejde do obalového obdélníku', () => {
    expect(labelFontSize({ x: 0, y: 0, width: 100, height: 10 }, 'Bok')).toBe(4);
    expect(labelFontSize({ x: 0, y: 0, width: 30, height: 100 }, 'Dlouhý název')).toBe(4);
  });
});

describe('contourPath', () => {
  it('obdélník: M, L, Z', () => {
    expect(
      contourPath([
        { x: 0, y: 0, bulge: 0 },
        { x: 10, y: 0, bulge: 0 },
        { x: 10, y: 5, bulge: 0 },
        { x: 0, y: 5, bulge: 0 },
      ]),
    ).toBe('M0 0L10 0L10 5L0 5Z');
    expect(contourPath([])).toBe('');
  });

  it('kruh CCW má sweep 1, otvor CW sweep 0; oblouk > 180° má large-arc 1', () => {
    expect(
      contourPath([
        { x: 0, y: 0, bulge: 1 },
        { x: 10, y: 0, bulge: 1 },
      ]),
    ).toBe('M0 0A5 5 0 0 1 10 0A5 5 0 0 1 0 0Z');
    expect(
      contourPath([
        { x: 0, y: 0, bulge: -1 },
        { x: 10, y: 0, bulge: -1 },
      ]),
    ).toBe('M0 0A5 5 0 0 0 10 0A5 5 0 0 0 0 0Z');
    const big = parsePath(
      contourPath([
        { x: 0, y: 0, bulge: 2.5 },
        { x: 100, y: 0, bulge: 0 },
      ]),
    );
    expect(big[1]).toMatchObject({ c: 'A', large: 1, sweep: 1 });
  });

  it('property: umístěný obrys s oblouky → cesta se stejnými vrcholy a středy oblouků', () => {
    const arbBulge = fc.oneof(
      fc.constant(0),
      fc.double({ min: -3, max: 3, noNaN: true }).filter((b) => Math.abs(b) > 0.01),
    );
    fc.assert(
      fc.property(
        fc.array(arbBulge, { minLength: 3, maxLength: 6 }),
        fc.record({
          x: fc.double({ min: -3000, max: 3000, noNaN: true }),
          y: fc.double({ min: -3000, max: 3000, noNaN: true }),
          rotation: fc.double({ min: 0, max: 359.9, noNaN: true }),
        }),
        (bulges, pl) => {
          // Pravidelný n-úhelník o poloměru 100 – úhly se zadanými bulge.
          const n = bulges.length;
          const outer: Contour = bulges.map((bulge, i) => ({
            x: 100 + 100 * Math.cos((2 * Math.PI * i) / n),
            y: 100 + 100 * Math.sin((2 * Math.PI * i) / n),
            bulge,
          }));
          const part: Part = { ...rect, shape: { outer, holes: [] } };
          const c = placedContours(part, { partId: 'r', instance: 0, ...pl });
          expectPathMatches(contourPath(c.outer), c.outer);
        },
      ),
    );
  });
});

describe('writeSheetSvg', () => {
  const svg = writeSheetSvg(sheet, layout, [shaped, rect], {
    remnant: { x: 10, y: 400, width: 300, height: 90 },
  });

  it('rozměry v mm, viewBox tabule, převrácená osa Y', () => {
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1000mm" height="500mm" viewBox="0 0 1000 500">/,
    );
    expect(svg).toContain('<g transform="matrix(1 0 0 -1 0 500)"');
    expect(svg).toContain('<title>Plech &quot;A&quot;</title>');
    expect(svg).not.toMatch(/NaN|Infinity|e[+-]\d/);
  });

  it('díly s obrysy včetně otvorů a barvou podle dílu', () => {
    const parts = [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)" fill-rule="evenodd"/g)];
    expect(parts).toHaveLength(3);
    const c = placedContours(shaped, layout.placements[1]!);
    const [outer, hole] = parts[1]![1]!.split(/(?<=Z)(?=M)/);
    expectPathMatches(outer!, c.outer);
    expectPathMatches(hole!, c.holes[0]!);
    expect(parts[0]![2]).toBe(partColor(0));
    expect(parts[2]![2]).toBe(partColor(1));
  });

  it('popisky mimo převrácenou skupinu s y = výška − y, text escapovaný', () => {
    const labels = [
      ...svg.matchAll(/<text x="([^"]+)" y="([^"]+)" font-size="[^"]+">([^<]*)<\/text>/g),
    ];
    expect(labels).toHaveLength(3);
    const p0 = placePart(shaped, layout.placements[0]!);
    expect(Number(labels[0]![1])).toBeCloseTo(p0.labelAt.x, 3);
    expect(Number(labels[0]![2])).toBeCloseTo(500 - p0.labelAt.y, 3);
    expect(labels[0]![3]).toBe('Příruba &lt;A&amp;B&gt;');
    expect(svg.indexOf('<text')).toBeGreaterThan(svg.indexOf('</g>'));
    expect(writeSheetSvg(sheet, layout, [shaped, rect], { labels: false })).not.toContain('<text');
  });

  it('okraj, šrafovaná zóna, zbytek a předpona ID', () => {
    expect(svg).toContain('<rect x="10" y="10" width="980" height="480" fill="none"');
    expect(svg).toContain('<path d="M900 0L1000 0L1000 50Z" fill="url(#zona)"');
    expect(svg).toContain('<rect x="10" y="400" width="300" height="90" fill="#dafbe1"');
    expect(svg).toMatch(
      /<text x="160" y="55" font-size="13.5" fill="#1a7f37">zbytek 300 × 90<\/text>/,
    );
    const p = writeSheetSvg(sheet, layout, [shaped, rect], { idPrefix: 't3-' });
    expect(p).toContain('<pattern id="t3-zona"');
    expect(p).toContain('fill="url(#t3-zona)"');
  });

  it('neznámý díl je chyba', () => {
    expect(() => writeSheetSvg(sheet, layout, [rect])).toThrow(RangeError);
  });
});

describe('writeResultSvg', () => {
  it('jeden soubor na tabuli s XML hlavičkou a zbytkem z metrik', () => {
    const input: NestingInput = {
      parts: [{ ...rect, quantity: 30 }],
      sheets: [{ ...sheet, forbiddenZones: [] }],
      params: DEFAULT_NESTING_PARAMS,
    };
    const outcome = nest(input);
    if (!outcome.ok) throw new Error('výpočet selhal');
    const files = writeResultSvg(input, outcome.result, 'Zakázka');
    expect(files.map((f) => f.name)).toEqual(
      outcome.result.layouts.map((_, i) => `Zakazka-tabule-${String(i + 1).padStart(2, '0')}.svg`),
    );
    for (const f of files)
      expect(f.content.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true);
    const withRemnant = outcome.result.metrics.sheets.findIndex((m) => m.remnant);
    if (withRemnant >= 0) expect(files[withRemnant]!.content).toContain('fill="#dafbe1"');
  });
});
