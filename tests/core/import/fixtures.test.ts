import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contourArea } from '../../../src/core/geometry/contour.ts';
import { partsFromDxf, type DxfPartsOptions } from '../../../src/core/import/dxf-parts.ts';
import { DEFAULT_NESTING_PARAMS, type Part } from '../../../src/core/model.ts';
import { partArea } from '../../../src/core/metrics.ts';
import { validateNestingInput } from '../../../src/core/validate.ts';

const dir = new URL('../../fixtures/dxf/', import.meta.url);
const load = (name: string) => new Uint8Array(readFileSync(new URL(name, dir)));

interface Expectation {
  readonly opts?: DxfPartsOptions;
  /** Díly: [šířka, výška, počet otvorů] v pořadí pojmenování. */
  readonly parts: readonly (readonly [number, number, number])[];
  /** Názvy dílů ve stejném pořadí (chybí-li, nekontrolují se). */
  readonly names?: readonly string[];
  readonly units?: string;
  /** Části textu, které musí být ve varováních / chybách (prázdné = žádné). */
  readonly warnings?: readonly RegExp[];
  readonly errors?: readonly RegExp[];
  /** Plocha prvního dílu (mm²) a povolená odchylka (výchozí 0,001). */
  readonly area?: number;
  readonly areaTol?: number;
}

const DILY: DxfPartsOptions = { mode: 'multi', layer: (l) => l === 'DILY' || l === 'OTVORY' };
const OPEN = /Kontura není uzavřená/;

/** Očekávání pro každý vzorek (vzorky: tests/fixtures/generate-dxf.ts). */
const EXPECTED: Record<string, readonly Expectation[]> = {
  'plan-polyline.dxf': [
    {
      opts: DILY,
      // Shora dolů: příruba otočená o 37,5° (obalový obdélník podle contourBBox),
      // bok, příruba otočená o 90°, příruba bez otočení.
      parts: [
        [111.731, 102.502, 2],
        [200, 100, 0],
        [60, 110, 2],
        [110, 60, 2],
      ],
      // Názvy z popisků uvnitř dílů; natočené příruby nejsou stejný tvar.
      names: ['Příruba', 'Bok', 'Příruba-2', 'Příruba-3'],
      warnings: [
        /TEXT \(4\)/,
        /„Příruba" mají různý tvar nebo natočení.*Příruba, Příruba-2, Příruba-3/,
      ],
    },
  ],
  'plan-cary-oblouky.dxf': [
    {
      opts: DILY,
      // Shora dolů: příruba otočená o 37,5° (obalový obdélník podle contourBBox),
      // bok, příruba otočená o 90°, příruba bez otočení.
      parts: [
        [111.731, 102.502, 2],
        [200, 100, 0],
        [60, 110, 2],
        [110, 60, 2],
      ],
      // Názvy z popisků uvnitř dílů; natočené příruby nejsou stejný tvar.
      names: ['Příruba', 'Bok', 'Příruba-2', 'Příruba-3'],
      warnings: [
        /TEXT \(4\)/,
        /„Příruba" mají různý tvar nebo natočení.*Příruba, Příruba-2, Příruba-3/,
      ],
    },
  ],
  // Uzavření mezery 0,05 mm přichytí roh: úbytek ≤ 0,05 · 120 / 2 = 3 mm².
  'nespojene-cary.dxf': [
    { parts: [[120, 80, 0]], warnings: [/Mezera 0,050 mm/], area: 9600, areaTol: 3.01 },
  ],
  'duplicity.dxf': [{ parts: [[100, 50, 1]], warnings: [/duplicitních segmentů: 4/] }],
  'palce.dxf': [{ parts: [[101.6, 50.8, 1]], units: 'palce' }],
  'bez-jednotek.dxf': [{ parts: [[300, 150, 0]], warnings: [/nemá uvedené jednotky/] }],
  'blok.dxf': [{ parts: [[120, 200, 1]], area: 4 * (100 * 20 + 20 * 40) - 4 * Math.PI * 16 }],
  'dil-s-otvory.dxf': [{ parts: [[400, 250, 6]] }],
  'spline.dxf': [{ parts: [[200, 71.32, 1]] }],
  'vice-dilu.dxf': [
    {
      parts: [[300, 200, 1]],
      warnings: [/Uvnitř otvorů dílu je 1 dalších/, /Mimo hlavní obrys je 2 dalších/],
    },
    {
      opts: { mode: 'multi' },
      parts: [
        [300, 200, 1],
        [60, 60, 0],
        [100, 100, 0],
        [80, 80, 0],
      ],
    },
  ],
  'neuzavrena.dxf': [{ opts: { mode: 'multi' }, parts: [[50, 50, 0]], errors: [OPEN] }],
  'zrcadleny-oblouk.dxf': [{ parts: [[40, 40, 0]], errors: [OPEN, OPEN, OPEN, OPEN] }],
  'zrcadleny-rozvin.dxf': [
    { parts: [[200, 100, 1]], area: 200 * 100 - 4 * (100 - 25 * Math.PI) - 400 * Math.PI },
  ],
  'texty-koty.dxf': [
    {
      parts: [[150, 75, 0]],
      names: ['texty-koty'],
      warnings: [/TEXT \(1\), MTEXT \(1\), DIMENSION \(1\), HATCH \(1\)/],
    },
    {
      // Více dílů: název z textu s největším písmem (TEXT 5 mm, MTEXT 3 mm).
      opts: { mode: 'multi' },
      parts: [[150, 75, 0]],
      names: ['Díl A'],
      warnings: [/TEXT \(1\), MTEXT \(1\), DIMENSION \(1\), HATCH \(1\)/],
    },
  ],
  'lwpolyline-zdvojeny-bod.dxf': [{ parts: [[80, 60, 0]] }],
  'nulovy-polomer.dxf': [{ parts: [[60, 60, 0]], warnings: [/nulovým/] }],
  'vrstvy.dxf': [
    { parts: [[200, 100, 0]], warnings: [/skryté entity .*: 1/], errors: [OPEN] },
    { opts: { layer: (l) => l === 'OBRYS' }, parts: [[200, 100, 0]], warnings: [/skryté/] },
  ],
};

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

function check(name: string, e: Expectation) {
  const r = partsFromDxf(name, load(name), e.opts);
  expect(
    r.parts.map((p) => [p.width, p.height, p.shape!.holes.length]),
    'rozměry a otvory dílů',
  ).toSatisfy(
    (got: [number, number, number][]) =>
      got.length === e.parts.length &&
      got.every(
        (g, i) =>
          near(g[0], e.parts[i]![0]) && near(g[1], e.parts[i]![1]) && g[2] === e.parts[i]![2],
      ),
  );
  if (e.names) expect(r.parts.map((p) => p.name)).toEqual(e.names);
  if (e.units) expect(r.units.name).toBe(e.units);
  const w = e.warnings ?? [];
  expect(r.warnings).toHaveLength(w.length);
  w.forEach((re, i) => expect(r.warnings[i]).toMatch(re));
  const er = e.errors ?? [];
  expect(r.errors).toHaveLength(er.length);
  er.forEach((re, i) => expect(r.errors[i]).toMatch(re));
  if (e.area !== undefined) {
    const p = r.parts[0]!.shape!;
    const area = contourArea(p.outer) - p.holes.reduce((sum, h) => sum + contourArea(h), 0);
    expect(Math.abs(area - e.area)).toBeLessThanOrEqual(e.areaTol ?? 0.001);
  }
  return r.parts;
}

describe('vzorky DXF', () => {
  it('každý vzorek ve složce má očekávání', () => {
    const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.dxf'));
    expect(files.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [name, cases] of Object.entries(EXPECTED)) {
    cases.forEach((e, i) => {
      it(`${name}${cases.length > 1 ? ` (${i + 1})` : ''}`, () => {
        const parts: Part[] = check(name, e);
        if (parts.length === 0) return;
        // Díly z každého vzorku projdou validací vstupu nestingu.
        const issues = validateNestingInput({
          parts,
          sheets: [
            {
              id: 's',
              name: 'S',
              width: 3000,
              height: 1500,
              stock: null,
              margin: 0,
              forbiddenZones: [],
            },
          ],
          params: DEFAULT_NESTING_PARAMS,
        });
        expect(issues).toEqual([]);
        for (const p of parts) expect(partArea(p)).toBeGreaterThan(0);
      });
    });
  }
});
