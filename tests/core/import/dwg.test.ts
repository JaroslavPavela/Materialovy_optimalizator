import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dwgToDxf, partsFromDwg } from '../../../src/core/import/dwg.ts';
import { dwgVersionCode, dwgVersionName } from '../../../src/core/import/dwg-format.ts';
import {
  partsFromDxf,
  type DxfPartMode,
  type DxfPartsResult,
} from '../../../src/core/import/dxf-parts.ts';
import { partArea } from '../../../src/core/metrics.ts';

const fixtures = new URL('../../fixtures/', import.meta.url);
const load = (name: string) => new Uint8Array(readFileSync(new URL(name, fixtures)));
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/** Hlavička DWG dané verze + nuly (zbytek souboru chybí). */
const header = (code: string) => {
  const b = new Uint8Array(128);
  b.set(ascii(code));
  return b;
};

describe('rozpoznání DWG', () => {
  it('kód verze z hlavičky; DXF (text i binární) není DWG', () => {
    expect(dwgVersionCode(header('AC1032'))).toBe('AC1032');
    expect(dwgVersionCode(header('AC1009').buffer)).toBe('AC1009');
    expect(dwgVersionCode(header('AC1.50'))).toBe('AC1.50');
    expect(dwgVersionCode(ascii('  0\nSECTION\n'))).toBeNull();
    expect(dwgVersionCode(ascii('AutoCAD Binary DXF\r\n'))).toBeNull();
    expect(dwgVersionCode('AC1032')).toBeNull();
    expect(dwgVersionCode(new Uint8Array(3))).toBeNull();
  });

  it('název verze pro hlášení', () => {
    expect(dwgVersionName('AC1032')).toBe('AutoCAD 2018');
    expect(dwgVersionName('AC1014')).toBe('AutoCAD R14');
    expect(dwgVersionName('AC1009')).toBe('AutoCAD R11/R12');
    expect(dwgVersionName('AC1099')).toBe('AC1099');
  });
});

describe('dwgToDxf – chyby', () => {
  it('starší verze než R14 → srozumitelná chyba s radou', () => {
    for (const code of ['AC1009', 'AC1012']) {
      const r = dwgToDxf(header(code));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(new RegExp(`${code}.*se nečte.*DXF`));
    }
  });

  it('soubor, který není DWG', () => {
    expect(dwgToDxf(ascii('  0\nSECTION\n'))).toEqual({
      ok: false,
      error: 'Soubor není výkres DWG.',
    });
  });

  it('poškozený nebo useknutý soubor → chyba, ne výjimka', () => {
    const whole = load('dwg/dil-s-otvory-ac1032.dwg');
    for (const bytes of [header('AC1032'), whole.subarray(0, 2000), header('AC1015')]) {
      const r = partsFromDwg('vadny.dwg', bytes);
      expect(r.parts).toEqual([]);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/nelze přečíst.*poškozený nebo neúplný/);
    }
  });

  it('Uint8Array uprostřed většího bufferu se čte jen ve svém rozsahu', () => {
    const whole = load('dwg/dil-s-otvory-ac1032.dwg');
    const padded = new Uint8Array(whole.length + 20);
    padded.set(whole, 10);
    const r = partsFromDwg('d.dwg', padded.subarray(10, 10 + whole.length));
    expect(r.errors).toEqual([]);
    expect(r.parts).toHaveLength(1);
  });
});

/** Rozměry, otvory a plocha dílů – pro porovnání importu DWG a DXF. */
const signature = (r: DxfPartsResult) =>
  r.parts.map((p) => ({
    name: p.name,
    width: p.width.toFixed(6),
    height: p.height.toFixed(6),
    holes: p.shape?.holes.length ?? 0,
    area: partArea(p).toFixed(6),
  }));

/** Vzorek DWG zapsaný acad-ts z DXF vzorku: `<vzorek>-<verze>.dwg`. */
const sourceDxf = (dwg: string) => dwg.replace(/-ac\d{4}\.dwg$/, '.dxf');
const AUTOCAD = 'autocad-vzorek-ac1018.dwg';

describe('vzorky DWG', () => {
  const files = readdirSync(new URL('dwg/', fixtures)).filter((f) => f.endsWith('.dwg'));

  it('každý vzorek má zdrojové DXF nebo očekávání; zastoupeny všechny verze R14–2018', () => {
    for (const f of files) {
      if (f !== AUTOCAD) expect(readdirSync(new URL('dxf/', fixtures))).toContain(sourceDxf(f));
    }
    const versions = new Set(files.map((f) => dwgVersionCode(load(`dwg/${f}`))));
    expect([...versions].sort()).toEqual([
      'AC1014',
      'AC1015',
      'AC1018',
      'AC1021',
      'AC1024',
      'AC1027',
      'AC1032',
    ]);
  });

  for (const f of files.filter((f) => f !== AUTOCAD)) {
    for (const mode of ['single', 'multi'] as DxfPartMode[]) {
      it(`${f} (${mode}) = ${sourceDxf(f)}`, () => {
        const opts = { mode, idPrefix: 'd' };
        const dwg = partsFromDwg(sourceDxf(f), load(`dwg/${f}`), opts);
        const dxf = partsFromDxf(sourceDxf(f), load(`dxf/${sourceDxf(f)}`), opts);
        expect(dwg.parts.length).toBeGreaterThan(0);
        expect(signature(dwg)).toEqual(signature(dxf));
        expect(dwg.errors).toEqual(dxf.errors);
        if (f.endsWith('-ac1014.dwg')) {
          // R14 jednotky výkresu ($INSUNITS) neukládá – předpoklad mm s varováním.
          expect(dwg.units).toEqual({ code: 0, name: 'mm', toMm: 1 });
          expect(dwg.warnings.join()).toMatch(/nemá uvedené jednotky/);
        } else {
          expect(dwg.units).toEqual(dxf.units);
        }
      });
    }
  }

  describe(`${AUTOCAD} (výkres z AutoCADu 2004, ACadSharp)`, () => {
    // Očekávání z DXF, které AutoCAD uložil ze stejného výkresu
    // (sample_AC1018_ascii.dxf v ACadSharp) – import DXF dal totéž.
    const EXPECTED: readonly (readonly [number, number, number])[] = [
      [519.514, 346.069, 0],
      [1158.179, 1158.179, 0],
      [519.514, 346.069, 0],
      [768.228, 914.326, 0],
      [579.09, 579.09, 0],
      [519.514, 346.069, 0],
      [553.782, 553.782, 0],
      [223.237, 265.691, 0],
      [519.514, 346.069, 0],
      [187.07, 187.07, 0],
      [183.298, 218.157, 0],
      [259.144, 165.949, 0],
      [134.805, 133.8, 0],
      [81.617, 81.617, 0],
      [3080.319, 724.206, 0],
      [613.881, 255.096, 0],
      [702.356, 472.715, 2],
      [702.356, 472.715, 4],
      [702.356, 472.715, 0],
      [702.356, 472.715, 4],
      [45707.151, 6446.697, 0],
    ];

    it('více dílů v souboru: 21 dílů v palcích, hlášení nepodporovaných entit', () => {
      const r = partsFromDwg(AUTOCAD, load(`dwg/${AUTOCAD}`), { mode: 'multi' });
      expect(r.units.name).toBe('palce');
      expect(r.parts.map((p) => [p.width, p.height, p.shape?.holes.length ?? 0])).toEqual(
        EXPECTED.map(([w, h, n]) => [expect.closeTo(w, 3), expect.closeTo(h, 3), n]),
      );
      expect(r.warnings.join('\n')).toMatch(/MLINE \(3\)/);
      expect(r.warnings.join('\n')).toMatch(/TEXT \(29\)/);
      expect(r.errors.join('\n')).toMatch(/Kontura není uzavřená/);
    });

    it('1 soubor = 1 díl: největší obrys', () => {
      const r = partsFromDwg(AUTOCAD, load(`dwg/${AUTOCAD}`), { mode: 'single' });
      expect(r.parts).toHaveLength(1);
      expect(r.parts[0]!.width).toBeCloseTo(45707.151, 3);
    });
  });
});
